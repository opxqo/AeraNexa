/**
 * 订单与支付的衔接：关单后迟到付款、重复付款、人工补单后到账、超时自动关单。
 * 通过 mock 渠道的签名回调驱动，与易支付共用同一段 applyGatewayCallback。运行前需启动本地 Next 服务。
 */
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";

const baseUrl = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const dbConfig = { host: process.env.DB_HOST ?? "127.0.0.1", port: Number(process.env.DB_PORT ?? 3306), database: process.env.DB_NAME ?? "aeranexa", user: process.env.DB_USER ?? "root", password: process.env.DB_PASSWORD };
const secret = process.env.PAYMENT_SANDBOX_WEBHOOK_SECRET || "aeranexa-local-payment-sandbox-secret";
const created = { emails: [], plans: [] };
const db = () => mysql.createConnection(dbConfig);
const post = (path, body, cookie) => fetch(`${baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (path, cookie) => fetch(`${baseUrl}${path}`, { headers: { cookie } });

async function query(sql, params = []) {
  const connection = await db();
  try {
    const [rows] = await connection.query(sql, params);
    return rows;
  } finally {
    await connection.end();
  }
}

let planId;
let mockMethodId;

before(async () => {
  const plan = await query("INSERT INTO plans (name, transfer_enable, month_price, is_visible, is_renewable) VALUES (?, 10, 500, 1, 1)", [`lifecycle-plan-${Date.now()}`]);
  planId = Number(plan.insertId);
  created.plans.push(planId);
  await query("UPDATE payment_methods SET is_enabled = 1 WHERE provider = 'mock'");
});

after(async () => {
  const connection = await db();
  try {
    if (created.emails.length) {
      const [users] = await connection.query("SELECT id FROM users WHERE email IN (?)", [created.emails]);
      const ids = users.map((user) => user.id);
      if (ids.length) {
        const orders = "SELECT id FROM orders WHERE user_id IN (?)";
        await connection.query(`DELETE FROM payment_callback_events WHERE order_id IN (${orders})`, [ids]);
        await connection.query(`DELETE FROM payment_events WHERE order_id IN (${orders})`, [ids]);
        await connection.query(`DELETE FROM commission_records WHERE order_id IN (${orders})`, [ids]).catch(() => {});
        await connection.query("DELETE FROM wallet_transactions WHERE user_id IN (?)", [ids]);
        await connection.query(`DELETE FROM payment_transactions WHERE order_id IN (${orders})`, [ids]);
        await connection.query(`DELETE FROM coupon_usages WHERE order_id IN (${orders})`, [ids]);
        await connection.query("DELETE FROM orders WHERE user_id IN (?)", [ids]);
        await connection.query("DELETE FROM panel_clients WHERE user_id IN (?)", [ids]).catch(() => {});
        await connection.query("DELETE FROM auth_sessions WHERE user_id IN (?)", [ids]);
        await connection.query("DELETE FROM users WHERE id IN (?)", [ids]);
      }
    }
    if (created.plans.length) await connection.query("DELETE FROM plans WHERE id IN (?)", [created.plans]);
  } finally {
    await connection.end();
  }
  const { getDbPool } = await import("../../src/lib/server/db.ts");
  await getDbPool().end().catch(() => {});
});

async function createUser() {
  const email = `lifecycle-${Date.now()}-${randomBytes(3).toString("hex")}@example.test`;
  created.emails.push(email);
  await query(
    "INSERT INTO users (email, password_hash, nickname, uuid, subscription_token, email_verified_at) VALUES (?, ?, 'lifecycle-test', ?, ?, CURRENT_TIMESTAMP)",
    [email, await bcrypt.hash("lifecycle-test-password", 10), randomUUID(), randomBytes(16).toString("hex")],
  );
  const response = await post("/api/auth/login", { email, password: "lifecycle-test-password" });
  assert.equal(response.status, 200, await response.text());
  const [user] = await query("SELECT id FROM users WHERE email = ?", [email]);
  return { cookie: response.headers.getSetCookie()[0].split(";", 1)[0], userId: Number(user.id) };
}

/** 下单并用 mock 渠道发起支付，返回订单号与本次支付流水。 */
async function orderWithCheckout(cookie) {
  const order = await post("/api/client/orders", { plan_id: planId, period: "month_price" }, cookie);
  assert.equal(order.status, 201, await order.clone().text());
  const tradeNo = (await order.json()).data;
  if (!mockMethodId) {
    const methods = await (await get("/api/client/payment-methods", cookie)).json();
    mockMethodId = methods.data.find((method) => method.payment === "mock").id;
  }
  const checkout = await post("/api/client/orders/checkout", { trade_no: tradeNo, method: mockMethodId }, cookie);
  assert.equal(checkout.status, 200, await checkout.clone().text());
  const transactionId = (await checkout.json()).data.transaction_id;
  const [transaction] = await query("SELECT provider_trade_no, amount FROM payment_transactions WHERE id = ?", [transactionId]);
  return { tradeNo, transactionId, providerTradeNo: transaction.provider_trade_no, amount: Number(transaction.amount) };
}

/** 模拟渠道确认收款（签名回调）。 */
async function confirmPayment(tradeNo, providerTradeNo, amount) {
  const eventId = `lifecycle-${randomUUID()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ trade_no: tradeNo, provider_trade_no: providerTradeNo, amount_cents: amount, currency: "CNY", status: "succeeded" });
  const signature = createHmac("sha256", secret).update(`${timestamp}.${eventId}.${body}`).digest("hex");
  return fetch(`${baseUrl}/api/payments/callback/mock`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-aera-timestamp": timestamp, "x-aera-event-id": eventId, "x-aera-signature": signature },
    body,
  });
}

