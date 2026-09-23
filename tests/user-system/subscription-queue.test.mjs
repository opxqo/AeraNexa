/**
 * 多套餐排队生效与流量重置定价。运行前需启动本地 Next 服务。
 * 规则见 src/lib/server/subscription-rules.ts：生效中买别的套餐 → 排队，到期后按付款顺序生效；
 * 流量重置价 = 当前套餐月付价 × 后台比例（默认 75%）。
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";
import { enableMockPaymentForTests, restoreMockPaymentMethod } from "./helpers.mjs";

const baseUrl = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const dbConfig = { host: process.env.DB_HOST ?? "127.0.0.1", port: Number(process.env.DB_PORT ?? 3306), database: process.env.DB_NAME ?? "aeranexa", user: process.env.DB_USER ?? "root", password: process.env.DB_PASSWORD };
const created = { emails: [], plans: [] };
const post = (path, body, cookie) => fetch(`${baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
const get = (path, cookie) => fetch(`${baseUrl}${path}`, { headers: { cookie } });
const GB = 1073741824;

async function query(sql, params = []) {
  const connection = await mysql.createConnection(dbConfig);
  try {
    const [rows] = await connection.query(sql, params);
    return rows;
  } finally {
    await connection.end();
  }
}

let mockPaymentWasEnabled = null;
before(async () => {
  mockPaymentWasEnabled = await enableMockPaymentForTests();
});

after(async () => {
  const [users] = created.emails.length ? [await query("SELECT id FROM users WHERE email IN (?)", [created.emails])] : [[]];
  const ids = users.map((user) => user.id);
  if (ids.length) {
    const orders = "SELECT id FROM orders WHERE user_id IN (?)";
    await query(`DELETE FROM payment_events WHERE order_id IN (${orders})`, [ids]);
    await query(`DELETE FROM commission_records WHERE order_id IN (${orders})`, [ids]).catch(() => {});
    await query("DELETE FROM wallet_transactions WHERE user_id IN (?)", [ids]);
    await query(`DELETE FROM payment_transactions WHERE order_id IN (${orders})`, [ids]);
    await query("DELETE FROM orders WHERE user_id IN (?)", [ids]);
    await query("DELETE FROM panel_clients WHERE user_id IN (?)", [ids]).catch(() => {});
    await query("DELETE FROM auth_sessions WHERE user_id IN (?)", [ids]);
    await query("DELETE FROM users WHERE id IN (?)", [ids]);
  }
  if (created.plans.length) await query("DELETE FROM plans WHERE id IN (?)", [created.plans]);
  await restoreMockPaymentMethod(mockPaymentWasEnabled);
  const { getDbPool } = await import("../../src/lib/server/db.ts");
  await getDbPool().end().catch(() => {});
});

async function createPlan({ monthPrice = null, quarterPrice = null, onetimePrice = null, transferGb = 100 } = {}) {
  const result = await query(
    "INSERT INTO plans (name, transfer_enable, month_price, quarter_price, onetime_price, is_visible, is_renewable) VALUES (?, ?, ?, ?, ?, 1, 1)",
    [`queue-plan-${Date.now()}-${randomBytes(2).toString("hex")}`, transferGb, monthPrice, quarterPrice, onetimePrice],
  );
  created.plans.push(Number(result.insertId));
  return Number(result.insertId);
}

async function createUser() {
  const email = `queue-${Date.now()}-${randomBytes(3).toString("hex")}@example.test`;
  created.emails.push(email);
  await query(
    "INSERT INTO users (email, password_hash, nickname, uuid, subscription_token, email_verified_at) VALUES (?, ?, 'queue-test', ?, ?, CURRENT_TIMESTAMP)",
    [email, await bcrypt.hash("queue-test-password", 10), randomUUID(), randomBytes(16).toString("hex")],
  );
  const response = await post("/api/auth/login", { email, password: "queue-test-password" });
  assert.equal(response.status, 200, await response.text());
  const [user] = await query("SELECT id FROM users WHERE email = ?", [email]);
  return { cookie: response.headers.getSetCookie()[0].split(";", 1)[0], userId: Number(user.id) };
}

async function createOrder(cookie, planId, period) {
  const response = await post("/api/client/orders", { plan_id: planId, period }, cookie);
  const body = await response.json();
  return { status: response.status, tradeNo: body.data, message: body.message };
}

/** 下单并用 mock 渠道付款（走真实结算链路）。 */
async function buy(cookie, planId, period = "month_price") {
  const order = await createOrder(cookie, planId, period);
  assert.equal(order.status, 201, order.message);
  const methods = await (await get("/api/client/payment-methods", cookie)).json();
  const mock = methods.data.find((method) => method.payment === "mock");
  const checkout = await (await post("/api/client/orders/checkout", { trade_no: order.tradeNo, method: mock.id }, cookie)).json();
  const confirm = await post("/api/client/orders/mock-confirm", { trade_no: order.tradeNo, transaction_id: checkout.data.transaction_id }, cookie);
  assert.equal(confirm.status, 200, await confirm.clone().text());
  return order.tradeNo;
}

const userRow = async (userId) => (await query("SELECT plan_id, expired_at, upload_bytes, download_bytes, transfer_enable FROM users WHERE id = ?", [userId]))[0];
const orderStatus = async (tradeNo) => Number((await query("SELECT status FROM orders WHERE trade_no = ?", [tradeNo]))[0].status);
const expireNow = (userId) => query("UPDATE users SET expired_at = UNIX_TIMESTAMP() - 10, upload_bytes = ? WHERE id = ?", [5 * GB, userId]);

