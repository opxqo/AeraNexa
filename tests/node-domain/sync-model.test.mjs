/**
 * 同步纯函数（src/lib/server/panel/sync-model.ts）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectActualClients,
  computeDesiredClient,
  diffClient,
  isEligible,
} from "../../src/lib/server/panel/sync-model.ts";

const NOW = 1_800_000_000;
const UUID = "3f1c2b8e-0000-4000-8000-000000000001";

function user(overrides = {}) {
  return {
    userId: 7,
    email: "alice@example.com",
    uuid: UUID,
    isActive: true,
    planId: 1,
    expiredAt: NOW + 86_400,
    transferEnable: 100 * 1024 ** 3,
    usedBytes: 0,
    subId: "abcdef0123456789",
    deviceLimit: 0,
    inboundIds: [3, 1],
    ...overrides,
  };
}

function actualFrom(desired, overrides = {}) {
  const c = desired.client;
  return {
    email: c.email, id: c.id, subId: c.subId, enable: c.enable, expiryTime: c.expiryTime,
    totalGB: c.totalGB, limitIp: c.limitIp, comment: c.comment, inboundIds: [...desired.inboundIds], ...overrides,
  };
}

test("资格：有套餐、未到期、有额度、未封禁", () => {
  assert.equal(isEligible(user(), NOW), true);
  assert.equal(isEligible(user({ expiredAt: null }), NOW), true, "一次性套餐永久有效");
  assert.equal(isEligible(user({ expiredAt: NOW }), NOW), false, "到期时刻即失效");
  assert.equal(isEligible(user({ isActive: false }), NOW), false);
  assert.equal(isEligible(user({ planId: null }), NOW), false);
  assert.equal(isEligible(user({ transferEnable: 0 }), NOW), false);
  assert.equal(isEligible(user({ usedBytes: 100 * 1024 ** 3 }), NOW), false, "用满即停");
});

test("期望状态：email=u{id}、同一 UUID、3x-ui 不限量、到期毫秒、入站去重排序", () => {
  const desired = computeDesiredClient(user({ inboundIds: [3, 1, 3] }), NOW);
  assert.equal(desired.client.email, "u7");
  assert.equal(desired.client.id, UUID);
  assert.equal(desired.client.password, UUID);
  assert.equal(desired.client.totalGB, 0);
  assert.equal(desired.client.expiryTime, (NOW + 86_400) * 1000);
  assert.equal(computeDesiredClient(user({ expiredAt: null }), NOW).client.expiryTime, 0);
  assert.deepEqual(desired.inboundIds, [1, 3]);
});

test("设备数上限下发为 limitIp；0 不限；非法值按 0；修改会触发 update", () => {
  assert.equal(computeDesiredClient(user({ deviceLimit: 3 }), NOW).client.limitIp, 3);
  assert.equal(computeDesiredClient(user({ deviceLimit: 0 }), NOW).client.limitIp, 0);
  assert.equal(computeDesiredClient(user({ deviceLimit: Number.NaN }), NOW).client.limitIp, 0);
  const desired = computeDesiredClient(user({ deviceLimit: 2 }), NOW);
  assert.deepEqual(diffClient("u7", desired, actualFrom(desired, { limitIp: 0 })).map((op) => op.type), ["update"]);
});

test("备注写入用户邮箱；邮箱变化触发 update，但客户端标识仍是 u{id}", () => {
  const desired = computeDesiredClient(user(), NOW);
  assert.equal(desired.client.comment, "AeraNexa · alice@example.com");
  assert.equal(desired.client.email, "u7");
  const renamed = computeDesiredClient(user({ email: "bob@example.com" }), NOW);
  assert.deepEqual(diffClient("u7", renamed, actualFrom(desired)).map((op) => op.type), ["update"]);
  assert.equal(computeDesiredClient(user({ email: "" }), NOW).client.comment, "AeraNexa");
});

test("没有套餐或没有可用节点 → 不应存在客户端；到期只是停用", () => {
  assert.equal(computeDesiredClient(user({ planId: null }), NOW), null);
  assert.equal(computeDesiredClient(user({ inboundIds: [] }), NOW), null);
  const expired = computeDesiredClient(user({ expiredAt: NOW - 1 }), NOW);
  assert.equal(expired.client.enable, false);
  assert.deepEqual(expired.inboundIds, [1, 3], "到期保留挂载，续费后一次 update 即可恢复");
});

test("diff：不存在 → 一次 add 挂全部入站", () => {
  const desired = computeDesiredClient(user(), NOW);
  assert.deepEqual(diffClient("u7", desired, null), [{ type: "add", email: "u7", client: desired.client, inboundIds: [1, 3] }]);
});

test("diff：一致 → 无操作", () => {
  const desired = computeDesiredClient(user(), NOW);
  assert.deepEqual(diffClient("u7", desired, actualFrom(desired)), []);
});

test("diff：顺序为 add（缺的）→ update（字段）→ detach（多的）", () => {
  const desired = computeDesiredClient(user({ inboundIds: [1, 3] }), NOW);
  const actual = actualFrom(desired, { inboundIds: [3, 9], enable: false });
  const ops = diffClient("u7", desired, actual);
  assert.deepEqual(ops.map((op) => op.type), ["add", "update", "detach"]);
  assert.deepEqual(ops[0].inboundIds, [1]);
  assert.deepEqual(ops[2].inboundIds, [9]);
});

test("diff：UUID 轮换（重置安全信息）触发 update", () => {
  const desired = computeDesiredClient(user(), NOW);
  const ops = diffClient("u7", desired, actualFrom(desired, { id: "old-uuid" }));
  assert.deepEqual(ops.map((op) => op.type), ["update"]);
});

test("diff：3x-ui 侧被手工改了额度 / 到期也会被纠正", () => {
  const desired = computeDesiredClient(user(), NOW);
  assert.equal(diffClient("u7", desired, actualFrom(desired, { totalGB: 5 }))[0].type, "update");
  assert.equal(diffClient("u7", desired, actualFrom(desired, { expiryTime: 1 }))[0].type, "update");
});

test("diff：不应存在但存在 → delete；都不存在 → 无操作", () => {
  const desired = computeDesiredClient(user(), NOW);
  assert.deepEqual(diffClient("u7", null, actualFrom(desired)), [{ type: "delete", email: "u7" }]);
  assert.deepEqual(diffClient("u7", null, null), []);
});

test("实际状态：只收 u{数字} 客户端，按 email 合并多个入站，兼容 settings 字符串", () => {
  const actual = collectActualClients([
    { id: 3, settings: { clients: [{ email: "u7", id: UUID, enable: true, subId: "s", expiryTime: 5 }, { email: "admin-manual", id: "x" }] } },
    { id: 1, settings: JSON.stringify({ clients: [{ email: "u7", id: UUID }, { email: "u8", password: "p", enable: false }] }) },
    { id: 2, settings: { clients: [] } },
    { id: "bad" },
    null,
  ]);
  assert.deepEqual([...actual.keys()].sort(), ["u7", "u8"]);
  assert.deepEqual(actual.get("u7").inboundIds, [1, 3]);
  assert.equal(actual.get("u7").expiryTime, 5);
  assert.equal(actual.get("u8").id, "p", "Trojan 客户端没有 id 时取 password");
  assert.equal(actual.get("u8").enable, false);
});
