import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import tls from "node:tls";
import { getNumberSetting, getSetting } from "../settings";

/**
 * 3x-ui 主控面板的 HTTP 客户端。
 *
 * 只在服务端（Next.js 与节点 worker）使用；地址与凭据来自系统设置（后台 → 环境变量回退），浏览器永远拿不到。
 * 预期使用 3x-ui 的 `node-sync` 范围 API Token（见 docs/node-domain-design.md §2），
 * 因此这里只封装该范围白名单内的接口。
 */

export type PanelErrorKind =
  /** 未配置 3x-ui 面板地址或 API Token。 */
  | "config"
  /** 连不上、超时、DNS 失败。可重试。 */
  | "unreachable"
  /** 401：token 无效或已被吊销。 */
  | "auth"
  /** 403：token 范围不足（例如用了 monitor token）。 */
  | "forbidden"
  /** 404：多半是 PANEL_BASE_URL 缺了面板的 basePath。 */
  | "not_found"
  /** HTTP 200 但 success=false：3x-ui 拒绝了这次操作。 */
  | "rejected"
  /** 响应不是预期的 JSON 信封。 */
  | "protocol";

// 不用构造参数属性（readonly kind 写在参数里）：节点 worker 可能直接由 Node 剥离类型运行，它不支持该语法。
export class PanelError extends Error {
  readonly kind: PanelErrorKind;
  readonly status?: number;

  constructor(kind: PanelErrorKind, message: string, status?: number) {
    super(message);
    this.name = "PanelError";
    this.kind = kind;
    this.status = status;
  }

  /** 网络类错误值得整体暂停后重试；其余错误重试也不会变好。 */
  get retryable(): boolean {
    return this.kind === "unreachable" || (this.status !== undefined && this.status >= 500);
  }
}

type PanelConfig = { baseUrl: string; token: string; timeoutMs: number };
export type PinnedPanelTarget = PanelConfig & { certificateSha256: string };

/** Accept the hexadecimal or Base64 SHA-256 printed by 3x-node credentials. */
export function normalizeCertificateSha256(value: string): string {
  const compact = value.trim().replace(/:/g, "");
  if (/^[a-f\d]{64}$/i.test(compact)) return compact.toLowerCase();
  const decoded = Buffer.from(compact, "base64");
  if (decoded.length === 32 && decoded.toString("base64").replace(/=+$/, "") === compact.replace(/=+$/, "")) {
    return decoded.toString("hex");
  }
  throw new PanelError("config", "TLS 证书指纹须为 SHA-256 十六进制或 Base64 值");
}

/** TLS is accepted only after comparing the exact leaf certificate bytes. */
async function pinnedRequest(url: URL, method: "GET" | "POST", token: string, pin: string, timeoutMs: number, body?: unknown): Promise<{ status: number; json: () => unknown }> {
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new PanelError("config", "3x-node 管理地址必须是无凭据、无查询参数的 HTTPS 地址");
  }
  const expected = Buffer.from(normalizeCertificateSha256(pin), "hex");
  const port = Number(url.port || 443);
  let timedOut = false;
  const socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
    const connection = tls.connect({ host: url.hostname, port, servername: url.hostname.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) ? undefined : url.hostname, rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] });
    connection.setTimeout(timeoutMs, () => { timedOut = true; connection.destroy(new Error("请求超时")); });
    connection.once("error", reject);
    connection.once("secureConnect", () => {
      const raw = connection.getPeerCertificate(true).raw;
      const actual = raw ? createHash("sha256").update(raw).digest() : null;
      if (!actual || !timingSafeEqual(actual, expected)) {
        connection.destroy();
        reject(new Error("TLS 证书指纹不匹配"));
        return;
      }
      connection.removeListener("error", reject);
      resolve(connection);
    });
  });
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const response = await new Promise<{ status: number; data: Buffer }>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    socket.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2_000_000) socket.destroy(new Error("响应过大"));
      else chunks.push(chunk);
    });
    socket.once("error", reject);
    socket.once("end", () => {
      if (timedOut) { reject(new Error("请求超时")); return; }
      const raw = Buffer.concat(chunks);
      const split = raw.indexOf("\r\n\r\n");
      if (split < 0) { reject(new Error("HTTP 响应不完整")); return; }
      const header = raw.subarray(0, split).toString("latin1");
      const status = Number(/^HTTP\/1\.[01] (\d{3})/m.exec(header)?.[1]);
      if (!Number.isInteger(status)) { reject(new Error("HTTP 状态行异常")); return; }
      resolve({ status, data: raw.subarray(split + 4) });
    });
    const lines = [
      `${method} ${url.pathname} HTTP/1.0`, `Host: ${url.host}`, "Accept: application/json",
      `Authorization: Bearer ${token}`, "Connection: close",
      ...(payload === undefined ? [] : ["Content-Type: application/json", `Content-Length: ${Buffer.byteLength(payload)}`]),
      "", "",
    ];
    socket.write(lines.join("\r\n") + (payload ?? ""));
  });
  return { status: response.status, json: () => JSON.parse(response.data.toString("utf8")) as unknown };
}