const orderRow = async (tradeNo) => (await query("SELECT id, status, admin_remark FROM orders WHERE trade_no = ?", [tradeNo]))[0];
const transactionStatus = async (id) => (await query("SELECT status FROM payment_transactions WHERE id = ?", [id]))[0].status;
const balanceOf = async (userId) => Number((await query("SELECT balance FROM users WHERE id = ?", [userId]))[0].balance);

test("待支付订单返回自动关闭时间", async () => {
  const { cookie } = await createUser();
  const { tradeNo } = await orderWithCheckout(cookie);
  const detail = (await (await get(`/api/client/orders/${tradeNo}`, cookie)).json()).data;
  const now = Math.floor(Date.now() / 1000);
  assert.ok(detail.pay_deadline > now + 8 * 60 && detail.pay_deadline <= now + 11 * 60, `pay_deadline=${detail.pay_deadline}`);
});

test("取消订单会关闭未完成的支付流水；之后渠道确认收款，订单自动恢复并开通", async () => {
  const { cookie, userId } = await createUser();
  const { tradeNo, transactionId, providerTradeNo, amount } = await orderWithCheckout(cookie);

  const cancel = await post("/api/client/orders/cancel", { trade_no: tradeNo }, cookie);
  assert.equal(cancel.status, 200, await cancel.clone().text());
  assert.equal((await orderRow(tradeNo)).status, 2);
  assert.equal(await transactionStatus(transactionId), "closed");

  const callback = await confirmPayment(tradeNo, providerTradeNo, amount);
  assert.equal(callback.status, 200, await callback.clone().text());
  const order = await orderRow(tradeNo);
  assert.equal(order.status, 3, "迟到付款应恢复并开通订单");
  assert.match(order.admin_remark ?? "", /自动恢复并开通/);
  assert.equal(await transactionStatus(transactionId), "completed");
  const [user] = await query("SELECT plan_id FROM users WHERE id = ?", [userId]);
  assert.equal(Number(user.plan_id), planId);
});

test("已完成订单再次收款（重复支付）转入余额", async () => {
  const { cookie, userId } = await createUser();
  const { tradeNo, providerTradeNo, amount } = await orderWithCheckout(cookie);
  assert.equal((await confirmPayment(tradeNo, providerTradeNo, amount)).status, 200);
  assert.equal((await orderRow(tradeNo)).status, 3);

  // 用户在另一个收银台又付了一次：同订单下另一笔（已被关闭的）流水。
  const { id: orderId } = await orderRow(tradeNo);
  const secondTradeNo = `MOCK${randomBytes(10).toString("hex").toUpperCase()}`;
  const inserted = await query(
    "INSERT INTO payment_transactions (order_id, payment_method_id, provider_trade_no, amount, status) VALUES (?, ?, ?, ?, 'closed')",
    [orderId, mockMethodId, secondTradeNo, amount],
  );
  const before = await balanceOf(userId);
  assert.equal((await confirmPayment(tradeNo, secondTradeNo, amount)).status, 200);

  assert.equal(await balanceOf(userId), before + amount);
  assert.equal(await transactionStatus(inserted.insertId), "credited");
  const [wallet] = await query("SELECT amount FROM wallet_transactions WHERE user_id = ? AND transaction_type = 'payment_credit'", [userId]);
  assert.equal(Number(wallet.amount), amount);
  assert.equal((await orderRow(tradeNo)).status, 3);
});

test("人工补单后渠道才确认收款：只记账，不重复开通也不转余额", async () => {
  const { cookie, userId } = await createUser();
  const { tradeNo, transactionId, providerTradeNo, amount } = await orderWithCheckout(cookie);
  await query("UPDATE orders SET status = 3, fulfillment_source = 'admin', completed_at = CURRENT_TIMESTAMP WHERE trade_no = ?", [tradeNo]);
  const before = await balanceOf(userId);

  assert.equal((await confirmPayment(tradeNo, providerTradeNo, amount)).status, 200);
  assert.equal(await balanceOf(userId), before);
  assert.equal(await transactionStatus(transactionId), "completed");
  assert.match((await orderRow(tradeNo)).admin_remark ?? "", /与人工补单对应/);
});

test("超时未付的订单被 worker 自动关闭，未超时的保留", async () => {
  const { cookie } = await createUser();
  const expired = await orderWithCheckout(cookie);

  await query("UPDATE orders SET updated_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 11 MINUTE) WHERE trade_no = ?", [expired.tradeNo]);
  const { sweepOrderPayments } = await import("../../src/lib/server/payments/order-payments.ts");
  const result = await sweepOrderPayments();
  assert.ok(result.closedOrders >= 1, JSON.stringify(result));
  assert.equal((await orderRow(expired.tradeNo)).status, 2);
  assert.equal(await transactionStatus(expired.transactionId), "closed");

  const { cookie: otherCookie } = await createUser();
  const recent = await orderWithCheckout(otherCookie);
  await query("UPDATE orders SET updated_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 5 MINUTE) WHERE trade_no = ?", [recent.tradeNo]);
  await sweepOrderPayments();
  assert.equal((await orderRow(recent.tradeNo)).status, 0, "未超时订单不应被关闭");
});
