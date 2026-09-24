import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { csvCell, csvLine, logRowToCsv } from "../../src/lib/log-export.ts";
import { describeLogEvent } from "../../src/lib/log-descriptions.ts";
import { loadLogExportBatch } from "../../src/lib/server/log-query.ts";
import { getDbPool } from "../../src/lib/server/db.ts";

test("CSV 转义换行、引号和电子表格公式", () => {
  assert.equal(csvCell('a"b'), '"a""b"');
  assert.equal(csvCell("=SUM(1,1)"), '"\'=SUM(1,1)"');
  assert.equal(csvCell("\n+cmd"), '"\'\n+cmd"');
  assert.equal(csvLine(["中文", "x,y"]), '"中文","x,y"\r\n');
});

test("审计和请求状态显示中文解释，导出保留原事件代码", () => {
  assert.equal(describeLogEvent("auth.login_failed", "audit"), "用户登录失败");
  assert.equal(describeLogEvent("http.request", "access", 401), "请求已完成，返回 401 错误");
  const line = logRowToCsv({
    id: 1, createdAt: "2026/09/24 20:00:00", service: "web", category: "access", level: "warn",
    explanation: "请求已完成，返回 401 错误", eventCode: "http.request", message: "GET /login 401",
    actor: "", method: "GET", path: "/login", status: "401", duration: "12 ms", requestId: "id", details: "null",
  });
  assert.ok(line.includes("请求已完成，返回 401 错误"));
  assert.ok(line.includes("http.request"));
});

test("导出批次沿用页面筛选并按 ID 游标继续", async () => {
  const db = getDbPool();
  const marker = `/log-export-test-${randomUUID()}`;
  const ids = [];
  try {
    for (const category of ["error", "bot", "error"]) {
      const [result] = await db.execute(
        "INSERT INTO runtime_logs (service, category, level, event_code, message, request_path) VALUES (?, ?, ?, ?, ?, ?)",
        ["web", category, "info", "codex.export_check", "export check", marker],
      );
      ids.push(Number(result.insertId));
    }
    const filters = { view: "runtime", page: 999, from: "", to: "", category: "error", level: "", actor: "", path: marker, requestId: "" };
    const first = await loadLogExportBatch(filters, undefined, 1);
    const second = await loadLogExportBatch(filters, first[0].id, 1);
    assert.deepEqual([first[0].id, second[0].id], [ids[2], ids[0]]);
    assert.equal(first[0].path, "/:private");
    assert.equal(first[0].explanation, "其他运行事件（请查看事件代码和详情）");
  } finally {
    if (ids.length) await db.query("DELETE FROM runtime_logs WHERE id IN (?)", [ids]);
    await db.end();
  }
});
