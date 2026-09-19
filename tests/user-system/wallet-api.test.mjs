/** 余额支付与卡密充值的端到端验收。运行前需启动本地 Next 服务。 */
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";
import { enableMockPaymentForTests, restoreMockPaymentMethod } from "./helpers.mjs";

const baseUrl = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const password = "wallet-test-password-123";
const dbConfig = {
  host: process.env.DB_HOST ?? "127.0.0.1", port: Number(process.env.DB_PORT ?? 3306),
  database: process.env.DB_NAME ?? "aeranexa", user: process.env.DB_USER ?? "root", password: process.env.DB_PASSWORD,
};
const created = { users: [], batches: [], plans: [] };
const secret = process.env.RECHARGE_CARD_SECRET || process.env.AUTH_SESSION_SECRET || "aeranexa-local-recharge-card-secret";
const hash = (code) => createHmac("sha256", secret).update(code.replace(/[\s-]/g, "").toUpperCase()).digest("hex");
const post = (path, cookie, body) => fetch(`${baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

async function connection() { return mysql.createConnection(dbConfig); }

async function register() {
  const email = `wallet-${Date.now()}-${randomBytes(3).toString("hex")}@example.test`;
  created.users.push(email);
  const db = await connection();
  try {
    await db.execute(
      `INSERT INTO users (email, password_hash, nickname, uuid, subscription_token, email_verified_at)
       VALUES (?, ?, 'wallet-test', ?, ?, CURRENT_TIMESTAMP)`,
      [email, await bcrypt.hash(password, 12), randomUUID(), randomBytes(16).toString("hex")],
    );
  } finally { await db.end(); }
  const response = await post("/api/auth/login", null, { email, password });
  assert.equal(response.status, 200, await response.text());
  return { email, cookie: response.headers.getSetCookie()[0].split(";", 1)[0] };
}

async function insertCard({ amount = 1000, expiresAt = null, status = "unused" } = {}) {
  const db = await connection();
  try {
    const batchNo = `WT${Date.now()}${randomBytes(3).toString("hex")}`;
    const [batch] = await db.execute(
      "INSERT INTO recharge_card_batches (batch_no, name, amount, quantity, expires_at) VALUES (?, 'wallet test', ?, 1, ?)",
      [batchNo, amount, expiresAt],
    );
    created.batches.push(Number(batch.insertId));
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const body = [...randomBytes(20)].map((byte) => alphabet[byte % alphabet.length]).join("");
    const code = `ANX-${body.match(/.{1,4}/g).join("-")}`;
    await db.execute("INSERT INTO recharge_cards (batch_id, code_hash, code_tail, amount, status) VALUES (?, ?, ?, ?, ?)", [batch.insertId, hash(code), code.replace(/-/g, "").slice(-4), amount, status]);
    return { code, amount };
  } finally { await db.end(); }
}

async function createPlan() {
  const db = await connection();
  try {
    const [result] = await db.execute("INSERT INTO plans (name, transfer_enable, month_price, is_visible, is_renewable) VALUES (?, 10, 500, 1, 1)", [`wallet-plan-${Date.now()}`]);
    created.plans.push(Number(result.insertId));
    return Number(result.insertId);
  } finally { await db.end(); }
}

// 支付方式是全局可变状态（后台可随时关掉模拟支付），本文件有支付链路用例依赖它。
let mockPaymentWasEnabled = null;

before(async () => {
  mockPaymentWasEnabled = await enableMockPaymentForTests();
});

after(async () => {
  await restoreMockPaymentMethod(mockPaymentWasEnabled);
  const db = await connection();
  try {
    if (created.users.length) {
      const [rows] = await db.query("SELECT id FROM users WHERE email IN (?)", [created.users]);
      const ids = rows.map((row) => row.id);
      if (ids.length) {
        await db.query("DELETE FROM wallet_transactions WHERE user_id IN (?)", [ids]);
        await db.query("DELETE FROM payment_transactions WHERE order_id IN (SELECT id FROM orders WHERE user_id IN (?))", [ids]);
        await db.query("DELETE FROM orders WHERE user_id IN (?)", [ids]);
        await db.query("DELETE FROM auth_sessions WHERE user_id IN (?)", [ids]);
        await db.query("DELETE FROM audit_logs WHERE user_id IN (?)", [ids]);
        await db.query("DELETE FROM users WHERE id IN (?)", [ids]);
      }
    }
    if (created.batches.length) {
      await db.query("DELETE FROM recharge_cards WHERE batch_id IN (?)", [created.batches]);
      await db.query("DELETE FROM recharge_card_batches WHERE id IN (?)", [created.batches]);
    }
    if (created.plans.length) await db.query("DELETE FROM plans WHERE id IN (?)", [created.plans]);
  } finally { await db.end(); }
});

test("卡密只可兑换一次，已停用和过期卡密被拒绝", async () => {
  const { cookie } = await register();
  const card = await insertCard({ amount: 1200 });
  const first = await post("/api/client/wallet/recharge", cookie, { code: card.code });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).data.credited_amount, 1200);
  const replay = await post("/api/client/wallet/recharge", cookie, { code: card.code });
  assert.equal(replay.status, 409);
  const expired = await insertCard({ expiresAt: "2000-01-01 00:00:00" });
  assert.equal((await post("/api/client/wallet/recharge", cookie, { code: expired.code })).status, 409);
  const disabled = await insertCard({ status: "disabled" });
  assert.equal((await post("/api/client/wallet/recharge", cookie, { code: disabled.code })).status, 409);
});

test("并发兑换同一卡密只有一个请求入账", async () => {
  const { cookie } = await register();
  const card = await insertCard({ amount: 800 });
  const responses = await Promise.all([
    post("/api/client/wallet/recharge", cookie, { code: card.code }),
    post("/api/client/wallet/recharge", cookie, { code: card.code }),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
});

test("余额支付原子扣款、完成履约，并能安全重放 checkout", async () => {
  const { cookie } = await register();
  const card = await insertCard({ amount: 1000 });
  assert.equal((await post("/api/client/wallet/recharge", cookie, { code: card.code })).status, 200);
  const planId = await createPlan();
  const order = await post("/api/client/orders", cookie, { plan_id: planId, period: "month_price" });
  const tradeNo = (await order.json()).data;
  const methods = await (await fetch(`${baseUrl}/api/client/payment-methods`, { headers: { cookie } })).json();
  const balance = methods.data.find((method) => method.payment === "balance");
  assert.ok(balance, "余额支付应自动注册");
  const paid = await post("/api/client/orders/checkout", cookie, { trade_no: tradeNo, method: balance.id });
  assert.equal(paid.status, 200);
  const payload = await paid.json();
  assert.equal(payload.data.completed, true);
  assert.equal(payload.data.amount, 500);
  const replay = await post("/api/client/orders/checkout", cookie, { trade_no: tradeNo, method: balance.id });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).data.completed, true);
});
