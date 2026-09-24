/**
 * 由入站快照拼出客户端分享链接（docs/node-domain-design.md §4.6）。
 * 纯函数、零依赖；对照 3x-ui 前端的链接格式（v2rayN / Shadowrocket 兼容写法）。
 *
 * 第一版支持 vless / vmess / trojan，传输层覆盖 tcp(含 http 伪装) / ws / grpc / httpupgrade / xhttp / kcp，
 * 安全层覆盖 none / tls / reality。无法表达的组合返回 null，由调用方跳过该节点。
 */

type JsonObject = Record<string, unknown>;

export type LinkNode = {
  name: string;
  host: string;
  port: number;
  protocol: string;
  snapshot: JsonObject;
  /** VLESS 流控（如 xtls-rprx-vision），须与 3x-ui 中该用户客户端的 flow 一致，否则 xray 拒绝连接。 */
  flow?: string;
};

function obj(value: unknown): JsonObject {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as JsonObject;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed as JsonObject;
    } catch {
      // 忽略
    }
  }
  return {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function first(value: unknown): string {
  return Array.isArray(value) ? str(value[0]) : str(value);
}

/** 请求头取值：3x-ui 既有 `{ Host: "a" }` 也有 `{ Host: ["a"] }` 两种写法。 */
function header(headers: unknown, name: string): string {
  const map = obj(headers);
  const key = Object.keys(map).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? first(map[key]) : "";
}

type StreamParams = {
  network: string;
  security: string;
  /** 传输层与安全层参数，写入 URL 查询串（空值会被丢弃）。 */
  query: Array<[string, string]>;
  /** vmess JSON 需要的归一化字段。 */
  headerType: string;
  hostHeader: string;
  path: string;
  sni: string;
  alpn: string;
  fingerprint: string;
  /** 以下字段供 Clash 等结构化格式使用（URL 格式已编码在 query 里）。 */
  grpcServiceName: string;
  grpcMultiMode: boolean;
  realityPublicKey: string;
  realityShortId: string;
  allowInsecure: boolean;
};

export function streamParams(snapshot: JsonObject): StreamParams | null {
  const stream = obj(snapshot.streamSettings);
  const network = str(stream.network) || "tcp";
  const security = str(stream.security) || "none";
  const query: Array<[string, string]> = [["type", network]];
  let headerType = "none";
  let hostHeader = "";
  let path = "";
  let grpcServiceName = "";
  let grpcMultiMode = false;

  switch (network) {
    case "tcp": {
      const head = obj(obj(stream.tcpSettings).header);
      if (str(head.type) === "http") {
        const request = obj(head.request);
        headerType = "http";
        path = first(request.path);
        hostHeader = header(request.headers, "Host");
        query.push(["headerType", "http"], ["path", path], ["host", hostHeader]);
      }
      break;
    }
    case "ws": {
      const ws = obj(stream.wsSettings);
      path = str(ws.path);
      hostHeader = str(ws.host) || header(ws.headers, "Host");
      query.push(["path", path], ["host", hostHeader]);
      break;
    }
    case "grpc": {
      const grpc = obj(stream.grpcSettings);
      path = str(grpc.serviceName);
      grpcServiceName = path;
      grpcMultiMode = grpc.multiMode === true;
      query.push(["serviceName", path], ["authority", str(grpc.authority)], ["mode", grpcMultiMode ? "multi" : "gun"]);
      break;
    }
    case "httpupgrade": {
      const hu = obj(stream.httpupgradeSettings);
      path = str(hu.path);
      hostHeader = str(hu.host) || header(hu.headers, "Host");
      query.push(["path", path], ["host", hostHeader]);
      break;
    }
    case "xhttp": {
      const xh = obj(stream.xhttpSettings);
      path = str(xh.path);
      hostHeader = str(xh.host) || header(xh.headers, "Host");
      query.push(["path", path], ["host", hostHeader], ["mode", str(xh.mode) || "auto"]);
      break;
    }
    case "kcp": {
      const kcp = obj(stream.kcpSettings);
      headerType = str(obj(kcp.header).type) || "none";
      query.push(["headerType", headerType], ["seed", str(kcp.seed)]);
      break;
    }
    default:
      return null;
  }

  let sni = "";
  let alpn = "";
  let fingerprint = "";
  let realityPublicKey = "";
  let realityShortId = "";
  let allowInsecure = false;
  if (security === "tls") {
    const tls = obj(stream.tlsSettings);
    const extra = obj(tls.settings);
    sni = str(tls.serverName);
    alpn = Array.isArray(tls.alpn) ? tls.alpn.map(str).filter(Boolean).join(",") : "";
    fingerprint = str(extra.fingerprint) || str(tls.fingerprint);
    query.push(["security", "tls"], ["sni", sni], ["alpn", alpn], ["fp", fingerprint]);
    allowInsecure = extra.allowInsecure === true;
    if (allowInsecure) query.push(["allowInsecure", "1"]);
  } else if (security === "reality") {
    const reality = obj(stream.realitySettings);
    const extra = obj(reality.settings);
    const publicKey = str(extra.publicKey);
    if (!publicKey) return null; // 没有公钥的 Reality 客户端无法连接
    sni = first(reality.serverNames) || str(extra.serverName);
    fingerprint = str(extra.fingerprint) || "chrome";
    realityPublicKey = publicKey;
    realityShortId = first(reality.shortIds);
    query.push(
      ["security", "reality"],
      ["sni", sni],
      ["fp", fingerprint],
      ["pbk", publicKey],
      ["sid", first(reality.shortIds)],
      ["spx", str(extra.spiderX)],
    );
  } else if (security === "none") {
    query.push(["security", "none"]);
  } else {
    return null;
  }

  return {
    network,
    security,
    query: query.filter(([, value]) => value !== ""),
    headerType,
    hostHeader,
    path,
    sni,
    alpn,
    fingerprint,
    grpcServiceName,
    grpcMultiMode,
    realityPublicKey,
    realityShortId,
    allowInsecure,
  };
}

/** IPv6 地址在 URL authority 中需要方括号。 */
function formatHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function toQuery(pairs: Array<[string, string]>): string {
  return pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}

export function buildLink(node: LinkNode, uuid: string): string | null {
  if (!node.host || !Number.isInteger(node.port) || node.port < 1 || node.port > 65535) return null;
  const stream = streamParams(node.snapshot);
  if (!stream) return null;
  const authority = `${formatHost(node.host)}:${node.port}`;
  const fragment = `#${encodeURIComponent(node.name)}`;

  switch (node.protocol) {
    case "vless": {
      const encryption = str(obj(node.snapshot.settings).encryption) || "none";
      const flow: Array<[string, string]> = node.flow ? [["flow", node.flow]] : [];
      return `vless://${uuid}@${authority}?${toQuery([["encryption", encryption], ...flow, ...stream.query])}${fragment}`;
    }
    case "trojan":
      return `trojan://${encodeURIComponent(uuid)}@${authority}?${toQuery(stream.query)}${fragment}`;
    case "vmess": {
      const json = {
        v: "2",
        ps: node.name,
        add: node.host,
        port: String(node.port),
        id: uuid,
        aid: "0",
        scy: "auto",
        net: stream.network,
        type: stream.headerType,
        host: stream.hostHeader,
        path: stream.path,
        tls: stream.security === "tls" ? "tls" : "",
        sni: stream.sni,
        alpn: stream.alpn,
        fp: stream.fingerprint,
      };
      return `vmess://${Buffer.from(JSON.stringify(json), "utf8").toString("base64")}`;
    }
    default:
      return null;
  }
}

/** 不可用时下发的「提示节点」：客户端能正常解析并显示原因，而不是报错清空配置。 */
export function noticeLink(message: string): string {
  return `vless://00000000-0000-0000-0000-000000000000@127.0.0.1:1?encryption=none&type=tcp&security=none#${encodeURIComponent(message)}`;
}
