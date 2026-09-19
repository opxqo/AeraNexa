/**
 * 流量采集纯函数（src/lib/server/panel/traffic-model.ts）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { collectCounters, counterDelta, dayBucketUtc, userIdFromEmail } from "../../src/lib/server/panel/traffic-model.ts";

test("读数：受管客户端按 email 去重，入站计数单独收集，非法值按 0", () => {
  const counters = collectCounters([
    {
      id: 1, up: 100, down: 200,
      clientStats: [
        { email: "u58", up: 10, down: 20 },
        { email: "admin-manual", up: 999, down: 999 },
        { email: "u7", up: -5, down: "x" },
      ],
    },
    { id: 2, up: 1, down: 2, clientStats: [{ email: "u58", up: 10, down: 20 }] },
    { id: "bad", up: 1 },
    null,
  ]);
  assert.deepEqual([...counters.clients.entries()], [["u58", { up: 10, down: 20 }], ["u7", { up: 0, down: 0 }]]);
  assert.deepEqual([...counters.inbounds.entries()], [[1, { up: 100, down: 200 }], [2, { up: 1, down: 2 }]]);
});

test("增量：正常递增取差值", () => {
  assert.deepEqual(counterDelta({ up: 100, down: 1000 }, { up: 150, down: 1600 }), { up: 50, down: 600 });
  assert.deepEqual(counterDelta({ up: 100, down: 1000 }, { up: 100, down: 1000 }), { up: 0, down: 0 });
});

test("增量：第一次见到从 0 起算", () => {
  assert.deepEqual(counterDelta(null, { up: 30, down: 40 }), { up: 30, down: 40 });
});

test("增量：计数器被重置（变小）时，本次读数即为新增量；上下行各自判断", () => {
  assert.deepEqual(counterDelta({ up: 5000, down: 8000 }, { up: 120, down: 9000 }), { up: 120, down: 1000 });
});

test("日桶：东八区自然日起点，以 UTC 挂钟表示", () => {
  // 东八区 2026-09-20 00:30 = UTC 2026-09-19 16:30 → 桶起点东八区 2026-09-20 00:00 = UTC 2026-09-19 16:00
  assert.equal(dayBucketUtc(Date.UTC(2026, 8, 19, 16, 30)), "2026-09-19 16:00:00");
  // 东八区 2026-09-19 23:59 = UTC 2026-09-19 15:59 → 桶起点东八区 2026-09-19 00:00 = UTC 2026-09-18 16:00
  assert.equal(dayBucketUtc(Date.UTC(2026, 8, 19, 15, 59)), "2026-09-18 16:00:00");
});

test("email → 用户 ID", () => {
  assert.equal(userIdFromEmail("u3947"), 3947);
  assert.equal(userIdFromEmail("u"), null);
  assert.equal(userIdFromEmail("admin"), null);
});
