import { getDbPool } from "./db";

export const LOG_CATEGORIES = ["access", "slow", "error", "worker", "bot", "payment"] as const;
export type LogCategory = (typeof LOG_CATEGORIES)[number];
export type LogLevel = "info" | "warn" | "error";
export type LogService = "web" | "worker" | "bot";

export const LOG_CATEGORY_LABELS: Record<LogCategory, string> = {
  access: "请求访问", slow: "慢请求", error: "应用错误",
  worker: "Worker", bot: "Bot", payment: "支付运行",
};

export type RuntimeLog = {
  service: LogService;
  category: LogCategory;
  level: LogLevel;
  eventCode: string;
  message: string;
  requestId?: string | null;
  actorId?: number | null;
  method?: string | null;
  path?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;
  details?: Record<string, string | number | boolean | null>;
};

const MAX_QUEUE = 5_000;
const BATCH_SIZE = 100;
const SETTINGS_TTL_MS = 5_000;
const queue: RuntimeLog[] = [];
let settings: { enabled: Set<string>; loadedAt: number } | null = null;
let settingsLoad: Promise<void> | null = null;
let flushing = false;
let droppedCount = 0;
let lastFailureAt: Date | null = null;
let lastFailureMessage: string | null = null;
let lastHealthWrite = 0;
let lastFailureWrite = 0;

/** 保存路径结构，遮蔽可能出现在路径段里的 token；查询参数从不进入日志。 */
export function safeLogPath(raw: string): string {
  let path: string;
  try { path = new URL(raw, "http://local.invalid").pathname; }
  catch { path = "/invalid-path"; }
  return path.split("/").map((part) =>
    part.includes("@") || /^[0-9a-f]{20,}$/i.test(part) || /^[A-Za-z0-9_-]{32,}$/.test(part)
      ? ":private" : part,
  ).join("/").slice(0, 255);
}

