/** 签名回调：验签、金额校验、幂等履约。运行前需启动本地 Next 服务。 */
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";

const baseUrl = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const dbConfig = { host: process.env.DB_HOST ?? "127.0.0.1", port: Number(process.env.DB_PORT ?? 3306), database: process.env.DB_NAME ?? "aeranexa", user: process.env.DB_USER ?? "root", password: process.env.DB_PASSWORD };
const created = { emails: [], plans: [], callbackEventIds: [] };
const secret = process.env.PAYMENT_SANDBOX_WEBHOOK_SECRET || "aeranexa-local-payment-sandbox-secret";
const post = (path, body, cookie) => fetch(`${baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const db = () => mysql.createConnection(dbConfig);

async function createUser() {
  const email = `callback-${Date.now()}-${randomBytes(3).toString("hex")}@example.test`;
  created.emails.push(email);
  const connection = await db();
  try {
    if (created.callbackEventIds.length) await connection.query("DELETE FROM payment_callback_events WHERE event_id IN (?)", [created.callbackEventIds]);
    await connection.execute("INSERT INTO users (email, password_hash, nickname, uuid, subscription_token, email_verified_at) VALUES (?, ?, 'callback-test', ?, ?, CURRENT_TIMESTAMP)", [email, await bcrypt.hash("callback-test-password", 10), randomUUID(), randomBytes(16).toString("hex")]);
  } finally { await connection.end(); }
  const response = await post("/api/auth/login", { email, password: "callback-test-password" });
  assert.equal(response.status, 200, await response.text());
  return response.headers.getSetCookie()[0].split(";", 1)[0];
}

after(async () => {
  const connection = await db();
  try {
    if (created.emails.length) {
      const [users] = await connection.query("SELECT id FROM users WHERE email IN (?)", [created.emails]);
      const ids = users.map((user) => user.id);
      if (ids.length) {
        await connection.query("DELETE FROM payment_callback_events WHERE order_id IN (SELECT id FROM orders WHERE user_id IN (?))", [ids]);
        await connection.query("DELETE FROM payment_events WHERE order_id IN (SELECT id FROM orders WHERE user_id IN (?))", [ids]);
        await connection.query("DELETE FROM wallet_transactions WHERE user_id IN (?)", [ids]);
        await connection.query("DELETE FROM payment_transactions WHERE order_id IN (SELECT id FROM orders WHERE user_id IN (?))", [ids]);
        await connection.query("DELETE FROM orders WHERE user_id IN (?)", [ids]);
        await connection.query("DELETE FROM auth_sessions WHERE user_id IN (?)", [ids]);
        await connection.query("DELETE FROM users WHERE id IN (?)", [ids]);
      }
    }
    if (created.plans.length) await connection.query("DELETE FROM plans WHERE id IN (?)", [created.plans]);
  } finally { await connection.end(); }
});

test("HMAC 回调拒绝无效签名", async () => {
  const eventId = `invalid-${randomUUID()}`;
  created.callbackEventIds.push(eventId);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ trade_no: "invalid-trade", provider_trade_no: "invalid-provider-trade", amount_cents: 100, currency: "CNY", status: "succeeded" });
  const response = await fetch(`${baseUrl}/api/payments/callback/mock`, { method: "POST", headers: { "content-type": "application/json", "x-aera-timestamp": timestamp, "x-aera-event-id": eventId, "x-aera-signature": "0".repeat(64) }, body });
  assert.equal(response.status, 403);
});

test("HMAC 回调完成 mock 交易且重复事件幂等", async () => {
  const connection = await db();
  let planId;
  try {
    const [plan] = await connection.execute("INSERT INTO plans (name, transfer_enable, month_price, is_visible, is_renewable) VALUES (?, 10, 500, 1, 1)", [`callback-plan-${Date.now()}`]);
    planId = Number(plan.insertId); created.plans.push(planId);
    await connection.execute("UPDATE payment_methods SET is_enabled = 1 WHERE provider = 'mock'");
  } finally { await connection.end(); }
  const cookie = await createUser();
  const order = await post("/api/client/orders", { plan_id: planId, period: "month_price" }, cookie);
  const tradeNo = (await order.json()).data;
  const methods = await (await fetch(`${baseUrl}/api/client/payment-methods`, { headers: { cookie } })).json();
  const mock = methods.data.find((method) => method.payment === "mock");
  assert.ok(mock, "mock 测试渠道应存在");
  const checkout = await post("/api/client/orders/checkout", { trade_no: tradeNo, method: mock.id }, cookie);
  const transaction = (await checkout.json()).data;
  const eventId = `test-${randomUUID()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const connection2 = await db();
  let providerTradeNo, amount;
  try {
    const [transactions] = await connection2.query("SELECT provider_trade_no, amount FROM payment_transactions WHERE id = ?", [transaction.transaction_id]);
    providerTradeNo = transactions[0].provider_trade_no;
    amount = transactions[0].amount;
  } finally { await connection2.end(); }
  const body = JSON.stringify({ trade_no: tradeNo, provider_trade_no: providerTradeNo, amount_cents: Number(amount), currency: "CNY", status: "succeeded" });
  const signature = createHmac("sha256", secret).update(`${timestamp}.${eventId}.${body}`).digest("hex");
  const callback = await fetch(`${baseUrl}/api/payments/callback/mock`, { method: "POST", headers: { "content-type": "application/json", "x-aera-timestamp": timestamp, "x-aera-event-id": eventId, "x-aera-signature": signature }, body });
  assert.equal(callback.status, 200);
  const duplicate = await fetch(`${baseUrl}/api/payments/callback/mock`, { method: "POST", headers: { "content-type": "application/json", "x-aera-timestamp": timestamp, "x-aera-event-id": eventId, "x-aera-signature": signature }, body });
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);
});
