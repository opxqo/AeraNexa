/**
 * 3x-ui 入站数据的解析与快照。
 *
 * 纯函数、零依赖（不引入 server-only / 数据库），既给导入器用，也能被测试直接 import。
 */

import { createHash } from "node:crypto";

/** 导入器关心的入站字段。其余字段原样保留在快照里，供订阅渲染使用。 */
export type PanelInbound = {
  id: number;
  remark: string;
  protocol: string;
  port: number;
  listen: string;
  enable: boolean;
  tag: string;
  originNodeGuid: string;
  shareAddr: string;
  /** 已剔除客户端列表与服务端私钥，可安全落库。 */
  snapshot: Record<string, unknown>;
  snapshotHash: string;
};

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 旧版 3x-ui 把 settings / streamSettings / sniffing 存成 JSON 字符串，新版直接是对象。 */
function asJsonObject(value: unknown): JsonObject {
  if (isObject(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (isObject(parsed)) return parsed;
    } catch {
      // 非法 JSON 按空对象处理，由上层决定是否拒绝该入站。
    }
  }
  return {};
}

/**
 * 服务端机密字段。快照要进业务库、将来还要被订阅渲染读取，
 * 服务端私钥没有任何用途，只会扩大泄露面，一律剔除。
 * （客户端链接需要的是 Reality 公钥 / TLS 证书公开部分，不受影响。）
 */
const SECRET_KEYS = new Set(["privateKey", "secretKey", "keyFile", "key", "preSharedKey"]);

function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (!isObject(value)) return value;
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEYS.has(k)) continue;
    out[k] = stripSecrets(v);
  }
  return out;
}

/** 键排序后的 JSON，保证同一内容得到同一哈希。 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * 生成可落库的入站快照：
 * - 去掉 `settings.clients` / `settings.peers` 与 `clientStats`（用户数据，由同步器单独维护，且会让哈希随流量抖动）；
 * - 去掉 up / down / 流量重置时间等计数字段（同理）；
 * - 去掉服务端私钥。
 */
export function buildInboundSnapshot(raw: JsonObject): JsonObject {
  const settings = { ...asJsonObject(raw.settings) };
  delete settings.clients;
  delete settings.peers;

  return stripSecrets({
    id: raw.id,
    remark: raw.remark,
    protocol: raw.protocol,
    listen: raw.listen,
    port: raw.port,
    tag: raw.tag,
    enable: raw.enable,
    shareAddr: raw.shareAddr,
    shareAddrStrategy: raw.shareAddrStrategy,
    originNodeGuid: raw.originNodeGuid,
    nodeId: raw.nodeId ?? null,
    settings,
    streamSettings: asJsonObject(raw.streamSettings),
    sniffing: asJsonObject(raw.sniffing),
  }) as JsonObject;
}

export function hashSnapshot(snapshot: JsonObject): string {
  return createHash("sha256").update(canonicalJson(snapshot)).digest("hex");
}

const PROTOCOL_PATTERN = /^[a-z0-9_-]{2,32}$/;

/**
 * 校验并规整 `GET /panel/api/inbounds/list` 的单个元素。
 * 结构不符合预期时返回 null（由导入器计入 skipped），而不是抛错中断整批导入。
 */
export function parseInbound(raw: unknown): PanelInbound | null {
  if (!isObject(raw)) return null;
  const id = Number(raw.id);
  const port = Number(raw.port);
  const protocol = String(raw.protocol ?? "").toLowerCase();
  if (!Number.isInteger(id) || id <= 0) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (!PROTOCOL_PATTERN.test(protocol)) return null;

  const snapshot = buildInboundSnapshot(raw);
  return {
    id,
    remark: String(raw.remark ?? "").trim(),
    protocol,
    port,
    listen: String(raw.listen ?? "").trim(),
    enable: raw.enable !== false,
    tag: String(raw.tag ?? ""),
    originNodeGuid: String(raw.originNodeGuid ?? "").trim(),
    shareAddr: String(raw.shareAddr ?? "").trim(),
    snapshot,
    snapshotHash: hashSnapshot(snapshot),
  };
}

const WILDCARD_LISTEN = new Set(["", "0.0.0.0", "::", "[::]"]);

/**
 * 新导入节点的默认对外地址。只在首次导入时使用，之后由管理员在后台维护。
 * 优先级：入站显式配置的分享地址 → 非通配的监听地址 → 主控公网 IP（仅限主控本机入站）→ 空。
 */
export function defaultPublicHost(inbound: PanelInbound, master: { panelGuid: string; publicIp: string }): string {
  if (inbound.shareAddr) return inbound.shareAddr;
  if (!WILDCARD_LISTEN.has(inbound.listen) && !inbound.listen.startsWith("/")) return inbound.listen;
  const onMaster = !inbound.originNodeGuid || inbound.originNodeGuid === master.panelGuid;
  return onMaster ? master.publicIp : "";
}
