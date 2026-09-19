/**
 * Clash / Mihomo 订阅（YAML）。纯函数、零依赖，与 ./links.ts 共用入站参数解析。
 *
 * 为什么不直接转发 3x-ui 自带的 Clash 订阅：它不知道 AeraNexa 维护的对外地址（输出 server: localhost）、
 * 节点名会带上 `-u{id}|⏳29D` 这类内部信息、额度按 3x-ui 口径（不限量）显示为 0。
 *
 * 输出只用 JSON 兼容的「流式」写法表达每个代理 / 分组（JSON 是合法 YAML），
 * 避免手写块式 YAML 时的转义与缩进问题；顶层保持块式，便于人工阅读。
 */

import { streamParams, type LinkNode } from "./links";

type ClashProxy = Record<string, unknown> & { name: string };

/** 不支持的组合返回 null（例如 xhttp / kcp：Clash 系客户端支持参差，宁可不下发）。 */
export function buildClashProxy(node: LinkNode, uuid: string): ClashProxy | null {
  if (!node.host || !Number.isInteger(node.port) || node.port < 1 || node.port > 65535) return null;
  const stream = streamParams(node.snapshot);
  if (!stream) return null;
  if (!["tcp", "ws", "grpc", "httpupgrade"].includes(stream.network)) return null;

  const proxy: ClashProxy = { name: node.name, server: node.host, port: node.port, udp: true };
  switch (node.protocol) {
    case "vless":
      Object.assign(proxy, { type: "vless", uuid });
      break;
    case "vmess":
      Object.assign(proxy, { type: "vmess", uuid, alterId: 0, cipher: "auto" });
      break;
    case "trojan":
      Object.assign(proxy, { type: "trojan", password: uuid });
      break;
    default:
      return null;
  }

  // 传输层。httpupgrade 在 mihomo 中表达为 ws + v2ray-http-upgrade。
  const network = stream.network === "httpupgrade" ? "ws" : stream.network;
  if (network !== "tcp" || stream.headerType === "http") proxy.network = network === "tcp" ? "http" : network;
  if (network === "ws") {
    const wsOpts: Record<string, unknown> = { path: stream.path || "/" };
    if (stream.hostHeader) wsOpts.headers = { Host: stream.hostHeader };
    if (stream.network === "httpupgrade") wsOpts["v2ray-http-upgrade"] = true;
    proxy["ws-opts"] = wsOpts;
  } else if (network === "grpc") {
    proxy["grpc-opts"] = { "grpc-service-name": stream.grpcServiceName };
  } else if (stream.headerType === "http") {
    const httpOpts: Record<string, unknown> = { method: "GET", path: [stream.path || "/"] };
    if (stream.hostHeader) httpOpts.headers = { Host: [stream.hostHeader] };
    proxy["http-opts"] = httpOpts;
  }

  // 安全层。trojan 的 SNI 字段名是 sni，vless / vmess 是 servername。
  const sniKey = node.protocol === "trojan" ? "sni" : "servername";
  if (stream.security === "tls" || stream.security === "reality") {
    if (node.protocol !== "trojan") proxy.tls = true;
    if (stream.sni) proxy[sniKey] = stream.sni;
    if (stream.fingerprint) proxy["client-fingerprint"] = stream.fingerprint;
    if (stream.alpn) proxy.alpn = stream.alpn.split(",");
    if (stream.allowInsecure) proxy["skip-cert-verify"] = true;
  } else if (node.protocol === "trojan") {
    return null; // Trojan 必须有 TLS
  } else {
    proxy.tls = false;
  }
  if (stream.security === "reality") {
    proxy["reality-opts"] = { "public-key": stream.realityPublicKey, "short-id": stream.realityShortId };
  }

  return proxy;
}

/** YAML 流式写法：JSON.stringify 的结果是合法的 YAML 1.2。 */
function flow(value: unknown): string {
  return JSON.stringify(value);
}

const PROXY_GROUP = "节点选择";
const AUTO_GROUP = "自动选择";

/** 不可用时的提示节点：指向本机不可达端口，名称即原因，客户端能正常导入并显示。 */
export function clashNoticeProxy(message: string): ClashProxy {
  return { name: message, type: "vless", server: "127.0.0.1", port: 1, uuid: "00000000-0000-0000-0000-000000000000", udp: false, tls: false };
}

export function renderClashConfig(proxies: ClashProxy[]): string {
  // Clash 要求代理名唯一：重名时追加序号。
  const seen = new Map<string, number>();
  const unique = proxies.map((proxy) => {
    const count = (seen.get(proxy.name) ?? 0) + 1;
    seen.set(proxy.name, count);
    return count === 1 ? proxy : { ...proxy, name: `${proxy.name} ${count}` };
  });
  const names = unique.map((proxy) => proxy.name);

  const groups = [
    { name: PROXY_GROUP, type: "select", proxies: [AUTO_GROUP, ...names, "DIRECT"] },
    { name: AUTO_GROUP, type: "url-test", proxies: names, url: "https://www.gstatic.com/generate_204", interval: 300, tolerance: 50 },
  ];
  const rules = [
    "DOMAIN-SUFFIX,local,DIRECT",
    "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR,172.16.0.0/12,DIRECT,no-resolve",
    "IP-CIDR,192.168.0.0/16,DIRECT,no-resolve",
    "IP-CIDR,100.64.0.0/10,DIRECT,no-resolve",
    "GEOIP,CN,DIRECT",
    `MATCH,${PROXY_GROUP}`,
  ];

  return [
    "mixed-port: 7890",
    "allow-lan: false",
    "mode: rule",
    "log-level: info",
    "proxies:",
    ...unique.map((proxy) => `  - ${flow(proxy)}`),
    "proxy-groups:",
    ...groups.map((group) => `  - ${flow(group)}`),
    "rules:",
    ...rules.map((rule) => `  - ${flow(rule)}`),
    "",
  ].join("\n");
}

/** 判定客户端是否要 Clash 格式：显式 flag 优先，其次按 User-Agent 识别。 */
const CLASH_FLAGS = new Set(["clash", "meta", "mihomo", "stash"]);
const CLASH_UA = /clash|mihomo|stash|nyanpasu|verge/i;

export function wantsClash(flag: string | null, userAgent: string | null): boolean {
  if (flag) return CLASH_FLAGS.has(flag.toLowerCase());
  return CLASH_UA.test(userAgent ?? "");
}
