/**
 * CF-Server-Monitor 实时推送合并模型（src/lib/server/monitor/relay-model.ts）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyBatchUpdate,
  applyLatestReportUpdates,
  unknownServerIds,
} from "../../src/lib/server/monitor/relay-model.ts";

function table() {
  return new Map([
    ["a", { id: "a", name: "HK-01", cpu: 10, ram_used: 512, ping: [{ ts: 1, ct: 30 }], last_updated: 100 }],
    ["b", { id: "b", name: "US-01", cpu: 20, last_updated: 100 }],
  ]);
}

function batch(updates) {
  return { type: "batchUpdate", ts: 999, updates };
}

test("合并最新样本并只返回变化字段", () => {
  const servers = table();
  const deltas = applyBatchUpdate(
    servers,
    batch([
      {
        serverId: "a",
        samples: [
          { ts: 200, data: { cpu: 50, ram_used: 512 } },
          { ts: 300, data: { cpu: 60, ram_used: 512, ping: [{ ts: 1, ct: 30 }] } },
        ],
      },
    ]),
  );

  assert.deepEqual(deltas, [{ id: "a", last_updated: 300, cpu: 60 }]);
  assert.equal(servers.get("a").cpu, 60);
  assert.equal(servers.get("a").name, "HK-01");
  assert.equal(servers.get("a").last_updated, 300);
  assert.equal(servers.get("b").cpu, 20);
});

test("样本无 ts 时依次回退 data.last_updated 与 now", () => {
  const servers = table();
  applyBatchUpdate(servers, batch([{ serverId: "a", samples: [{ data: { cpu: 1, last_updated: 400 } }] }]), 5000);
  assert.equal(servers.get("a").last_updated, 400);
  applyBatchUpdate(servers, batch([{ serverId: "b", samples: [{ data: { cpu: 2 } }] }]), 5000);
  assert.equal(servers.get("b").last_updated, 5000);
});

test("兼容 payload / metrics 别名与数字 serverId", () => {
  const servers = new Map([["7", { id: "7", cpu: 0 }]]);
  const deltas = applyBatchUpdate(servers, batch([{ serverId: 7, samples: [{ ts: 1, payload: { cpu: 9 } }] }]));
  assert.deepEqual(deltas, [{ id: "7", last_updated: 1, cpu: 9 }]);
});

test("未知 id 不入表，由 unknownServerIds 报出", () => {
  const servers = table();
  const message = batch([
    { serverId: "a", samples: [{ ts: 1, data: { cpu: 1 } }] },
    { serverId: "new", samples: [{ ts: 1, data: { cpu: 1 } }] },
    { serverId: "new", samples: [{ ts: 2, data: { cpu: 2 } }] },
  ]);
  const deltas = applyBatchUpdate(servers, message);
  assert.deepEqual(deltas.map((delta) => delta.id), ["a"]);
  assert.equal(servers.has("new"), false);
  assert.deepEqual(unknownServerIds(servers, message), ["new"]);
});

test("空消息与非法结构不抛错也不改动", () => {
  const servers = table();
  const before = JSON.stringify([...servers]);
  for (const message of [null, undefined, "x", {}, { updates: "x" }, batch([null, { serverId: "a" }, { serverId: "a", samples: [] }, { serverId: "a", samples: [{ ts: 1, data: "x" }] }])]) {
    assert.deepEqual(applyBatchUpdate(servers, message), []);
    assert.deepEqual(unknownServerIds(servers, message), []);
  }
  assert.equal(JSON.stringify([...servers]), before);
});

test("latestReportUpdates 按同样规则合并", () => {
  const servers = table();
  applyLatestReportUpdates(servers, [{ serverId: "b", samples: [{ ts: 700, data: { cpu: 77 } }], reportTs: 700 }]);
  assert.equal(servers.get("b").cpu, 77);
  assert.equal(servers.get("b").last_updated, 700);
  applyLatestReportUpdates(servers, undefined);
  assert.equal(servers.get("b").cpu, 77);
});
