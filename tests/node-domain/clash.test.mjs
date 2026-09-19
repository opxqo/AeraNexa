/**
 * Clash / Mihomo 订阅（src/lib/server/panel/clash.ts）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildClashProxy, clashNoticeProxy, renderClashConfig, wantsClash } from "../../src/lib/server/panel/clash.ts";

const UUID = "3f1c2b8e-0000-4000-8000-000000000001";

function node(protocol, streamSettings, extra = {}) {
  return {
    name: "🇺🇸 US 01",
    host: "31.105.200.41",
    port: 27205,
    protocol,
    snapshot: { protocol, settings: { encryption: "none" }, streamSettings },
    ...extra,
  };
}

test("VLESS + TCP 明文：用 AeraNexa 的对外地址与节点名，不带内部账号信息", () => {
  const proxy = buildClashProxy(node("vless", { network: "tcp", security: "none", tcpSettings: { header: { type: "none" } } }), UUID);
  assert.deepEqual(proxy, {
    name: "🇺🇸 US 01", server: "31.105.200.41", port: 27205, udp: true, type: "vless", uuid: UUID, tls: false,
  });
});

test("VLESS + Reality：servername / client-fingerprint / reality-opts", () => {
  const proxy = buildClashProxy(node("vless", {
    network: "tcp",
    security: "reality",
    realitySettings: { serverNames: ["www.microsoft.com"], shortIds: ["6ba8"], settings: { publicKey: "PUB", fingerprint: "chrome" } },
  }), UUID);
  assert.equal(proxy.tls, true);
  assert.equal(proxy.servername, "www.microsoft.com");
  assert.equal(proxy["client-fingerprint"], "chrome");
  assert.deepEqual(proxy["reality-opts"], { "public-key": "PUB", "short-id": "6ba8" });
  assert.equal(proxy.network, undefined, "tcp 不写 network");
});

test("Trojan + WS + TLS：password、sni、ws-opts.headers.Host、alpn 数组", () => {
  const proxy = buildClashProxy(node("trojan", {
    network: "ws",
    security: "tls",
    wsSettings: { path: "/ray", headers: { Host: "cdn.example.com" } },
    tlsSettings: { serverName: "cdn.example.com", alpn: ["h2", "http/1.1"] },
  }), UUID);
  assert.equal(proxy.type, "trojan");
  assert.equal(proxy.password, UUID);
  assert.equal(proxy.sni, "cdn.example.com");
  assert.equal(proxy.servername, undefined);
  assert.equal(proxy.tls, undefined, "trojan 不写 tls 字段");
  assert.equal(proxy.network, "ws");
  assert.deepEqual(proxy["ws-opts"], { path: "/ray", headers: { Host: "cdn.example.com" } });
  assert.deepEqual(proxy.alpn, ["h2", "http/1.1"]);
});

test("VMess + gRPC；httpupgrade 转成 ws + v2ray-http-upgrade；TCP HTTP 伪装转 http-opts", () => {
  const vmess = buildClashProxy(node("vmess", { network: "grpc", security: "tls", grpcSettings: { serviceName: "svc" }, tlsSettings: {} }), UUID);
  assert.equal(vmess.type, "vmess");
  assert.equal(vmess.alterId, 0);
  assert.equal(vmess.cipher, "auto");
  assert.deepEqual(vmess["grpc-opts"], { "grpc-service-name": "svc" });

  const hu = buildClashProxy(node("vless", { network: "httpupgrade", security: "none", httpupgradeSettings: { path: "/up", host: "h" } }), UUID);
  assert.equal(hu.network, "ws");
  assert.deepEqual(hu["ws-opts"], { path: "/up", headers: { Host: "h" }, "v2ray-http-upgrade": true });

  const http = buildClashProxy(node("vless", {
    network: "tcp", security: "none",
    tcpSettings: { header: { type: "http", request: { path: ["/a"], headers: { Host: ["h.example.com"] } } } },
  }), UUID);
  assert.equal(http.network, "http");
  assert.deepEqual(http["http-opts"], { method: "GET", path: ["/a"], headers: { Host: ["h.example.com"] } });
});

test("不支持的组合返回 null：xhttp、kcp、无 TLS 的 Trojan、未知协议、缺地址", () => {
  assert.equal(buildClashProxy(node("vless", { network: "xhttp", security: "none" }), UUID), null);
  assert.equal(buildClashProxy(node("vless", { network: "kcp", security: "none" }), UUID), null);
  assert.equal(buildClashProxy(node("trojan", { network: "tcp", security: "none" }), UUID), null);
  assert.equal(buildClashProxy(node("shadowsocks", { network: "tcp" }), UUID), null);
  assert.equal(buildClashProxy(node("vless", { network: "tcp" }, { host: "" }), UUID), null);
});

test("完整配置：代理名去重、分组引用、MATCH 走节点选择", () => {
  const proxy = buildClashProxy(node("vless", { network: "tcp", security: "none" }), UUID);
  const yaml = renderClashConfig([proxy, proxy]);
  const lines = yaml.split("\n");
  assert.equal(lines[0], "mixed-port: 7890");
  const proxies = lines.filter((line) => line.startsWith("  - {\"name\"") && line.includes("\"type\":\"vless\"")).map((line) => JSON.parse(line.slice(4)));
  assert.deepEqual(proxies.map((p) => p.name), ["🇺🇸 US 01", "🇺🇸 US 01 2"]);
  const groups = lines.filter((line) => line.includes("\"type\":\"select\"") || line.includes("\"type\":\"url-test\"")).map((line) => JSON.parse(line.slice(4)));
  assert.deepEqual(groups[0].proxies, ["自动选择", "🇺🇸 US 01", "🇺🇸 US 01 2", "DIRECT"]);
  assert.deepEqual(groups[1].proxies, ["🇺🇸 US 01", "🇺🇸 US 01 2"]);
  assert.ok(yaml.includes('  - "MATCH,节点选择"'));
});

test("提示节点可放进配置", () => {
  const yaml = renderClashConfig([clashNoticeProxy("套餐已到期，请续费")]);
  assert.ok(yaml.includes('"name":"套餐已到期，请续费"'));
});

test("识别 Clash 客户端：flag 优先，其次 User-Agent", () => {
  assert.equal(wantsClash("clash", null), true);
  assert.equal(wantsClash("meta", "v2rayN/6.0"), true);
  assert.equal(wantsClash("v2ray", "clash-verge/1.0"), false, "显式 flag 覆盖 UA");
  assert.equal(wantsClash(null, "ClashforWindows/0.20.39"), true);
  assert.equal(wantsClash(null, "mihomo/1.18.0"), true);
  assert.equal(wantsClash(null, "Stash/2.4.0 Clash/1.9.0"), true);
  assert.equal(wantsClash(null, "Shadowrocket/2070"), false);
  assert.equal(wantsClash(null, null), false);
});
