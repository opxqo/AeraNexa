/**
 * 分享链接拼装（src/lib/server/panel/links.ts）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLink, noticeLink } from "../../src/lib/server/panel/links.ts";

const UUID = "3f1c2b8e-0000-4000-8000-000000000001";

function node(protocol, streamSettings, extra = {}) {
  return {
    name: "🇺🇸 US 01",
    host: "us.example.com",
    port: 443,
    protocol,
    snapshot: { protocol, settings: { decryption: "none", encryption: "none" }, streamSettings },
    ...extra,
  };
}

function parse(link) {
  const url = new URL(link);
  return { url, q: Object.fromEntries(url.searchParams) };
}

test("VLESS + TCP 明文（与本地 3x-ui 测试入站一致）", () => {
  const link = buildLink(node("vless", { network: "tcp", security: "none", tcpSettings: { header: { type: "none" } } }), UUID);
  const { url, q } = parse(link);
  assert.equal(url.protocol, "vless:");
  assert.equal(url.username, UUID);
  assert.equal(url.hostname, "us.example.com");
  assert.equal(url.port, "443");
  assert.deepEqual(q, { encryption: "none", type: "tcp", security: "none" });
  assert.equal(decodeURIComponent(url.hash.slice(1)), "🇺🇸 US 01");
});

test("VLESS + Reality：带 pbk / sid / sni / fp，不泄露私钥", () => {
  const link = buildLink(node("vless", {
    network: "tcp",
    security: "reality",
    realitySettings: {
      serverNames: ["www.microsoft.com", "b.com"],
      shortIds: ["6ba85179e30d4fc2", ""],
      settings: { publicKey: "PUBKEY", fingerprint: "firefox", spiderX: "/" },
    },
  }), UUID);
  const { q } = parse(link);
  assert.equal(q.security, "reality");
  assert.equal(q.pbk, "PUBKEY");
  assert.equal(q.sid, "6ba85179e30d4fc2");
  assert.equal(q.sni, "www.microsoft.com");
  assert.equal(q.fp, "firefox");
  assert.equal(q.spx, "/");
});

test("VLESS 流控：node.flow 有值才带 flow，其余协议不受影响", () => {
  const reality = {
    network: "tcp",
    security: "reality",
    realitySettings: { serverNames: ["a.com"], shortIds: ["01"], settings: { publicKey: "PUBKEY" } },
  };
  assert.equal(parse(buildLink(node("vless", reality, { flow: "xtls-rprx-vision" }), UUID)).q.flow, "xtls-rprx-vision");
  assert.equal(parse(buildLink(node("vless", reality), UUID)).q.flow, undefined);
  const trojan = buildLink(node("trojan", { network: "tcp", security: "tls", tlsSettings: { serverName: "a.com" } }, { flow: "xtls-rprx-vision" }), UUID);
  assert.equal(parse(trojan).q.flow, undefined);
});

test("Reality 缺公钥 → 返回 null（客户端无法连接，宁可不下发）", () => {
  assert.equal(buildLink(node("vless", { network: "tcp", security: "reality", realitySettings: { settings: {} } }), UUID), null);
});

test("Trojan + WS + TLS", () => {
  const link = buildLink(node("trojan", {
    network: "ws",
    security: "tls",
    wsSettings: { path: "/ray?ed=2048", headers: { Host: "cdn.example.com" } },
    tlsSettings: { serverName: "cdn.example.com", alpn: ["h2", "http/1.1"], settings: { fingerprint: "chrome" } },
  }), UUID);
  const { url, q } = parse(link);
  assert.equal(url.protocol, "trojan:");
  assert.equal(url.username, UUID);
  assert.equal(q.type, "ws");
  assert.equal(q.path, "/ray?ed=2048");
  assert.equal(q.host, "cdn.example.com");
  assert.equal(q.alpn, "h2,http/1.1");
  assert.equal(q.fp, "chrome");
});

test("VMess + gRPC：base64 JSON，path 取 serviceName", () => {
  const link = buildLink(node("vmess", {
    network: "grpc",
    security: "tls",
    grpcSettings: { serviceName: "svc", multiMode: true },
    tlsSettings: { serverName: "g.example.com" },
  }), UUID);
  assert.ok(link.startsWith("vmess://"));
  const json = JSON.parse(Buffer.from(link.slice(8), "base64").toString("utf8"));
  assert.equal(json.id, UUID);
  assert.equal(json.add, "us.example.com");
  assert.equal(json.port, "443");
  assert.equal(json.net, "grpc");
  assert.equal(json.path, "svc");
  assert.equal(json.tls, "tls");
  assert.equal(json.sni, "g.example.com");
  assert.equal(json.ps, "🇺🇸 US 01");
});

test("TCP HTTP 伪装：headerType / path / host", () => {
  const { q } = parse(buildLink(node("vless", {
    network: "tcp",
    security: "none",
    tcpSettings: { header: { type: "http", request: { path: ["/a"], headers: { Host: ["h.example.com"] } } } },
  }), UUID));
  assert.equal(q.headerType, "http");
  assert.equal(q.path, "/a");
  assert.equal(q.host, "h.example.com");
});

test("IPv6 地址加方括号；缺地址 / 不支持的协议或传输返回 null", () => {
  const v6 = buildLink(node("vless", { network: "tcp", security: "none" }, { host: "2001:db8::1" }), UUID);
  assert.ok(v6.includes("@[2001:db8::1]:443?"));
  assert.equal(buildLink(node("vless", { network: "tcp" }, { host: "" }), UUID), null);
  assert.equal(buildLink(node("shadowsocks", { network: "tcp" }), UUID), null);
  assert.equal(buildLink(node("vless", { network: "quic" }), UUID), null);
  assert.equal(buildLink(node("vless", { network: "tcp", security: "xtls" }), UUID), null);
});

test("提示节点可被解析，名称即提示文案", () => {
  const url = new URL(noticeLink("套餐已到期"));
  assert.equal(url.protocol, "vless:");
  assert.equal(decodeURIComponent(url.hash.slice(1)), "套餐已到期");
});
