/**
 * 3x-ui 入站解析与快照（src/lib/server/panel/inbounds.ts）。
 * 纯函数测试，不需要数据库、Next.js 或 3x-ui。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildInboundSnapshot,
  defaultPublicHost,
  hashSnapshot,
  inboundManagedNodeFieldsMatch,
  inboundManagedNodeFields,
  parseInbound,
} from "../../src/lib/server/panel/inbounds.ts";

/** 形状取自本地 3x-ui 3.8.5 的 inbounds/list 真实响应，并补上客户端与 Reality 配置。 */
function realityInbound(overrides = {}) {
  return {
    id: 7,
    up: 123,
    down: 456,
    total: 0,
    remark: "🇺🇸 US-Reality",
    enable: true,
    expiryTime: 0,
    lastTrafficResetTime: 0,
    listen: "",
    port: 443,
    protocol: "vless",
    tag: "in-443-tcp",
    shareAddrStrategy: "listen",
    shareAddr: "",
    originNodeGuid: "master-guid",
    clientStats: [{ email: "u1", up: 10, down: 20, total: 0, enable: true, inboundId: 7 }],
    settings: {
      clients: [{ email: "u1", id: "11111111-1111-1111-1111-111111111111", flow: "xtls-rprx-vision" }],
      decryption: "none",
    },
    streamSettings: {
      network: "tcp",
      security: "reality",
      realitySettings: {
        privateKey: "SERVER-PRIVATE-KEY",
        shortIds: ["abcd"],
        serverNames: ["www.example.com"],
        settings: { publicKey: "PUBLIC-KEY", fingerprint: "chrome" },
      },
      tlsSettings: { certificates: [{ certificateFile: "/cert.pem", keyFile: "/key.pem", key: ["-----BEGIN PRIVATE KEY-----"] }] },
    },
    sniffing: { enabled: false },
    ...overrides,
  };
}

test("快照剔除客户端、流量计数与服务端私钥，保留生成链接所需的公开参数", () => {
  const inbound = parseInbound(realityInbound());
  assert.ok(inbound);
  const json = JSON.stringify(inbound.snapshot);

  assert.equal(inbound.snapshot.settings.clients, undefined);
  assert.equal(inbound.snapshot.clientStats, undefined);
  assert.equal(inbound.snapshot.up, undefined);
  assert.ok(!json.includes("SERVER-PRIVATE-KEY"), "Reality 私钥不能落库");
  assert.ok(!json.includes("BEGIN PRIVATE KEY"), "TLS 私钥不能落库");
  assert.ok(!json.includes("/key.pem"), "私钥路径不能落库");
  assert.ok(!json.includes("11111111-1111"), "用户 UUID 不能进入入站快照");

  assert.equal(inbound.snapshot.streamSettings.realitySettings.settings.publicKey, "PUBLIC-KEY");
  assert.deepEqual(inbound.snapshot.streamSettings.realitySettings.shortIds, ["abcd"]);
  assert.equal(inbound.snapshot.streamSettings.tlsSettings.certificates[0].certificateFile, "/cert.pem");
});

test("流量与客户端变化不改变哈希；入站配置变化会改变哈希", () => {
  const base = parseInbound(realityInbound());
  const moreTraffic = parseInbound(realityInbound({
    up: 999_999,
    down: 999_999,
    clientStats: [],
    settings: { clients: [{ email: "u2", id: "x" }], decryption: "none" },
  }));
  const newPort = parseInbound(realityInbound({ port: 8443 }));

  assert.equal(moreTraffic.snapshotHash, base.snapshotHash);
  assert.notEqual(newPort.snapshotHash, base.snapshotHash);
});

test("哈希与键顺序无关", () => {
  assert.equal(hashSnapshot({ a: 1, b: { c: 2, d: [1, 2] } }), hashSnapshot({ b: { d: [1, 2], c: 2 }, a: 1 }));
  assert.notEqual(hashSnapshot({ a: [1, 2] }), hashSnapshot({ a: [2, 1] }));
});

test("兼容旧版把 settings / streamSettings 存成 JSON 字符串", () => {
  const raw = realityInbound();
  const inbound = parseInbound({
    ...raw,
    settings: JSON.stringify(raw.settings),
    streamSettings: JSON.stringify(raw.streamSettings),
  });
  assert.ok(inbound);
  assert.equal(inbound.snapshot.settings.clients, undefined);
  assert.equal(inbound.snapshot.streamSettings.realitySettings.privateKey, undefined);
  assert.equal(inbound.snapshotHash, parseInbound(raw).snapshotHash);
});

test("结构异常的入站返回 null 而不是抛错", () => {
  assert.equal(parseInbound(null), null);
  assert.equal(parseInbound("x"), null);
  assert.equal(parseInbound(realityInbound({ id: 0 })), null);
  assert.equal(parseInbound(realityInbound({ port: 70000 })), null);
  assert.equal(parseInbound(realityInbound({ protocol: "VLESS; DROP" })), null);
});

test("协议统一小写，remark 去空白", () => {
  const inbound = parseInbound(realityInbound({ protocol: "VLESS", remark: "  HK-01  " }));
  assert.equal(inbound.protocol, "vless");
  assert.equal(inbound.remark, "HK-01");
});

test("同步入站时，3x-ui 管理节点名称、协议和服务端口；对外地址不在此模型中", () => {
  const inbound = parseInbound(realityInbound({
    remark: "  🇺🇸 Static Residential N  ",
    protocol: "VLESS",
    port: 27205,
  }));
  assert.ok(inbound);

  assert.deepEqual(inboundManagedNodeFields(inbound), {
    name: "🇺🇸 Static Residential N",
    protocol: "vless",
    serverPort: 27205,
  });
  assert.equal(inboundManagedNodeFieldsMatch({
    name: "旧名称",
    protocol: "vless",
    serverPort: 27205,
  }, inbound), false, "旧名称不能因快照哈希相同而被跳过");
  assert.equal(inboundManagedNodeFieldsMatch({
    name: "🇺🇸 Static Residential N",
    protocol: "vless",
    serverPort: 27205,
  }, inbound), true);
});

test("默认对外地址：分享地址 → 具体监听地址 → 主控公网 IP（仅主控本机入站）→ 空", () => {
  const master = { panelGuid: "master-guid", publicIp: "203.0.113.9" };
  const make = (overrides) => parseInbound(realityInbound(overrides));

  assert.equal(defaultPublicHost(make({ shareAddr: "hk.example.com", listen: "10.0.0.1" }), master), "hk.example.com");
  assert.equal(defaultPublicHost(make({ listen: "10.0.0.1" }), master), "10.0.0.1");
  assert.equal(defaultPublicHost(make({ listen: "0.0.0.0" }), master), "203.0.113.9");
  assert.equal(defaultPublicHost(make({ listen: "/run/xray.sock" }), master), "203.0.113.9");
  assert.equal(defaultPublicHost(make({ originNodeGuid: "" }), master), "203.0.113.9");
  assert.equal(defaultPublicHost(make({ originNodeGuid: "remote-node-guid" }), master), "", "子节点入站不能套用主控 IP");
});

test("buildInboundSnapshot 不修改入参", () => {
  const raw = realityInbound();
  const before = JSON.stringify(raw);
  buildInboundSnapshot(raw);
  assert.equal(JSON.stringify(raw), before);
});