/** 异常文本可能含外部 URL、令牌或连接串，写出前统一削减。 */
export function safeLogMessage(value: unknown): string {
  return String(value ?? "")
    .replace(/https?:\/\/[^\s"']+/gi, (url) => { try { const parsed = new URL(url); return `${parsed.origin}${safeLogPath(parsed.pathname)}`; } catch { return "[url]"; } })
    .replace(/\/[A-Za-z0-9/_%.:-]+\?[^\s"']+/g, (url) => safeLogPath(url))
    .replace(/\b(password|passwd|token|secret|api[_-]?key|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]")
    .slice(0, 500);
}

export function safeError(error: unknown): string {
  if (error instanceof Error) return safeLogMessage(`${error.name}: ${error.message}`);
  return safeLogMessage(error);
}

async function isEnabled(category: LogCategory): Promise<boolean> {
  if (!settings || Date.now() - settings.loadedAt > SETTINGS_TTL_MS) {
    if (!settingsLoad) {
      settingsLoad = (async () => {
        try {
          const [rows] = await getDbPool().query<import("mysql2").RowDataPacket[]>("SELECT category, enabled FROM log_capture_settings");
          settings = { enabled: new Set(LOG_CATEGORIES.filter((item) => !rows.some((row) => row.category === item && !Number(row.enabled)))), loadedAt: Date.now() };
        } catch {
          // 迁移尚未完成或数据库短暂不可达时，暂用默认值，5 秒后再试。
          settings = { enabled: new Set(LOG_CATEGORIES), loadedAt: Date.now() };
        }
      })().finally(() => { settingsLoad = null; });
    }
    await settingsLoad;
  }
  return settings?.enabled.has(category) ?? true;
}

export function invalidateLogSettings(): void { settings = null; }

/** 非关键运行日志异步排队；审计日志走独立的 recordAudit。 */
export async function emitRuntimeLog(input: RuntimeLog): Promise<void> {
  if (!(await isEnabled(input.category))) return;
  const entry: RuntimeLog = {
    ...input,
    eventCode: safeLogMessage(input.eventCode).slice(0, 80),
    message: safeLogMessage(input.message),
    path: input.path ? safeLogPath(input.path) : null,
    details: input.details ? Object.fromEntries(Object.entries(input.details).slice(0, 30).map(([key, value]) => [
      key.slice(0, 80),
      /password|passwd|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key/i.test(key)
        ? "[redacted]" : safeLogMessage(value),
    ])) : undefined,
  };
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`);
  if (queue.length >= MAX_QUEUE) { queue.shift(); droppedCount++; }
  queue.push(entry);
  if (queue.length >= BATCH_SIZE) void flushRuntimeLogs();
}

async function updateHealth(service: LogService): Promise<void> {
  if (!lastFailureAt && !droppedCount && Date.now() - lastHealthWrite < 60_000) return;
  await getDbPool().execute(
    `INSERT INTO log_ingestion_status (service, last_success_at, last_failure_at, last_error, dropped_count)
     VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?)
     ON DUPLICATE KEY UPDATE last_success_at = CURRENT_TIMESTAMP,
       last_failure_at = COALESCE(VALUES(last_failure_at), last_failure_at),
       last_error = VALUES(last_error), dropped_count = dropped_count + VALUES(dropped_count)`,
    [service, lastFailureAt, lastFailureMessage, droppedCount],
  );
  lastHealthWrite = Date.now();
  lastFailureAt = null;
  lastFailureMessage = null;
  droppedCount = 0;
}

export async function flushRuntimeLogs(): Promise<void> {
  if (flushing || !queue.length) return;
  flushing = true;
  const batch = queue.splice(0, BATCH_SIZE);
  try {
    const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",");
    const values = batch.flatMap((item) => [
      item.service, item.category, item.level, item.eventCode, item.message,
      item.requestId ?? null, item.actorId ?? null, item.method ?? null,
      item.path ?? null, item.statusCode ?? null, item.durationMs ?? null,
      item.details ? JSON.stringify(item.details) : null,
    ]);
    await getDbPool().query(
      `INSERT INTO runtime_logs (service, category, level, event_code, message, request_id, actor_id, request_method, request_path, status_code, duration_ms, details) VALUES ${placeholders}`,
      values,
    );
    await updateHealth(batch[0].service).catch((error: unknown) => {
      process.stderr.write(`${JSON.stringify({ event: "log.health_failed", error: safeError(error) })}\n`);
    });
  } catch (error) {
    lastFailureAt = new Date();
    lastFailureMessage = safeError(error).slice(0, 255);
    process.stderr.write(`${JSON.stringify({ event: "log.ingestion_failed", error: lastFailureMessage, count: batch.length })}\n`);
    if (Date.now() - lastFailureWrite > 5_000) {
      lastFailureWrite = Date.now();
      const droppedToReport = droppedCount;
      void Promise.resolve().then(() => getDbPool().execute(
        `INSERT INTO log_ingestion_status (service, last_failure_at, last_error, dropped_count)
         VALUES (?, CURRENT_TIMESTAMP, ?, ?)
         ON DUPLICATE KEY UPDATE last_failure_at = CURRENT_TIMESTAMP,
           last_error = VALUES(last_error), dropped_count = dropped_count + VALUES(dropped_count)`,
        [batch[0].service, lastFailureMessage, droppedToReport],
      )).then(() => { droppedCount = Math.max(0, droppedCount - droppedToReport); }).catch(() => { /* 数据库不可用时由 stderr 保留故障证据。 */ });
    }
    queue.unshift(...batch);
    if (queue.length > MAX_QUEUE) { droppedCount += queue.length - MAX_QUEUE; queue.splice(MAX_QUEUE); }
  } finally {
    flushing = false;
  }
}

const timer = setInterval(() => { void flushRuntimeLogs(); }, 1_000);
timer.unref();

export async function drainRuntimeLogs(): Promise<void> {
  clearInterval(timer);
  for (let i = 0; i < 100 && queue.length; i++) {
    const before = queue.length;
    await flushRuntimeLogs();
    if (queue.length >= before) break;
  }
}
