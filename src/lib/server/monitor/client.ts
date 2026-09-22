import "server-only";

import { notFound, unavailable, type BusinessError } from "../errors";
import { getNumberSetting, getSetting } from "../settings";

/**
 * CF-Server-Monitor（CFSM）探针监控系统的 HTTP 客户端。
 *
 * 只在服务端使用；地址与凭据来自系统设置「监控」组（后台 → 环境变量回退），浏览器永远拿不到密码。
 * 对接形态支持两种，由 monitor.auth_mode 决定：
 * - auto：先探测对方 /api/config 的 is_public。公开仪表盘免密钥直调；
 *   非公开则用管理员账号密码 POST /admin/api 登录换取 JWT（7 天有效期，本地缓存 6 天自动续期）。
 * - public：强制免密钥直调（确定对方 is_public=true 时省去探测）。
 * - jwt：强制账号密码登录（对方 is_public=false，或需要 24 小时以上的历史数据时）。
 *
 * 接口与鉴权行为对照 source/CF-Server-Monitor：src/index.js 路由表、src/handlers/dashboard.js:181-215
 * （is_public 判定）、src/middleware/auth.js:121-146（Bearer / cookie / query token）、
 * src/handlers/admin.js:463-516（登录发 token）。
 */

export type MonitorErrorKind =
  /** 未配置监控地址，或非公开模式下缺账号密码。 */
  | "config"
  /** 连不上、超时、5xx。可重试。 */
  | "unreachable"
  /** 401：登录失败或 token 被拒。 */
  | "auth"
  /** 403：对方开了 Turnstile 全局人机验证等，服务端直连被挡。 */
  | "forbidden"
  /** 404：接口不存在，多半是地址填错。 */
  | "not_found"
  /** 响应不是预期的 JSON 结构。 */
  | "protocol";

// 不用构造参数属性：节点 worker 可能直接由 Node 剥离类型运行，它不支持该语法。
export class MonitorError extends Error {
  readonly kind: MonitorErrorKind;
  readonly status?: number;

  constructor(kind: MonitorErrorKind, message: string, status?: number) {
    super(message);
    this.name = "MonitorError";
    this.kind = kind;
    this.status = status;
  }

  get retryable(): boolean {
    return this.kind === "unreachable";
  }
}

export type MonitorAuthMode = "auto" | "public" | "jwt";

type MonitorConfig = {
  baseUrl: string;
  authMode: MonitorAuthMode;
  username: string;
  password: string;
  timeoutMs: number;
};

async function readConfig(): Promise<MonitorConfig> {
  const [baseUrl, authMode, username, password, timeoutMs] = await Promise.all([
    getSetting("monitor.base_url"),
    getSetting("monitor.auth_mode"),
    getSetting("monitor.username"),
    getSetting("monitor.password"),
    getNumberSetting("monitor.timeout_ms"),
  ]);
  if (!baseUrl) {
    throw new MonitorError("config", "未配置 CF-Server-Monitor 地址，请在后台「系统设置 → 监控」填写");
  }
  const mode: MonitorAuthMode = authMode === "public" || authMode === "jwt" ? authMode : "auto";
  return { baseUrl: baseUrl.replace(/\/+$/, ""), authMode: mode, username, password, timeoutMs };
}

/* ------------------------------------------------------------------ *
 * 鉴权缓存：公开性探测结果 + 登录 JWT
 * ------------------------------------------------------------------ */

type TokenCache = { token: string; expiresAt: number };

let tokenCache: TokenCache | null = null;
let publicCache: { isPublic: boolean; checkedAt: number } | null = null;

/** 公开性探测缓存 5 分钟：对方切换 is_public 后最迟 5 分钟感知。 */
const PUBLIC_PROBE_TTL_MS = 5 * 60_000;
/** CFSM 的 JWT 有效期 7 天，缓存 6 天留出续期余量。 */
const TOKEN_TTL_MS = 6 * 24 * 3_600_000;

/** 设置变更或测试连接时调用，丢弃旧凭据。 */
export function invalidateMonitorAuthCache(): void {
  tokenCache = null;
  publicCache = null;
}

