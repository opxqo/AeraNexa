import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import mysql from "mysql2/promise";

// 独立临时库：在线迁移的恢复会清空整个库。必须在加载 db.ts 之前改 DB_NAME。
const DB_NAME = `aeranexa_migration_test_${randomBytes(4).toString("hex")}`;
process.env.DB_NAME = DB_NAME;

const migration = await import("../../src/lib/server/migration.ts");
const { restoreBackup, selectBackupTables } = await import("../../src/lib/server/backup.ts");
const { GET: exportRoute } = await import("../../src/app/api/migration/export/route.ts");
const { getDbPool } = await import("../../src/lib/server/db.ts");

let pool;
const servers = [];
/** 挂着真正导出接口的「旧面板」，与新面板共用同一个库 */
let samePanel;
/** 模拟「另一个面板」：去掉数据库指纹，并先把导出完整读完再回复。
 *  测试里新旧面板只能共用一个库，而同库边导出边清空会丢数据（正是指纹检查要拦的情况），所以成功路径必须先读完。 */
let otherPanel;
const adminId = 1;

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

async function callExport(req, stripFingerprint) {
  const headers = { ...req.headers };
  if (stripFingerprint) delete headers[migration.DATABASE_FINGERPRINT_HEADER];
  return exportRoute(new Request(`http://127.0.0.1${req.url}`, { headers }));
}

function newCode(origin, includeLogs = false) {
  return migration.createMigrationCode(adminId, { origin, includeLogs }).then((created) => created.code);
}

function tokenOf(code) {
  return migration.parseMigrationCode(code).token;
}

before(async () => {
  await import("../../scripts/migrate-database.mjs");
  pool = getDbPool();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, nickname, role, uuid, subscription_token)
     VALUES (1, 'old@panel.test', 'hash', '旧面板管理员', 'admin', ?, ?)`,
    [randomBytes(18).toString("hex").slice(0, 36), randomBytes(16).toString("hex")],
  );
  samePanel = await listen(async (req, res) => {
    const response = await callExport(req, false);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
  });
  otherPanel = await listen(async (req, res) => {
    const response = await callExport(req, true);
    const body = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, Object.fromEntries(response.headers)).end(body);
  });
});

after(async () => {
  for (const server of servers) server.close();
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
  const token = tokenOf(await newCode("https://old.example.com", true));
  assert.deepEqual(await migration.consumeMigrationToken(token, "1.2.3.4"), { includeLogs: true });
  assert.equal(await migration.consumeMigrationToken(token, null), null);
  assert.equal(await migration.consumeMigrationToken("B".repeat(43), null), null);
  assert.equal(await migration.consumeMigrationToken("短", null), null);

  const expired = tokenOf(await newCode(samePanel));
  await pool.query("UPDATE migration_tokens SET expires_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 MINUTE) WHERE used_at IS NULL");
  assert.equal(await migration.consumeMigrationToken(expired, null), null);

  const raced = tokenOf(await newCode(samePanel));
  const outcomes = await Promise.all([1, 2, 3].map(() => migration.consumeMigrationToken(raced, null)));
  assert.equal(outcomes.filter(Boolean).length, 1);

  const pending = tokenOf(await newCode(samePanel));
  assert.equal(await migration.countActiveMigrationTokens(), 1);
  assert.equal(await migration.revokeMigrationTokens(), 1);
  assert.equal(await migration.consumeMigrationToken(pending, null), null);
});

test("迁移码表不随备份导出", () => {
  assert.deepEqual(selectBackupTables(["migration_tokens", "users"], true), ["users"]);
});

test("把迁移码粘贴回同一个面板：在清空数据之前就被拒绝，迁移码不作废", async () => {
  const code = await newCode(samePanel);
  const [beforeRows] = await pool.query("SELECT * FROM users ORDER BY id");
  await assert.rejects(restoreBackup(() => migration.openRemoteBackup(code)), /本面板自己/);
  const [afterRows] = await pool.query("SELECT * FROM users ORDER BY id");
  assert.deepEqual(afterRows, beforeRows, "数据不能被动过");
  assert.equal(await migration.countActiveMigrationTokens(), 1, "迁移码应仍然可用");
  await migration.revokeMigrationTokens();
});

test("端到端：新面板凭迁移码从另一个面板拉取并恢复；同一个码不能再用", async () => {
  const code = migration.encodeMigrationCode(otherPanel, tokenOf(await newCode(samePanel)));
  const [beforeRows] = await pool.query("SELECT * FROM users ORDER BY id");
  const result = await restoreBackup(() => migration.openRemoteBackup(code));
  assert.equal(result.complete, true);
  assert.equal(result.tables.find((item) => item.name === "users").rows, 1);
  const [afterRows] = await pool.query("SELECT * FROM users ORDER BY id");
  assert.deepEqual(afterRows, beforeRows);
  const [[tokens]] = await pool.query("SELECT COUNT(*) AS n FROM migration_tokens");
  assert.equal(Number(tokens.n), 0, "恢复会清空迁移码表，旧面板的令牌不会出现在新库里");

  await assert.rejects(migration.openRemoteBackup(code), /HTTP 401.*无效、已使用或已过期/);
});

test("worker 在运行时拒绝恢复，且不会去连旧面板，迁移码保持可用", async () => {
  const code = migration.encodeMigrationCode(otherPanel, tokenOf(await newCode(samePanel)));
  const holder = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1", port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root", password: process.env.DB_PASSWORD, database: DB_NAME,
  });
  let opened = false;
  try {
    await holder.query("SELECT GET_LOCK('aeranexa:node-worker', 0)");
    await assert.rejects(restoreBackup(() => { opened = true; return migration.openRemoteBackup(code); }), /worker 正在运行/);
    assert.equal(opened, false, "worker 在跑时不应连接旧面板");
  } finally {
    await holder.end();
  }
  // worker 停下后，同一个迁移码仍然能完成迁移
  const result = await restoreBackup(() => migration.openRemoteBackup(code));
  assert.equal(result.complete, true);
});

test("不跟随跳转，防止令牌被带到别的地址；连不上时给出明确原因", async () => {
  const token = "C".repeat(43);
  let leaked = false;
  const redirector = await listen((req, res) => {
    if (req.headers.authorization && req.url !== "/api/migration/export") leaked = true;
    res.writeHead(302, { location: "/somewhere-else" }).end();
  });
  await assert.rejects(migration.openRemoteBackup(migration.encodeMigrationCode(redirector, token)), /无法连接旧面板/);
  assert.equal(leaked, false, "令牌不能被带到跳转后的地址");
  await assert.rejects(migration.openRemoteBackup(migration.encodeMigrationCode("http://127.0.0.1:9", token)), /无法连接旧面板/);
});