async function readConfig(): Promise<PanelConfig> {
  const [baseUrl, token, timeoutMs] = await Promise.all([
    getSetting("panel.base_url"),
    getSetting("panel.api_token"),
    getNumberSetting("panel.timeout_ms"),
  ]);
  if (!baseUrl || !token) {
    throw new PanelError("config", "未配置 3x-ui 面板地址或 API Token，请在后台「系统设置」中填写");
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), token, timeoutMs };
}

type Envelope = { success?: unknown; msg?: unknown; obj?: unknown };

/**
 * 本地接口白名单：节点域只允许调用这些接口（均在 3x-ui node-sync 范围内）。
 *
 * 部署时拿到的可能是 admin token（等同面板密码），不能指望 3x-ui 侧收窄权限，
 * 所以在发请求前自己拦一道：即使代码被误改去调 settings / 导出数据库等接口，也发不出去。
 * 新增调用时先确认该接口在 3x-ui `nodeSyncScopeAllow` 内，再加到这里。
 */
const ALLOWED_ENDPOINTS: ReadonlyArray<{ method: "GET" | "POST"; pattern: RegExp }> = [
  { method: "GET", pattern: /^server\/status$/ },
  { method: "GET", pattern: /^inbounds\/list$/ },
  { method: "POST", pattern: /^clients\/add$/ },
  { method: "POST", pattern: /^clients\/update\/[^/]+$/ },
  { method: "POST", pattern: /^clients\/[^/]+\/detach$/ },
  { method: "POST", pattern: /^clients\/del\/[^/]+$/ },
];

export function isAllowedPanelEndpoint(method: string, path: string): boolean {
  const bare = path.replace(/^\/+/, "").split("?")[0];
  return ALLOWED_ENDPOINTS.some((rule) => rule.method === method && rule.pattern.test(bare));
}

