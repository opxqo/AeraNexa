import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { Readable } from "node:stream";

// 独立临时库：在线迁移的恢复会清空整个库。必须在加载 db.ts 之前改 DB_NAME。
const DB_NAME = `aeranexa_migration_test_${randomBytes(4).toString("hex")}`;
process.env.DB_NAME = DB_NAME;

const migration = await import("../../src/lib/server/migration.ts");
const { restoreBackup, selectBackupTables } = await import("../../src/lib/server/backup.ts");
const { GET: exportRoute } = await import("../../src/app/api/migration/export/route.ts");
const { getDbPool } = await import("../../src/lib/server/db.ts");

let pool;
let server;
let origin;
const adminId = 1;

before(async () => {
  await import("../../scripts/migrate-database.mjs");
  pool = getDbPool();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, nickname, role, uuid, subscription_token)
     VALUES (1, 'old@panel.test', 'hash', '旧面板管理员', 'admin', ?, ?)`,
    [randomBytes(18).toString("hex").slice(0, 36), randomBytes(16).toString("hex")],
  );
  // 本地 HTTP 服务挂上真正的导出接口，模拟「旧面板」
  server = createServer(async (req, res) => {
    const response = await exportRoute(new Request(`http://127.0.0.1${req.url}`, { headers: req.headers }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).pipe(res);
    else res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  await pool?.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``).catch(() => {});
  await pool?.end();
});

test("迁移码编码与解析；只接受 https（本机地址例外）", () => {
  const token = "A".repeat(43);
  const code = migration.encodeMigrationCode("https://old.example.com", token);
  assert.match(code, /^anx1\./);
  assert.deepEqual(migration.parseMigrationCode(`  ${code}\n`), { origin: "https://old.example.com", token });
  assert.throws(() => migration.parseMigrationCode("abc"), /anx1/);
  assert.throws(() => migration.parseMigrationCode("anx1.@@@"), /损坏/);
  assert.throws(() => migration.parseMigrationCode(code.slice(0, -6)), /损坏/);
  assert.throws(() => migration.normalizePanelOrigin("http://old.example.com"), /https/);
  assert.equal(migration.normalizePanelOrigin("http://localhost:3000/admin/backup"), "http://localhost:3000");
  assert.equal(migration.normalizePanelOrigin("https://old.example.com/x?y"), "https://old.example.com");
});

test("令牌只能用一次；错误、过期、作废的令牌都被拒绝；并发只成功一次", async () => {
  const { code } = await migration.createMigrationCode(adminId, { origin: "https://old.example.com", includeLogs: true });
  const { token } = migration.parseMigrationCode(code);
  assert.deepEqual(await migration.consumeMigrationToken(token, "1.2.3.4"), { includeLogs: true });
  assert.equal(await migration.consumeMigrationToken(token, null), null);
  assert.equal(await migration.consumeMigrationToken("B".repeat(43), null), null);
  assert.equal(await migration.consumeMigrationToken("短", null), null);

  const expired = migration.parseMigrationCode((await migration.createMigrationCode(adminId, { origin, includeLogs: false })).code).token;
  await pool.query("UPDATE migration_tokens SET expires_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 MINUTE) WHERE used_at IS NULL");
  assert.equal(await migration.consumeMigrationToken(expired, null), null);

  const raced = migration.parseMigrationCode((await migration.createMigrationCode(adminId, { origin, includeLogs: false })).code).token;
  const outcomes = await Promise.all([1, 2, 3].map(() => migration.consumeMigrationToken(raced, null)));
  assert.equal(outcomes.filter(Boolean).length, 1);

  const pending = migration.parseMigrationCode((await migration.createMigrationCode(adminId, { origin, includeLogs: false })).code).token;
  assert.equal(await migration.countActiveMigrationTokens(), 1);
  assert.equal(await migration.revokeMigrationTokens(), 1);
  assert.equal(await migration.consumeMigrationToken(pending, null), null);
});

test("迁移码表不随备份导出", () => {
  assert.deepEqual(selectBackupTables(["migration_tokens", "users"], true), ["users"]);
});

test("端到端：新面板凭迁移码从旧面板拉取并恢复；同一个码不能再用", async () => {
  // 同一个库既当旧面板又当新面板：导出流读的是此刻的数据，恢复会先清空再写回，结果应与导出前逐列一致
  const { code } = await migration.createMigrationCode(adminId, { origin, includeLogs: false });
  const [beforeRows] = await pool.query("SELECT * FROM users ORDER BY id");
  const result = await restoreBackup(await migration.openRemoteBackup(code));
  assert.equal(result.complete, true);
  assert.equal(result.tables.find((item) => item.name === "users").rows, 1);
  const [afterRows] = await pool.query("SELECT * FROM users ORDER BY id");
  assert.deepEqual(afterRows, beforeRows);
  const [[tokens]] = await pool.query("SELECT COUNT(*) AS n FROM migration_tokens");
  assert.equal(Number(tokens.n), 0, "恢复会清空迁移码表，旧面板的令牌不会出现在新库里");

  await assert.rejects(migration.openRemoteBackup(code), /HTTP 401.*无效、已使用或已过期/);
});

test("不跟随跳转，防止令牌被带到别的地址；连不上时给出明确原因", async () => {
  const token = "C".repeat(43);
  let leaked = false;
  const redirector = createServer((req, res) => {
    if (req.headers.authorization) leaked = req.url !== "/api/migration/export";
    res.writeHead(302, { location: "/somewhere-else" }).end();
  });
  await new Promise((resolve) => redirector.listen(0, "127.0.0.1", resolve));
  try {
    const code = migration.encodeMigrationCode(`http://127.0.0.1:${redirector.address().port}`, token);
    await assert.rejects(migration.openRemoteBackup(code), /无法连接旧面板/);
    assert.equal(leaked, false, "令牌不能被带到跳转后的地址");
  } finally {
    redirector.close();
  }
  await assert.rejects(migration.openRemoteBackup(migration.encodeMigrationCode("http://127.0.0.1:9", token)), /无法连接旧面板/);
});