test("A 生效中先后买 B、C：付款后排队；A 到期 B 生效（流量清零、按 B 的额度），B 到期 C 生效", async () => {
  const [planA, planB, planC] = [await createPlan({ monthPrice: 200 }), await createPlan({ monthPrice: 100, transferGb: 50 }), await createPlan({ monthPrice: 300, transferGb: 300 })];
  const { cookie, userId } = await createUser();
  const { activateQueuedSubscriptions } = await import("../../src/lib/server/client-portal.ts");

  await buy(cookie, planA);
  const b = await buy(cookie, planB);
  const c = await buy(cookie, planC);
  assert.equal(await orderStatus(b), 1, "B 付款后应待生效");
  assert.equal(await orderStatus(c), 1, "C 付款后应待生效");
  const beforeExpiry = await userRow(userId);
  assert.equal(Number(beforeExpiry.plan_id), planA, "A 仍生效");

  // 没到期时 worker 不应开通排队套餐。
  await activateQueuedSubscriptions();
  assert.equal(Number((await userRow(userId)).plan_id), planA);

  await expireNow(userId);
  await activateQueuedSubscriptions();
  const afterA = await userRow(userId);
  assert.equal(Number(afterA.plan_id), planB, "A 到期后 B 生效");
  assert.equal(Number(afterA.upload_bytes) + Number(afterA.download_bytes), 0, "生效时流量清零");
  assert.equal(Number(afterA.transfer_enable), 50 * GB, "额度为 B 的额度");
  assert.ok(Number(afterA.expired_at) > Date.now() / 1000 + 27 * 86400, "B 从现在起算一个月");
  assert.equal(await orderStatus(b), 3);
  assert.equal(await orderStatus(c), 1, "C 继续排队");

  await expireNow(userId);
  await activateQueuedSubscriptions();
  assert.equal(Number((await userRow(userId)).plan_id), planC, "B 到期后 C 生效");
  assert.equal(await orderStatus(c), 3);
});

test("排队期间续费当前套餐：立即叠加到期时间，排队的套餐顺延", async () => {
  const [planA, planB] = [await createPlan({ monthPrice: 200 }), await createPlan({ monthPrice: 100 })];
  const { cookie, userId } = await createUser();
  await buy(cookie, planA);
  const b = await buy(cookie, planB);
  const expiresBefore = Number((await userRow(userId)).expired_at);

  const renew = await buy(cookie, planA);
  assert.equal(await orderStatus(renew), 3, "续费当前套餐立即生效");
  const renewed = await userRow(userId);
  assert.equal(Number(renewed.plan_id), planA);
  assert.ok(Number(renewed.expired_at) > expiresBefore + 27 * 86400, "到期时间叠加一个月");
  assert.equal(await orderStatus(b), 1, "B 继续排队");
});

test("流量重置价 = 当前套餐月付价 × 75%；只能重置当前套餐；付款后立即清零已用流量、到期时间不变", async () => {
  const [planA, planB] = [await createPlan({ monthPrice: 200 }), await createPlan({ monthPrice: 100 })];
  const { cookie, userId } = await createUser();
  await buy(cookie, planA);

  const quote = await (await get("/api/client/orders/reset-quote", cookie)).json();
  assert.equal(quote.data.plan_id, planA);
  assert.equal(quote.data.percent, 75);
  assert.equal(quote.data.price, 150);

  const wrongPlan = await createOrder(cookie, planB, "reset_price");
  assert.equal(wrongPlan.status, 400);
  assert.match(wrongPlan.message, /当前生效中的套餐/);

  await query("UPDATE users SET upload_bytes = ?, download_bytes = ? WHERE id = ?", [30 * GB, 20 * GB, userId]);
  const expiredBefore = Number((await userRow(userId)).expired_at);
  const reset = await buy(cookie, planA, "reset_price");
  const detail = (await (await get(`/api/client/orders/${reset}`, cookie)).json()).data;
  assert.equal(detail.total_amount, 150);
  assert.equal(detail.type, 4);
  const afterReset = await userRow(userId);
  assert.equal(Number(afterReset.upload_bytes) + Number(afterReset.download_bytes), 0, "已用流量清零");
  assert.equal(Number(afterReset.expired_at), expiredBefore, "到期时间不变");
});

test("没有月付价的套餐按最短周期换算每月价格计算重置价", async () => {
  const plan = await createPlan({ quarterPrice: 600 });
  const { cookie } = await createUser();
  await buy(cookie, plan, "quarter_price");
  const quote = await (await get("/api/client/orders/reset-quote", cookie)).json();
  assert.equal(quote.data.price, 150, "600/3=200，×75%=150");
});

test("没有生效中的套餐不能购买流量重置；永久套餐不能再买其它套餐", async () => {
  const [monthly, permanent] = [await createPlan({ monthPrice: 200 }), await createPlan({ onetimePrice: 1000 })];
  const { cookie } = await createUser();
  const quote = await get("/api/client/orders/reset-quote", cookie);
  assert.equal(quote.status, 400);
  assert.match((await quote.json()).message, /生效中的订阅/);

  await buy(cookie, permanent, "onetime_price");
  const blocked = await createOrder(cookie, monthly, "month_price");
  assert.equal(blocked.status, 400);
  assert.match(blocked.message, /永久套餐/);
  const resetQuote = await (await get("/api/client/orders/reset-quote", cookie)).json();
  assert.equal(resetQuote.data.price, 750, "永久套餐按一次性价 × 75%");
});
