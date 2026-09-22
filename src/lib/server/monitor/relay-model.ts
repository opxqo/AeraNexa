/**
 * CF-Server-Monitor 实时推送的合并模型（纯函数，无 IO）。
 *
 * 广播端 batchUpdate 形如 { type, ts, updates: [{ serverId, samples: [{ ts, data }] }] }，
 * 快照里的 latestReportUpdates 是同结构的 updates 数组（source/CF-Server-Monitor
 * src/durable/MetricsBroadcaster.js _broadcastBatch / _getLatestReportUpdates）。
 */

export type RelayServer = Record<string, unknown> & { id: string };

type Sample = { ts?: unknown; data?: unknown; payload?: unknown; metrics?: unknown };
type Update = { serverId?: unknown; samples?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 取一条 update 的最新样本：samples 末位的 data（兼容 payload / metrics 别名）与其时间戳。 */
function latestSample(update: Update, fallbackTs: number): { data: Record<string, unknown>; ts: number } | null {
  if (!Array.isArray(update.samples) || update.samples.length === 0) return null;
  const last = update.samples[update.samples.length - 1] as Sample | undefined;
  if (!isRecord(last)) return null;
  const data = last.data ?? last.payload ?? last.metrics;
  if (!isRecord(data)) return null;
  const ts =
    typeof last.ts === "number" && Number.isFinite(last.ts)
      ? last.ts
      : typeof data.last_updated === "number" && Number.isFinite(data.last_updated)
        ? data.last_updated
        : fallbackTs;
  return { data, ts };
}

function updatesOf(message: unknown): Update[] {
  if (!isRecord(message) || !Array.isArray(message.updates)) return [];
  return message.updates.filter(isRecord) as Update[];
}

/**
 * 把一批推送合并进 servers（原地修改），返回发生变化的服务器增量：
 * 只含 id、取值变化的字段与 last_updated。未知 id 不入表（缺名称等静态字段），交给 unknownServerIds 触发快照刷新。
 */
export function applyBatchUpdate(servers: Map<string, RelayServer>, message: unknown, now = Date.now()): RelayServer[] {
  const deltas: RelayServer[] = [];
  for (const update of updatesOf(message)) {
    const id = update.serverId == null ? "" : String(update.serverId);
    const existing = id ? servers.get(id) : undefined;
    if (!existing) continue;
    const sample = latestSample(update, now);
    if (!sample) continue;

    const delta: RelayServer = { id, last_updated: sample.ts };
    for (const [key, value] of Object.entries(sample.data)) {
      if (key === "id" || key === "last_updated") continue;
      if (!sameValue(existing[key], value)) delta[key] = value;
    }
    servers.set(id, { ...existing, ...delta });
    deltas.push(delta);
  }
  return deltas;
}

/** 快照里的 latestReportUpdates 比 D1 的分钟级指标更新，合并后首屏即是最新值。 */
export function applyLatestReportUpdates(servers: Map<string, RelayServer>, updates: unknown, now = Date.now()): void {
  if (!Array.isArray(updates)) return;
  applyBatchUpdate(servers, { updates }, now);
}

/** 推送中出现、但状态表里还没有的服务器 id（新接入的节点）。 */
export function unknownServerIds(servers: Map<string, RelayServer>, message: unknown): string[] {
  const unknown = new Set<string>();
  for (const update of updatesOf(message)) {
    const id = update.serverId == null ? "" : String(update.serverId);
    if (id && !servers.has(id)) unknown.add(id);
  }
  return [...unknown];
}