async function rawFetch(
  config: MonitorConfig,
  path: string,
  token: string | null,
  init?: { method?: "GET" | "POST"; body?: unknown },
): Promise<Response> {
  try {
    return await fetch(`${config.baseUrl}${path}`, {
      method: init?.method ?? "GET",
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(config.timeoutMs),
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "请求超时" : "无法连接";
    throw new MonitorError("unreachable", `CF-Server-Monitor${reason}（${path}）`);
  }
}

async function probePublic(config: MonitorConfig, force = false): Promise<boolean> {
  if (!force && publicCache && Date.now() - publicCache.checkedAt < PUBLIC_PROBE_TTL_MS) {
    return publicCache.isPublic;
  }
  const response = await rawFetch(config, "/api/config", null);
  if (!response.ok) {
    throw new MonitorError("unreachable", `CF-Server-Monitor /api/config 返回 HTTP ${response.status}`, response.status);
  }
  let data: { is_public?: unknown };
  try {
    data = (await response.json()) as { is_public?: unknown };
  } catch {
    throw new MonitorError("protocol", "CF-Server-Monitor /api/config 响应不是 JSON");
  }
  const isPublic = data.is_public === true;
  publicCache = { isPublic, checkedAt: Date.now() };
  return isPublic;
}

async function login(config: MonitorConfig): Promise<string> {
  if (!config.username || !config.password) {
    throw new MonitorError(
      "config",
      "对方不是公开仪表盘：请在「系统设置 → 监控」填写 CF-Server-Monitor 管理员账号密码，或把对接模式改为公开免密钥",
    );
  }
  const response = await rawFetch(config, "/admin/api", null, {
    method: "POST",
    body: { action: "login", username: config.username, password: config.password },
  });
  if (response.status === 401 || response.status === 403) {
    throw new MonitorError("auth", "CF-Server-Monitor 管理员登录失败，请检查账号密码", response.status);
  }
  if (!response.ok) {
    throw new MonitorError("unreachable", `CF-Server-Monitor 登录接口返回 HTTP ${response.status}`, response.status);
  }
  let data: { token?: unknown };
  try {
    data = (await response.json()) as { token?: unknown };
  } catch {
    throw new MonitorError("protocol", "CF-Server-Monitor 登录响应不是 JSON");
  }
  if (typeof data.token !== "string" || !data.token) {
    throw new MonitorError("protocol", "CF-Server-Monitor 登录响应不含 token");
  }
  tokenCache = { token: data.token, expiresAt: Date.now() + TOKEN_TTL_MS };
  return data.token;
}

async function resolveToken(config: MonitorConfig, force = false): Promise<string | null> {
  if (config.authMode === "public") return null;
  if (config.authMode === "jwt") {
    if (!force && tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
    return login(config);
  }
  // auto：公开则免密钥，否则登录
  if (await probePublic(config, force)) return null;
  if (!force && tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  return login(config);
}

/* ------------------------------------------------------------------ *
 * 请求封装
 * ------------------------------------------------------------------ */

type RequestOptions = { query?: Record<string, string>; method?: "GET" | "POST"; body?: unknown };

async function monitorRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const config = await readConfig();
  const target = options.query ? `${path}?${new URLSearchParams(options.query).toString()}` : path;

  let token = await resolveToken(config);
  let response = await rawFetch(config, target, token, options);
  if (response.status === 401) {
    // token 过期或公开性判定已变化：清缓存强制重新判定/登录，重试一次
    invalidateMonitorAuthCache();
    token = await resolveToken(config, true);
    response = await rawFetch(config, target, token, options);
  }

  if (response.status === 401) {
    throw new MonitorError("auth", "CF-Server-Monitor 拒绝访问（401）：对方非公开时请检查管理员账号密码", 401);
  }
  if (response.status === 403) {
    throw new MonitorError(
      "forbidden",
      "CF-Server-Monitor 返回 403：对方若开启 Turnstile 全局人机验证则无法服务端直连，请关闭或改为仅登录验证",
      403,
    );
  }
  if (response.status === 404) {
    throw new MonitorError("not_found", `CF-Server-Monitor 接口不存在（404）：${path}，请检查监控地址`, 404);
  }
  if (!response.ok) {
    throw new MonitorError("unreachable", `CF-Server-Monitor 返回 HTTP ${response.status}（${path}）`, response.status);
  }

  let data: T;
  try {
    data = (await response.json()) as T;
  } catch {
    throw new MonitorError("protocol", `CF-Server-Monitor 响应不是 JSON（${path}）`, response.status);
  }
  return data;
}

/* ------------------------------------------------------------------ *
 * 读接口封装（CFSM 响应体为裸 JSON，无统一信封）
 * ------------------------------------------------------------------ */

export type CfsmServer = Record<string, unknown> & { id: string | number; name?: string; region?: string };

export type CfsmServersPayload = {
  servers: CfsmServer[];
  latestReportUpdates?: unknown;
  stats: {
    total: number;
    online: number;
    offline: number;
    globalSpeedIn: number;
    globalSpeedOut: number;
    globalNetTx: number;
    globalNetRx: number;
  };
  regionStats: Record<string, number>;
  sysConfig: Record<string, unknown>;
};

/** 全部节点 + 实时指标 + 全局统计，节点状态页的主数据源。 */
export async function listServers(): Promise<CfsmServersPayload> {
  const data = await monitorRequest<CfsmServersPayload>("/api/servers");
  if (!data || !Array.isArray(data.servers)) {
    throw new MonitorError("protocol", "CF-Server-Monitor /api/servers 响应格式异常");
  }
  return data;
}

export async function getServerDetail(id: string): Promise<CfsmServer> {
  const data = await monitorRequest<CfsmServer>("/api/server", { query: { id } });
  if (!data || typeof data !== "object") {
    throw new MonitorError("protocol", "CF-Server-Monitor /api/server 响应格式异常");
  }
  return data;
}

/** CFSM 只接受这几个历史窗口（source/CF-Server-Monitor src/index.js:108）。 */
export const ALLOWED_HISTORY_HOURS: readonly number[] = [0.167, 0.5, 1, 6, 12, 24, 48, 96, 168];

export async function getHistory(id: string, hours: number): Promise<unknown[]> {
  if (!ALLOWED_HISTORY_HOURS.includes(hours)) {
    throw new MonitorError("config", `不支持的历史窗口：${hours} 小时（可选 ${ALLOWED_HISTORY_HOURS.join(" / ")}）`);
  }
  const data = await monitorRequest<unknown[]>("/api/history/all", { query: { id, hours: String(hours) } });
  if (!Array.isArray(data)) {
    throw new MonitorError("protocol", "CF-Server-Monitor 历史数据响应格式异常");
  }
  return data;
}

/**
 * 浏览器侧实时通道地址。仅公开模式返回（不含任何凭据）；
 * 需要 JWT 的模式返回 null —— CFSM 的 JWT 等同管理员权限，不能下发给浏览器，
 * 这种模式下节点页应轮询 /api/monitor/servers 代理接口。
 */
export async function buildWsUrl(subscribe: "all" | string = "all"): Promise<string | null> {
  const config = await readConfig();
  const token = await resolveToken(config);
  if (token) return null;
  const url = new URL(`${config.baseUrl}/api/ws`);
  url.searchParams.set("subscribe", subscribe);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/* ------------------------------------------------------------------ *
 * 后台「测试监控连接」
 * ------------------------------------------------------------------ */

export type MonitorConnectionTest = {
  mode: "public" | "jwt";
  version: string;
  total: number;
  online: number;
};

/** 用当前生效设置实跑一次：清缓存 → 判定模式 → 拉站点版本与节点列表。 */
export async function testConnection(): Promise<MonitorConnectionTest> {
  const config = await readConfig();
  invalidateMonitorAuthCache();
  const token = await resolveToken(config, true);
  const [site, servers] = await Promise.all([
    monitorRequest<{ version?: unknown }>("/api/config"),
    listServers(),
  ]);
  return {
    mode: token ? "jwt" : "public",
    version: typeof site.version === "string" ? site.version : "未知",
    total: servers.stats?.total ?? servers.servers.length,
    online: servers.stats?.online ?? 0,
  };
}

/** 映射为项目统一的 BusinessError，代理路由可直接交给 toApiError。 */
export function toBusinessError(error: MonitorError): BusinessError {
  if (error.kind === "not_found") return notFound(error.message);
  return unavailable(error.message);
}
