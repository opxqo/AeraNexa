import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { gunzipSync } from "node:zlib";
import mysql from "mysql2/promise";

// 在独立的临时库里跑：恢复会清空整个库，绝不能碰开发库。必须在加载 db.ts 之前改 DB_NAME。
const DB_NAME = `aeranexa_backup_test_${randomBytes(4).toString("hex")}`;
process.env.DB_NAME = DB_NAME;
process.env.SETTINGS_ENCRYPTION_KEY = "backup-test-settings-key";

const { createBackupStream, restoreBackup } = await import("../../src/lib/server/backup.ts");
const { getDbPool } = await import("../../src/lib/server/db.ts");

let pool;
const snapshot = (table) => pool.query(`SELECT * FROM \`${table}\` ORDER BY 1`).then(([rows]) => rows);
const exportBuffer = (includeLogs) => buffer(createBackupStream({ includeLogs }));
const readLines = (file) => gunzipSync(file).toString("utf8").trim().split("\n").map((line) => JSON.parse(line));

before(async () => {
  await import("../../scripts/migrate-database.mjs");
  pool = getDbPool();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, nickname, balance, expired_at, uuid, subscription_token, email_verified_at)
     VALUES (7, 'a@b.c', 'hash', '测试', -1234, 9007199254740993, ?, ?, '2026-01-02 03:04:05')`,
    [randomBytes(18).toString("hex").slice(0, 36), randomBytes(16).toString("hex")],
  );
  await pool.query(
    `INSERT INTO payment_methods (id, uuid, provider, name, config, handling_fee_percent, notify_domain)
     VALUES (3, ?, 'mock', '模拟', '{"a":[1,2],"b":"中文","n":null}', 1.2345, NULL)`,
    [randomBytes(16).toString("hex")],
  );
  await pool.query(`INSERT INTO runtime_logs (service, category, level, event_code, message, details) VALUES ('web', 'error', 'error', 'x', 'm', '{"k":1}')`);
  await pool.query(`INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, 7, '2030-01-01 00:00:00')`, [crypto.randomUUID()]);
});

after(async () => {
  await pool?.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``).catch(() => {});
  await pool?.end();
});

test("导出文件结构：meta、跳过临时表、日志按开关导出、末尾行数、携带密钥", async () => {
  const plain = readLines(await exportBuffer(false));
  const meta = plain[0];
  assert.equal(meta.format, "aeranexa-backup");
  assert.equal(meta.env.SETTINGS_ENCRYPTION_KEY, "backup-test-settings-key");
  assert.ok(!("DB_PASSWORD" in meta.env) && !("DB_NAME" in meta.env));
  assert.ok(meta.tables.includes("users"));
  for (const skipped of ["auth_sessions", "schema_migrations", "runtime_logs", "audit_logs"]) assert.ok(!meta.tables.includes(skipped), skipped);
  const trailer = plain.at(-1);
  assert.equal(trailer.end, true);
  assert.equal(trailer.tables.find((item) => item.name === "users").rows, 1);

  const withLogs = readLines(await exportBuffer(true));
  assert.ok(withLogs[0].tables.includes("runtime_logs"));
  assert.ok(withLogs.some((line) => line.t === "runtime_logs"));
});

test("导出 → 改乱数据 → 恢复：各表逐列与原来一致，临时表被清空", async () => {
  const before = { users: await snapshot("users"), payment_methods: await snapshot("payment_methods"), runtime_logs: await snapshot("runtime_logs") };
  const file = await exportBuffer(true);

  await pool.query("UPDATE users SET nickname = '被改了', balance = 0");
  await pool.query("DELETE FROM payment_methods");
  await pool.query(`INSERT INTO runtime_logs (service, category, level, event_code, message) VALUES ('web', 'error', 'error', 'y', 'extra')`);

  const result = await restoreBackup(Readable.from(file));
  assert.equal(result.complete, true);
  assert.equal(result.tables.find((item) => item.name === "users").rows, 1);
  for (const [table, rows] of Object.entries(before)) assert.deepEqual(await snapshot(table), rows, table);
  const [[sessions]] = await pool.query("SELECT COUNT(*) AS n FROM auth_sessions");
  // 恢复前确有会话（before 钩子里插入），恢复后必须被清空。
  assert.equal(Number(sessions.n), 0);
});

test("worker 运行（持有主锁）时拒绝恢复，数据不受影响", async () => {
  const file = await exportBuffer(false);
  const holder = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1", port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root", password: process.env.DB_PASSWORD, database: DB_NAME,
  });
  try {
    await holder.query("SELECT GET_LOCK('aeranexa:node-worker', 0)");
    await assert.rejects(restoreBackup(Readable.from(file)), /worker 正在运行/);
    assert.equal((await snapshot("users")).length, 1);
  } finally {
    await holder.end();
  }
});

test("非备份文件在动数据库之前就被拒绝", async () => {
  const { gzipSync } = await import("node:zlib");
  await assert.rejects(restoreBackup(Readable.from(gzipSync('{"hello":1}\n'))), /不是 AeraNexa 备份文件/);
  assert.equal((await snapshot("users")).length, 1);
});