async function panelRequest<T>(method: "GET" | "POST", path: string, body?: unknown, target?: PinnedPanelTarget): Promise<T> {
  if (!isAllowedPanelEndpoint(method, path)) {
    throw new PanelError("forbidden", `节点域不允许调用 3x-ui 接口：${method} ${path}`);
  }
  const config = target ?? await readConfig();
  const url = `${config.baseUrl}/panel/api/${path.replace(/^\/+/, "")}`;

  let response: { status: number; ok: boolean; json: () => Promise<unknown> };
  try {
    if (target) {
      const pinned = await pinnedRequest(new URL(url), method, config.token, target.certificateSha256, config.timeoutMs, body);
      response = { status: pinned.status, ok: pinned.status >= 200 && pinned.status < 300, json: async () => pinned.json() };
    } else {
      response = await fetch(url, {
        method,
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(config.timeoutMs),
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${config.token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }
  } catch (error) {
    if (error instanceof PanelError) throw error;
    const reason = error instanceof Error ? error.message : "无法连接";
    throw new PanelError("unreachable", `面板请求失败（${method} ${path}）：${reason}`);
  }

  if (response.status === 401) throw new PanelError("auth", "3x-ui 拒绝了 API Token（401），请检查 token 是否有效", 401);
  if (response.status === 403) throw new PanelError("forbidden", `3x-ui API Token 无权访问 ${path}（403），请确认 token 范围`, 403);
  if (response.status === 404) throw new PanelError("not_found", `3x-ui 接口不存在（404）：${path}，请检查 PANEL_BASE_URL 是否包含面板路径`, 404);
  if (!response.ok) throw new PanelError("unreachable", `3x-ui 返回 HTTP ${response.status}（${method} ${path}）`, response.status);

  let envelope: Envelope;
  try {
    envelope = (await response.json()) as Envelope;
  } catch {
    throw new PanelError("protocol", `3x-ui 响应不是 JSON（${method} ${path}）`, response.status);
  }
  if (typeof envelope !== "object" || envelope === null || typeof envelope.success !== "boolean") {
    throw new PanelError("protocol", `3x-ui 响应格式异常（${method} ${path}）`, response.status);
  }
  if (!envelope.success) {
    const msg = typeof envelope.msg === "string" && envelope.msg ? envelope.msg : "未知原因";
    throw new PanelError("rejected", `3x-ui 拒绝操作（${method} ${path}）：${msg}`, response.status);
  }
  return envelope.obj as T;
}

export type PanelServerStatus = {
  panelVersion: string;
  panelGuid: string;
  xrayState: string;
  xrayVersion: string;
  publicIpv4: string;
};

export async function getServerStatus(target?: PinnedPanelTarget): Promise<PanelServerStatus> {
  const obj = await panelRequest<Record<string, unknown> | null>("GET", "server/status", undefined, target);
  const xray = (obj?.xray ?? {}) as Record<string, unknown>;
  const publicIp = (obj?.publicIP ?? {}) as Record<string, unknown>;
  const ipv4 = String(publicIp.ipv4 ?? "");
  return {
    panelVersion: String(obj?.panelVersion ?? ""),
    panelGuid: String(obj?.panelGuid ?? ""),
    xrayState: String(xray.state ?? ""),
    xrayVersion: String(xray.version ?? ""),
    publicIpv4: ipv4 && ipv4 !== "N/A" ? ipv4 : "",
  };
}

/** 原始入站列表（含 clients 与 clientStats）。解析交给 ./inbounds.ts。 */
export async function listRawInbounds(target?: PinnedPanelTarget): Promise<unknown[]> {
  const obj = await panelRequest<unknown>("GET", "inbounds/list", undefined, target);
  if (!Array.isArray(obj)) throw new PanelError("protocol", "3x-ui inbounds/list 未返回数组");
  return obj;
}

/* ------------------------------------------------------------------ *
 * 客户端写操作（仅 Reconciler 调用）。email 固定为 u{userId}，仍按路径段编码。
 * ------------------------------------------------------------------ */

export type PanelClientBody = Record<string, unknown> & { email: string };

/** 创建客户端，或把已存在的客户端挂到更多入站（3x-ui 对已存在 email 复用原凭据）。 */
export async function addClient(client: PanelClientBody, inboundIds: number[], target?: PinnedPanelTarget): Promise<void> {
  await panelRequest("POST", "clients/add", { client, inboundIds }, target);
}

/** 改写客户端字段，作用于其已挂的全部入站；不改变挂载关系。 */
export async function updateClient(email: string, client: PanelClientBody, target?: PinnedPanelTarget): Promise<void> {
  await panelRequest("POST", `clients/update/${encodeURIComponent(email)}`, client, target);
}

export async function detachClient(email: string, inboundIds: number[], target?: PinnedPanelTarget): Promise<void> {
  await panelRequest("POST", `clients/${encodeURIComponent(email)}/detach`, { inboundIds }, target);
}

export async function deleteClient(email: string, target?: PinnedPanelTarget): Promise<void> {
  await panelRequest("POST", `clients/del/${encodeURIComponent(email)}`, undefined, target);
}
