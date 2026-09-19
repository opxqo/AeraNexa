/**
 * 交付验收回归套件
 *
 * 覆盖五大系统：用户、套餐、订单、工单、后台管理，以及异常与边界场景。
 * 运行方式（必须带 --env-file，否则读不到 DB_PASSWORD）：
 *   node --env-file=.env.local --test tests/acceptance/*.test.mjs
 *
 * 所有测试数据均带时间戳前缀，并在收尾时按外键顺序清理，不会污染业务库。
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { enableMockPaymentForTests, restoreMockPaymentMethod } from "../user-system/helpers.mjs";

/**
 * 从导航配置里解析出所有后台板块路径（概览为 ""）。
 *
 * 早先这里是一份手写列表，新增板块时没人会同步更新它，新板块因此不进回归集。
 * 直接读源文件可以保证两者永远一致。
 */
async function readAdminSectionPaths() {
  const source = await readFile(new URL("../../src/lib/admin-navigation.ts", import.meta.url), "utf8");
  const paths = [...source.matchAll(/href:\s*"\/admin([\w/-]*)"/g)].map((match) => match[1]);
  return [...new Set(paths)];
}

const baseUrl = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "test-password-123";
const BYTES_PER_GB = 1073741824;
/** 与 src/lib/server/traffic.ts 的兜底保持一致：dev 环境未配置时用这个默认值。 */
const NODE_TRAFFIC_SECRET = process.env.NODE_TRAFFIC_SECRET?.trim() || "aeranexa-local-node-traffic-secret";

const created = {
  emails: [],
  planIds: [],
  couponCodes: [],
  noticeIds: [],
  knowledgeIds: [],
  nodeIds: [],
};

const dbConfig = {
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3306),
  database: process.env.DB_NAME ?? "aeranexa",
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD,
};

const connect = () => mysql.createConnection(dbConfig);

let db;

async function getDb() {
  if (!db) db = await connect();
  return db;
}

/**
 * 支付方式是全局可变状态（后台可随时关掉模拟支付），而本套件有十几条用例依赖它。
 * 测试自己打开、跑完还原，不依赖现网配置。
 */
let mockPaymentWasEnabled = null;

before(async () => {
  mockPaymentWasEnabled = await enableMockPaymentForTests();
});

/** 按外键依赖顺序清理本轮产生的全部数据。 */
after(async () => {
  if (db) {
    await db.end();
    db = null;
  }
  await restoreMockPaymentMethod(mockPaymentWasEnabled);
  if (!created.emails.length && !created.planIds.length && !created.couponCodes.length
      && !created.noticeIds.length && !created.knowledgeIds.length && !created.nodeIds.length) return;

  const connection = await connect();
  const failures = [];
  /**
   * 单条清理失败不应中断整轮清理。
   *
   * 曾经因为漏删一张 ON DELETE RESTRICT 的表，钩子在外键错误处直接中止，
   * 结果**整批测试数据全部残留**（一次留下 60 个用户）。所以这里逐条捕获，
   * 能删的都删掉，最后把失败汇总抛出——既不静默吞错，也不会因一处失败丢掉全部清理。
   */
  const drop = async (sql, params) => {
    try {
      await connection.query(sql, params);
    } catch (error) {
      failures.push(`${sql.slice(0, 60)}… → ${error.sqlMessage ?? error.message}`);
    }
  };

  try {
    if (created.emails.length) {
      const [users] = await connection.query("SELECT id FROM users WHERE email IN (?)", [created.emails]);
      const userIds = users.map((row) => row.id);
      if (userIds.length) {
        // commission_logs 与 user_referrals 对 users 都是 ON DELETE RESTRICT，
        // 必须先于 users 清理（user_referrals 只有 invited_user_id 是 CASCADE）。
        await drop("DELETE FROM commission_logs WHERE inviter_user_id IN (?) OR invited_user_id IN (?)", [userIds, userIds]);
        await drop("DELETE FROM user_referrals WHERE inviter_user_id IN (?) OR invited_user_id IN (?)", [userIds, userIds]);
        await drop("DELETE FROM wallet_transactions WHERE user_id IN (?)", [userIds]);
        await drop("DELETE FROM coupon_usages WHERE user_id IN (?)", [userIds]);
        await drop("DELETE FROM ticket_messages WHERE ticket_id IN (SELECT id FROM tickets WHERE user_id IN (?))", [userIds]);
        await drop("DELETE FROM tickets WHERE user_id IN (?)", [userIds]);
        await drop("DELETE FROM payment_transactions WHERE order_id IN (SELECT id FROM orders WHERE user_id IN (?))", [userIds]);
        await drop("DELETE FROM orders WHERE user_id IN (?)", [userIds]);
        await drop("DELETE FROM invite_codes WHERE user_id IN (?)", [userIds]);
        await drop("DELETE FROM auth_sessions WHERE user_id IN (?)", [userIds]);
        await drop("DELETE FROM audit_logs WHERE user_id IN (?)", [userIds]);
        // 登录失败审计在部分路径下 user_id 为 null，需按 context.email 兜底清理。
        await drop("DELETE FROM audit_logs WHERE JSON_UNQUOTE(JSON_EXTRACT(context, '$.email')) IN (?)", [created.emails]);
        await drop("DELETE FROM users WHERE id IN (?)", [userIds]);
      }
    }
    if (created.couponCodes.length) {
      await drop("DELETE FROM coupon_usages WHERE coupon_id IN (SELECT id FROM coupons WHERE code IN (?))", [created.couponCodes]);
      await drop("DELETE FROM coupons WHERE code IN (?)", [created.couponCodes]);
    }
    if (created.planIds.length) {
      await drop("DELETE FROM orders WHERE plan_id IN (?)", [created.planIds]);
      await drop("DELETE FROM plans WHERE id IN (?)", [created.planIds]);
    }
    if (created.noticeIds.length) {
      await drop("DELETE FROM notices WHERE id IN (?)", [created.noticeIds]);
    }
    if (created.knowledgeIds.length) {
      await drop("DELETE FROM knowledge_articles WHERE id IN (?)", [created.knowledgeIds]);
    }
    // node_traffic_records 对 nodes 是 ON DELETE CASCADE，删节点即可带走其流量记录。
    if (created.nodeIds.length) {
      await drop("DELETE FROM nodes WHERE id IN (?)", [created.nodeIds]);
    }
  } finally {
    await connection.end();
  }

  // 清理失败必须让用例失败，否则残留会一直堆在库里、下次更难查。
  if (failures.length) assert.fail(`测试数据清理失败：\n${failures.join("\n")}`);
});

async function createPlan(overrides = {}) {
  const connection = await getDb();
  const name = `anx-accept-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const [result] = await connection.execute(
    `INSERT INTO plans (name, transfer_enable, month_price, quarter_price, year_price, is_visible, is_renewable)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      overrides.transferEnable ?? 100,
      overrides.monthPrice ?? 990,
      overrides.quarterPrice ?? 2790,
      overrides.yearPrice ?? null,
      overrides.isVisible ?? 1,
      overrides.isRenewable ?? 1,
    ],
  );
  created.planIds.push(Number(result.insertId));
  return Number(result.insertId);
}

async function createCoupon(overrides = {}) {
  const connection = await getDb();
  const code = `ANX${Date.now()}${Math.random().toString(16).slice(2, 6)}`.toUpperCase();
  await connection.execute(
    `INSERT INTO coupons (code, name, discount_type, discount_value, max_uses, max_uses_per_user, plan_ids, periods, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      code,
      overrides.name ?? "验收优惠券",
      overrides.discountType ?? 1,
      overrides.discountValue ?? 500,
      overrides.maxUses ?? null,
      overrides.maxUsesPerUser ?? null,
      overrides.planIds ? JSON.stringify(overrides.planIds) : null,
      overrides.periods ? JSON.stringify(overrides.periods) : null,
    ],
  );
  created.couponCodes.push(code);
  return code;
}

async function createNotice(overrides = {}) {
  const connection = await getDb();
  const title = `anx-accept-notice-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const [result] = await connection.execute(
    `INSERT INTO notices (title, content, image_url, tags, is_visible, published_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      title,
      overrides.content ?? "<p>验收公告正文</p>",
      overrides.imageUrl ?? null,
      // tags 是 JSON 列：mysql2 读出来会是数组，写入时给字符串即可。
      overrides.tags ? JSON.stringify(overrides.tags) : null,
      overrides.isVisible ?? 1,
      // published_at 按 UTC 挂钟时间存储：listNotices 在 SQL 里与 CURRENT_TIMESTAMP 比较。
      overrides.publishedAt ?? null,
    ],
  );
  created.noticeIds.push(Number(result.insertId));
  return { id: Number(result.insertId), title };
}

async function createKnowledge(overrides = {}) {
  const connection = await getDb();
  const title = `anx-accept-doc-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const category = overrides.category ?? `anx-accept-cat-${Date.now()}`;
  const [result] = await connection.execute(
    `INSERT INTO knowledge_articles (language, category, title, body, sort_order, is_visible)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      overrides.language ?? "zh-CN",
      category,
      title,
      overrides.body ?? "<p>验收文档正文</p>",
      overrides.sortOrder ?? 0,
      overrides.isVisible ?? 1,
    ],
  );
  created.knowledgeIds.push(Number(result.insertId));
  return { id: Number(result.insertId), title, category };
}

/** 建一个测试节点。node_traffic_records 需要真实存在的 node_id（外键约束）。 */
async function createNode() {
  const connection = await getDb();
  const name = `anx-accept-node-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const [result] = await connection.execute(
    `INSERT INTO nodes (name, protocol, host, port, is_visible) VALUES (?, 'vmess', '127.0.0.1', ?, 0)`,
    [name, 10000 + Math.floor(Math.random() * 50000)],
  );
  const id = Number(result.insertId);
  created.nodeIds.push(id);
  return id;
}

async function register() {
  const email = `anx-accept-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
  created.emails.push(email);
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, password_confirmation: PASSWORD, email_code: "666666" }),
  });
  if (response.status !== 201) assert.fail(`注册失败：${await response.text()}`);
  const cookie = response.headers.getSetCookie()[0]?.split(";", 1)[0];
  assert.ok(cookie, "注册应下发会话 Cookie");
  return { email, cookie };
}

async function promoteToAdmin(email) {
  const connection = await getDb();
  await connection.execute("UPDATE users SET role = 'admin' WHERE email = ?", [email]);
}

const jsonHeaders = (cookie) => ({ "content-type": "application/json", cookie });
const get = (path, cookie) => fetch(`${baseUrl}${path}`, { headers: cookie ? { cookie } : {} });
const post = (path, cookie, body) =>
  fetch(`${baseUrl}${path}`, { method: "POST", headers: jsonHeaders(cookie), body: JSON.stringify(body) });

async function expectStatus(response, status, label) {
  const text = await response.text();
  assert.equal(response.status, status, `${label}：期望 ${status}，实际 ${response.status}，响应 ${text}`);
  return text ? JSON.parse(text) : null;
}

/** 完整走一遍「下单 → 结算 → 模拟支付」，返回订单号与交易号。 */
async function placeAndPayOrder(cookie, planId, period = "month_price", couponCode) {
  const create = await post("/api/client/orders", cookie, { plan_id: planId, period, coupon_code: couponCode });
  const createdBody = await expectStatus(create, 201, "创建订单");
  return placeAndPayOrderFor(cookie, createdBody.data);
}

/** 对一笔已存在的待支付订单走完「结算 → 模拟支付」。 */
async function placeAndPayOrderFor(cookie, tradeNo) {
  const methods = await expectStatus(await get("/api/client/payment-methods", cookie), 200, "支付方式列表");
  const mock = methods.data.find((method) => method.payment === "mock");
  assert.ok(mock, "应提供模拟支付方式");

  const checkout = await post("/api/client/orders/checkout", cookie, { trade_no: tradeNo, method: mock.id });
  const checkoutBody = await expectStatus(checkout, 200, "结算下单");
  assert.equal(checkoutBody.data.provider, "mock");

  const confirm = await post("/api/client/orders/mock-confirm", cookie, {
    trade_no: tradeNo,
    transaction_id: checkoutBody.data.transaction_id,
  });
  const confirmBody = await expectStatus(confirm, 200, "模拟支付确认");

  return { tradeNo, transactionId: checkoutBody.data.transaction_id, order: confirmBody.data };
}

/* ------------------------------------------------------------------ *
 * 用户系统
 * ------------------------------------------------------------------ */

test("[用户] 注册拒绝缺少邮箱验证码的请求", async () => {
  const email = `anx-accept-nocode-${Date.now()}@example.test`;
  created.emails.push(email);
  const response = await post("/api/auth/register", null, {
    email,
    password: PASSWORD,
    password_confirmation: PASSWORD,
  });
  const body = await expectStatus(response, 400, "注册缺验证码");
  assert.equal(body.code, "invalid_request");
  assert.equal(typeof body.message, "string");
});

test("[用户] 登录成功返回本次登录时间，错误密码被拒绝", async () => {
  const { email } = await register();
  const bad = await post("/api/auth/login", null, { email, password: "wrong-password" });
  await expectStatus(bad, 401, "错误密码登录");

  const before = Math.floor(Date.now() / 1000) - 2;
  const good = await post("/api/auth/login", null, { email, password: PASSWORD });
  const body = await expectStatus(good, 200, "正确密码登录");
  assert.equal(typeof body.data.last_login_at, "number");
  assert.ok(body.data.last_login_at >= before, "登录时间应为本次请求时间");
});

test("[用户] 未登录访问客户接口一律 401", async () => {
  for (const path of ["/api/client/plans", "/api/client/orders", "/api/client/tickets", "/api/client/invites"]) {
    const response = await get(path);
    assert.equal(response.status, 401, `${path} 未登录应返回 401`);
  }
});

test("[用户] 订阅信息包含服务端时间、剩余天数与私有订阅地址", async () => {
  const { cookie } = await register();
  const body = await expectStatus(await get("/api/user/getSubscribe", cookie), 200, "订阅信息");
  assert.match(body.data.token, /^[a-f0-9]{32}$/);
  assert.equal(typeof body.data.server_time, "number");
  const url = new URL(body.data.subscribe_url);
  assert.equal(url.origin, new URL(baseUrl).origin);
  assert.equal(url.pathname, "/api/v1/client/subscribe");
  assert.equal(url.searchParams.get("token"), body.data.token);
});

test("[用户] 偏好更新校验非法值，损坏 JSON 归为客户端错误", async () => {
  const { cookie } = await register();
  const bad = await post("/api/user/update", cookie, { remind_expire: "yes" });
  const body = await expectStatus(bad, 400, "非法偏好值");
  assert.equal(body.message, "提醒设置格式不正确");

  const broken = await fetch(`${baseUrl}/api/user/changePassword`, {
    method: "POST",
    headers: jsonHeaders(cookie),
    body: "{",
  });
  const brokenBody = await expectStatus(broken, 400, "损坏 JSON");
  assert.equal(brokenBody.message, "请求格式不正确");
});

test("[用户] 修改密码后全部旧会话失效且不能沿用原密码", async () => {
  const { email, cookie: first } = await register();
  const secondLogin = await post("/api/auth/login", null, { email, password: PASSWORD });
  const second = secondLogin.headers.getSetCookie()[0]?.split(";", 1)[0];
  assert.ok(second, "第二次登录应下发新会话");

  const same = await post("/api/user/changePassword", first, { old_password: PASSWORD, new_password: PASSWORD });
  await expectStatus(same, 400, "新旧密码相同");

  const changed = await post("/api/user/changePassword", first, {
    old_password: PASSWORD,
    new_password: "changed-password-456",
  });
  await expectStatus(changed, 200, "修改密码");

  for (const cookie of [first, second]) {
    assert.equal((await get("/api/auth/me", cookie)).status, 401, "旧会话应失效");
  }
  assert.equal((await post("/api/auth/login", null, { email, password: PASSWORD })).status, 401);
  assert.equal((await post("/api/auth/login", null, { email, password: "changed-password-456" })).status, 200);
});

test("[用户] 注销后会话不可重放", async () => {
  const { cookie } = await register();
  await expectStatus(await post("/api/auth/logout", cookie, {}), 200, "注销");
  assert.equal((await get("/api/auth/me", cookie)).status, 401);
});

test("[用户] 已删除用户的合法签名会话同样被拒绝", async () => {
  const { email, cookie } = await register();
  const connection = await getDb();
  await connection.execute("DELETE FROM users WHERE email = ?", [email]);

  const response = await fetch(`${baseUrl}/dashboard`, { redirect: "manual", headers: { cookie } });
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get("location"), baseUrl).pathname, "/login");
});

/* ------------------------------------------------------------------ *
 * 套餐系统
 * ------------------------------------------------------------------ */

test("[套餐] 列表只返回可见套餐且携带可用周期", async () => {
  const visible = await createPlan({ isVisible: 1, transferEnable: 100, monthPrice: 990 });
  const hidden = await createPlan({ isVisible: 0, monthPrice: 990 });
  const { cookie } = await register();

  const body = await expectStatus(await get("/api/client/plans", cookie), 200, "套餐列表");
  const ids = body.data.map((plan) => plan.id);
  assert.ok(ids.includes(visible), "可见套餐应出现在列表中");
  assert.ok(!ids.includes(hidden), "不可见套餐不应出现在列表中");

  const plan = body.data.find((item) => item.id === visible);
  assert.ok(Array.isArray(plan.available_periods), "套餐应携带 available_periods");
  assert.ok(plan.available_periods.includes("month_price"), "有月付价格则应提供月付周期");
  assert.ok(!plan.available_periods.includes("half_year_price"), "无半年付价格则不应提供该周期");
});

/* ------------------------------------------------------------------ *
 * 订单系统
 * ------------------------------------------------------------------ */

test("[订单] 下单返回订单号，列表带分页元信息，详情带语义标签", async () => {
  const planId = await createPlan({ monthPrice: 990 });
  const { cookie } = await register();

  const create = await post("/api/client/orders", cookie, { plan_id: planId, period: "month_price" });
  const tradeNo = (await expectStatus(create, 201, "下单")).data;
  assert.match(tradeNo, /^ANX/, "订单号应有 ANX 前缀");

  const list = await expectStatus(await get("/api/client/orders", cookie), 200, "订单列表");
  assert.ok(Array.isArray(list.data));
  assert.equal(typeof list.meta.total, "number");
  assert.equal(typeof list.meta.has_more, "boolean");

  const detail = await expectStatus(await get(`/api/client/orders/${tradeNo}`, cookie), 200, "订单详情");
  assert.equal(detail.data.trade_no, tradeNo);
  assert.equal(detail.data.status_label, "待支付");
  assert.equal(detail.data.period_label, "月付");
  assert.equal(detail.data.type_label, "新购");
  assert.equal(typeof detail.data.subtotal_amount, "number");
});

test("[订单] 非法周期与不存在套餐被拒绝", async () => {
  const planId = await createPlan({ monthPrice: 990 });
  const { cookie } = await register();

  const badPeriod = await post("/api/client/orders", cookie, { plan_id: planId, period: "not_a_period" });
  await expectStatus(badPeriod, 400, "非法周期");

  const badPlan = await post("/api/client/orders", cookie, { plan_id: 999999999, period: "month_price" });
  assert.ok([400, 404].includes(badPlan.status), `不存在套餐应返回 400/404，实际 ${badPlan.status}`);

  const noPlan = await post("/api/client/orders", cookie, { period: "month_price" });
  await expectStatus(noPlan, 400, "缺少套餐");
});

test("[订单] 15 分钟内重复下单同一套餐被 409 拦截", async () => {
  const planId = await createPlan({ monthPrice: 990 });
  const { cookie } = await register();

  await expectStatus(await post("/api/client/orders", cookie, { plan_id: planId, period: "month_price" }), 201, "首次下单");
  const duplicate = await post("/api/client/orders", cookie, { plan_id: planId, period: "month_price" });
  const body = await expectStatus(duplicate, 409, "重复下单");
  assert.equal(body.code, "conflict");
});

test("[订单] 支付后订阅按自然月开通，额度按 GB 换算", async () => {
  const planId = await createPlan({ monthPrice: 990, transferEnable: 100 });
  const { cookie } = await register();

  const { tradeNo, order } = await placeAndPayOrder(cookie, planId);
  assert.equal(order.status, 3, "支付后订单应为已完成");

  const info = await expectStatus(await get("/api/user/info", cookie), 200, "用户信息");
  assert.equal(info.data.plan_id, planId);

  const subscribe = await expectStatus(await get("/api/user/getSubscribe", cookie), 200, "订阅信息");
  assert.equal(subscribe.data.transfer_enable, 100 * BYTES_PER_GB, "额度应为 GB 换算后的字节数");
  assert.ok(subscribe.data.days_remaining >= 28 && subscribe.data.days_remaining <= 31, "剩余天数应约为一个月");

  const detail = await expectStatus(await get(`/api/client/orders/${tradeNo}`, cookie), 200, "订单详情");
  assert.equal(detail.data.status, 3);
  assert.equal(detail.data.status_label, "已完成");
});

test("[订单] 重复支付回调幂等，不会重复加时或重复计佣", async () => {
  const planId = await createPlan({ monthPrice: 990 });
  const { cookie } = await register();
  const { tradeNo, transactionId } = await placeAndPayOrder(cookie, planId);

  const first = await expectStatus(await get("/api/user/info", cookie), 200, "首次支付后信息");
  const replay = await post("/api/client/orders/mock-confirm", cookie, {
    trade_no: tradeNo,
    transaction_id: transactionId,
  });
  const replayBody = await expectStatus(replay, 200, "重复回调");
  assert.equal(replayBody.data.status, 3, "重复回调应直接返回已完成订单");

  const second = await expectStatus(await get("/api/user/info", cookie), 200, "重复回调后信息");
  assert.equal(second.data.expired_at, first.data.expired_at, "重复回调不应延长到期时间");
});

test("[订单] 并发支付回调只履约一次，到期时间不被叠加", async () => {
  const planId = await createPlan({ monthPrice: 990 });
  const { cookie } = await register();

  const create = await post("/api/client/orders", cookie, { plan_id: planId, period: "month_price" });
  const tradeNo = (await expectStatus(create, 201, "下单")).data;
  const methods = await expectStatus(await get("/api/client/payment-methods", cookie), 200, "支付方式列表");
  const mock = methods.data.find((method) => method.payment === "mock");
  const checkout = await post("/api/client/orders/checkout", cookie, { trade_no: tradeNo, method: mock.id });
  const transactionId = (await expectStatus(checkout, 200, "结算下单")).data.transaction_id;

  // 5 个回调同时打进来，只有一次应真正履约，其余必须幂等或被拒。
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      post("/api/client/orders/mock-confirm", cookie, { trade_no: tradeNo, transaction_id: transactionId }),
    ),
  );

  const statuses = results.map((response) => response.status);
  assert.ok(statuses.includes(200), `应至少有一次回调成功，实际 ${statuses.join(",")}`);
  for (const status of statuses) {
    assert.ok([200, 409].includes(status), `并发回调只应返回 200 或 409，实际 ${status}`);
  }

  const fulfilled = results.filter((response) => response.status === 200);
  const bodies = await Promise.all(fulfilled.map((response) => response.json()));
  for (const body of bodies) {
    assert.equal(body.data.status, 3, "所有成功回调都应返回已完成订单");
  }

  const info = await expectStatus(await get("/api/user/info", cookie), 200, "并发回调后用户信息");
  const subscribe = await expectStatus(await get("/api/user/getSubscribe", cookie), 200, "并发回调后订阅信息");
  const days = subscribe.data.days_remaining;
  assert.ok(days >= 28 && days <= 31, `并发回调后剩余天数应仍约为一个月，实际 ${days}`);

  // 到期时间必须只推后一个自然月，不能因并发而叠加。
  const expected = new Date(info.data.expired_at * 1000);
  const oneMonthLater = new Date();
  oneMonthLater.setUTCMonth(oneMonthLater.getUTCMonth() + 1);
  assert.equal(
    expected.getUTCMonth(),
    oneMonthLater.getUTCMonth(),
    `到期时间应只推进一个自然月，实际 ${expected.toISOString()}`,
  );
});

test("[订单] 取消订单后同一套餐可重新下单", async () => {
  const planId = await createPlan({ monthPrice: 990 });
  const { cookie } = await register();

  const tradeNo = (await expectStatus(await post("/api/client/orders", cookie, { plan_id: planId, period: "month_price" }), 201, "下单")).data;
  await expectStatus(await post("/api/client/orders/cancel", cookie, { trade_no: tradeNo }), 200, "取消订单");

  const detail = await expectStatus(await get(`/api/client/orders/${tradeNo}`, cookie), 200, "取消后详情");
  assert.equal(detail.data.status, 2);
  assert.equal(detail.data.status_label, "已取消");

  await expectStatus(await post("/api/client/orders", cookie, { plan_id: planId, period: "month_price" }), 201, "重新下单");
});

test("[订单] 续费被识别为续费类型而非新购", async () => {
  const planId = await createPlan({ monthPrice: 990, isRenewable: 1 });
  const { cookie } = await register();
  await placeAndPayOrder(cookie, planId);

  const renew = await post("/api/client/orders", cookie, { plan_id: planId, period: "month_price" });
  const tradeNo = (await expectStatus(renew, 201, "续费下单")).data;
  const detail = await expectStatus(await get(`/api/client/orders/${tradeNo}`, cookie), 200, "续费订单详情");
  assert.equal(detail.data.type, 2);
  assert.equal(detail.data.type_label, "续费");
});

test("[订单] 优惠券核销、取消释放、可再次使用", async () => {
  const planId = await createPlan({ monthPrice: 990 });
  const code = await createCoupon({ discountType: 1, discountValue: 500, planIds: [planId] });
  const { cookie } = await register();

  const check = await post("/api/client/coupons/check", cookie, { code, plan_id: planId, period: "month_price" });
  const checkBody = await expectStatus(check, 200, "校验优惠券");
  assert.equal(checkBody.data.discount_amount, 500);

  const withCoupon = await post("/api/client/orders", cookie, { plan_id: planId, period: "month_price", coupon_code: code });
  const tradeNo = (await expectStatus(withCoupon, 201, "用券下单")).data;
  const detail = await expectStatus(await get(`/api/client/orders/${tradeNo}`, cookie), 200, "用券订单详情");
  assert.equal(detail.data.discount_amount, 500, "应记录抵扣金额");
  assert.equal(detail.data.total_amount, 490, "应付金额应为原价减抵扣");

  await expectStatus(await post("/api/client/orders/cancel", cookie, { trade_no: tradeNo }), 200, "取消用券订单");

  const reuse = await post("/api/client/orders", cookie, { plan_id: planId, period: "month_price", coupon_code: code });
  await expectStatus(reuse, 201, "取消后重新用券");
});

test("[订单] 优惠券超出全局使用上限时被 409 拒绝", async () => {
  const planId = await createPlan({ monthPrice: 990 });
  const code = await createCoupon({ discountValue: 500, maxUses: 1, planIds: [planId] });

  const first = await register();
  await placeAndPayOrder(first.cookie, planId, "month_price", code);

  const second = await register();
  const exceeded = await post("/api/client/orders", second.cookie, { plan_id: planId, period: "month_price", coupon_code: code });
  const body = await expectStatus(exceeded, 409, "优惠券超限");
  assert.equal(body.message, "优惠券已被领完");
});

test("[订单] 不存在的优惠码被拒绝", async () => {
  const planId = await createPlan({ monthPrice: 990 });
  const { cookie } = await register();
  const response = await post("/api/client/coupons/check", cookie, {
    code: "ANX-NOT-EXIST",
    plan_id: planId,
    period: "month_price",
  });
  assert.ok(response.status >= 400 && response.status < 500, `无效优惠码应为 4xx，实际 ${response.status}`);
});

test("[订单] 优惠券的适用套餐与适用周期限制真正生效", async () => {
  const allowedPlan = await createPlan({ monthPrice: 990, yearPrice: 9900 });
  const otherPlan = await createPlan({ monthPrice: 2990 });
  const code = await createCoupon({ discountValue: 500, planIds: [allowedPlan], periods: ["month_price"] });
  const { cookie } = await register();

  // 落在适用范围里：放行
  const ok = await post("/api/client/coupons/check", cookie, { code, plan_id: allowedPlan, period: "month_price" });
  assert.equal((await expectStatus(ok, 200, "适用范围内校验")).data.discount_amount, 500);

  // 不适用于该套餐：拒绝。plan_ids 是 JSON 列，读取侧一旦解析失败就会把这段校验整个跳过。
  const wrongPlan = await post("/api/client/coupons/check", cookie, { code, plan_id: otherPlan, period: "month_price" });
  assert.equal((await expectStatus(wrongPlan, 400, "不适用套餐")).message, "该优惠券不适用于此套餐");

  // 不适用于该周期：拒绝
  const wrongPeriod = await post("/api/client/coupons/check", cookie, { code, plan_id: allowedPlan, period: "year_price" });
  assert.equal((await expectStatus(wrongPeriod, 400, "不适用周期")).message, "该优惠券不适用于所选付款周期");

  // 下单路径与校验路径共用同一套规则，同样必须拦住
  const order = await post("/api/client/orders", cookie, { plan_id: otherPlan, period: "month_price", coupon_code: code });
  assert.equal(order.status, 400, "下单时也应拒绝不适用的优惠券");
});

test("[订单] 升级折抵后原订单被标记为已折抵", async () => {
  const basePlan = await createPlan({ monthPrice: 990, quarterPrice: 2790 });
  const higherPlan = await createPlan({ monthPrice: 9900, quarterPrice: 27900 });
  const { cookie } = await register();

  const base = await placeAndPayOrder(cookie, basePlan, "month_price");

  const upgrade = await post("/api/client/orders", cookie, { plan_id: higherPlan, period: "quarter_price" });
  const upgradeTradeNo = (await expectStatus(upgrade, 201, "升级下单")).data;
  const detail = await expectStatus(await get(`/api/client/orders/${upgradeTradeNo}`, cookie), 200, "升级订单详情");
  assert.equal(detail.data.type, 3, "应识别为升级订单");
  assert.ok(detail.data.surplus_amount > 0, "升级应产生折抵金额");

  await placeAndPayOrderFor(cookie, upgradeTradeNo);

  const connection = await getDb();
  const [rows] = await connection.execute("SELECT status FROM orders WHERE trade_no = ?", [base.tradeNo]);
  assert.equal(Number(rows[0].status), 4, "被折抵的原订单应转为「已折抵」");
});

/* ------------------------------------------------------------------ *
 * 工单系统
 * ------------------------------------------------------------------ */

test("[工单] 创建、回复、详情与关闭全链路", async () => {
  const { cookie } = await register();

  const create = await post("/api/client/tickets", cookie, { subject: "验收工单", level: 1, message: "首条消息" });
  const ticketId = (await expectStatus(create, 201, "创建工单")).data;
  assert.ok(Number.isInteger(ticketId));

  const reply = await post("/api/client/tickets/reply", cookie, { id: ticketId, message: "补充说明" });
  await expectStatus(reply, 200, "回复工单");

  const detail = await expectStatus(await get(`/api/client/tickets/${ticketId}`, cookie), 200, "工单详情");
  assert.equal(detail.data.message.length, 2, "应包含首条消息与回复");
  assert.ok(detail.data.message.every((item) => item.is_me === true), "用户自己发的消息 is_me 应为 true");

  const close = await post("/api/client/tickets/close", cookie, { id: ticketId });
  await expectStatus(close, 200, "关闭工单");

  const closed = await expectStatus(await get(`/api/client/tickets/${ticketId}`, cookie), 200, "关闭后详情");
  assert.equal(closed.data.status, 1, "关闭后状态应为已关闭");
});

test("[工单] 缺少必填字段被拒绝", async () => {
  const { cookie } = await register();
  const noLevel = await post("/api/client/tickets", cookie, { subject: "缺优先级", message: "x" });
  await expectStatus(noLevel, 400, "缺少优先级");

  const emptySubject = await post("/api/client/tickets", cookie, { subject: "", level: 1, message: "x" });
  await expectStatus(emptySubject, 400, "空标题");
});

test("[工单] 访问他人工单被拒绝", async () => {
  const owner = await register();
  const create = await post("/api/client/tickets", owner.cookie, { subject: "私有工单", level: 1, message: "仅本人可见" });
  const ticketId = (await expectStatus(create, 201, "创建工单")).data;

  const other = await register();
  const response = await get(`/api/client/tickets/${ticketId}`, other.cookie);
  assert.ok(response.status >= 400 && response.status < 500, `越权访问应为 4xx，实际 ${response.status}`);
});

/* ------------------------------------------------------------------ *
 * 邀请与佣金
 * ------------------------------------------------------------------ */

test("[邀请] 邀请码携带过期标记，统计为四元组，明细接口可用", async () => {
  const { cookie } = await register();

  const created = await expectStatus(await post("/api/client/invites", cookie, {}), 201, "创建邀请码");
  // 早先这里恒返回 true，调用方拿不到新码，只能再回查一次列表。
  assert.equal(typeof created.data, "string", "创建邀请码接口应返回新码本身");
  assert.ok(created.data.length >= 16, `邀请码长度异常：${created.data}`);

  const invites = await expectStatus(await get("/api/client/invites", cookie), 200, "邀请列表");
  assert.equal(invites.data.stat.length, 4, "统计应为四元组");
  assert.ok(invites.data.codes.length >= 1, "创建后应至少存在一个邀请码");
  assert.ok(invites.data.codes.some((item) => item.code === created.data), "返回的邀请码应能在列表中找到");
  assert.ok(invites.data.codes.every((item) => typeof item.expired === "boolean"), "邀请码应携带服务端计算的过期标记");

  const details = await expectStatus(await get("/api/client/invites/details", cookie), 200, "佣金明细");
  assert.ok(Array.isArray(details.data));
});

test("[邀请] 同时保留的可用邀请码超过 5 个时被 409 拒绝", async () => {
  const { cookie } = await register();
  for (let index = 0; index < 5; index += 1) {
    await expectStatus(await post("/api/client/invites", cookie, {}), 201, `创建第 ${index + 1} 个邀请码`);
  }
  const overflow = await post("/api/client/invites", cookie, {});
  const body = await expectStatus(overflow, 409, "超出邀请码上限");
  assert.equal(body.code, "conflict");
});

test("[邀请] 佣金划转拒绝非法金额", async () => {
  const { cookie } = await register();
  const response = await post("/api/client/commission/transfer", cookie, { transfer_amount: -100 });
  assert.ok(response.status >= 400 && response.status < 500, `非法金额应为 4xx，实际 ${response.status}`);
});

/* ------------------------------------------------------------------ *
 * 后台管理
 * ------------------------------------------------------------------ */

test("[后台] 未登录跳登录页，已登录普通用户被挡回仪表盘", async () => {
  for (const path of ["/admin", "/admin/users", "/admin/orders", "/admin/coupons"]) {
    const anonymous = await fetch(`${baseUrl}${path}`, { redirect: "manual" });
    assert.equal(anonymous.status, 307, `${path} 未登录应被重定向`);
    assert.equal(new URL(anonymous.headers.get("location"), baseUrl).pathname, "/login");
  }

  const { cookie } = await register();
  for (const path of ["/admin", "/admin/users", "/admin/orders", "/admin/coupons"]) {
    const forbidden = await fetch(`${baseUrl}${path}`, { redirect: "manual", headers: { cookie } });
    assert.equal(forbidden.status, 307, `${path} 普通用户应被重定向`);
    assert.equal(
      new URL(forbidden.headers.get("location"), baseUrl).pathname,
      "/dashboard",
      `${path} 已登录普通用户应被挡回仪表盘而非登录页`,
    );
  }
});

test("[后台] 管理员可访问全部板块", async () => {
  const { email, cookie } = await register();
  await promoteToAdmin(email);

  // 路径直接从导航配置解析，而不是在这里再抄一份列表——抄的那份会在新增板块时静默失同步，
  // 新板块因此永远不进回归集（流量统计就是这么漏掉的）。
  const sections = await readAdminSectionPaths();
  assert.ok(sections.length >= 11, `导航板块应有 11 个以上，实际解析到 ${sections.length} 个`);
  for (const section of sections) {
    const response = await fetch(`${baseUrl}/admin${section}`, { headers: { cookie } });
    assert.equal(response.status, 200, `/admin${section} 应返回 200，实际 ${response.status}`);
  }
});

test("[后台] 公告与文档板块可访问并列出内容", async () => {
  const notice = await createNotice();
  const article = await createKnowledge();
  const { email, cookie } = await register();
  await promoteToAdmin(email);

  for (const [section, heading] of [["notices", "公告管理"], ["knowledge", "文档管理"]]) {
    const response = await fetch(`${baseUrl}/admin/${section}`, { headers: { cookie } });
    const html = await response.text();
    assert.equal(response.status, 200, `/admin/${section} 应返回 200`);
    assert.ok(html.includes(heading), `/admin/${section} 应包含板块标题「${heading}」`);
  }

  const noticeHtml = await (await fetch(`${baseUrl}/admin/notices`, { headers: { cookie } })).text();
  assert.ok(noticeHtml.includes(notice.title), "公告管理页应列出已创建的公告");
  const knowledgeHtml = await (await fetch(`${baseUrl}/admin/knowledge`, { headers: { cookie } })).text();
  assert.ok(knowledgeHtml.includes(article.title), "文档管理页应列出已创建的文档");
  assert.ok(knowledgeHtml.includes(article.category), "文档管理页应展示文档分类");
});

test("[后台] 优惠券适用范围与公告标签能正确回显", async () => {
  const planId = await createPlan({ monthPrice: 990 });
  const code = await createCoupon({ discountValue: 500, planIds: [planId], periods: ["month_price"] });
  await createNotice({ tags: ["维护通知", "验收标签"] });
  const { email, cookie } = await register();
  await promoteToAdmin(email);

  // plan_ids / periods 是 JSON 列。读取侧一旦把它们解析成 null，列表就会一律显示
  // 「全部套餐 / 全部周期」，编辑框里的勾选也会是空的，保存后限制被静默清掉。
  const couponHtml = await (await fetch(`${baseUrl}/admin/coupons`, { headers: { cookie } })).text();
  assert.ok(couponHtml.includes(code), "应列出该优惠券");
  assert.ok(couponHtml.includes("1 个套餐"), "应显示实际适用套餐数量，而不是「全部套餐」");
  assert.ok(couponHtml.includes("月付"), "应显示实际适用周期，而不是「全部周期」");

  const noticeHtml = await (await fetch(`${baseUrl}/admin/notices`, { headers: { cookie } })).text();
  assert.ok(noticeHtml.includes("维护通知"), "公告标签应回显在列表里");
});

/* ------------------------------------------------------------------ *
 * 公告与文档的门户可见性
 * ------------------------------------------------------------------ */
test("[门户] 公告按可见性与发布时间过滤", async () => {
  const visible = await createNotice();
  const hidden = await createNotice({ isVisible: 0 });
  // 排期到未来的公告：published_at 存 UTC 挂钟时间，由 SQL 与 CURRENT_TIMESTAMP 比较。
  const scheduled = await createNotice({ publishedAt: "2099-01-01 00:00:00" });

  const { cookie } = await register();
  const body = await expectStatus(await get("/api/client/notices", cookie), 200, "公告列表");
  const titles = body.data.map((item) => item.title);

  assert.ok(titles.includes(visible.title), "已发布且可见的公告应出现在门户");
  assert.ok(!titles.includes(hidden.title), "已隐藏的公告不应出现在门户");
  assert.ok(!titles.includes(scheduled.title), "未到发布时间的公告不应出现在门户");

  const item = body.data.find((row) => row.title === visible.title);
  assert.equal(item.content, "<p>验收公告正文</p>", "公告正文应原样返回给门户");
  assert.equal(item.img_url, null, "未设置封面时 img_url 应为 null");
});

test("[门户] 文档按可见性过滤并汇总分类", async () => {
  const category = `anx-accept-cat-${Date.now()}`;
  const visible = await createKnowledge({ category });
  const hidden = await createKnowledge({ category, isVisible: 0 });

  const { cookie } = await register();
  const list = await expectStatus(await get("/api/client/knowledge", cookie), 200, "文档列表");
  const titles = list.data.map((item) => item.title);
  assert.ok(titles.includes(visible.title), "已发布且可见的文档应出现在门户");
  assert.ok(!titles.includes(hidden.title), "已隐藏的文档不应出现在门户");

  // 按分类筛选时同样只返回可见文档。
  const filtered = await expectStatus(
    await get(`/api/client/knowledge?category=${encodeURIComponent(category)}`, cookie),
    200,
    "按分类筛选文档",
  );
  assert.equal(filtered.data.length, 1, "同一分类下应只剩可见文档");
  assert.equal(filtered.data[0].title, visible.title);

  const categories = await expectStatus(await get("/api/client/knowledge/categories", cookie), 200, "文档分类");
  assert.ok(
    categories.data.some((item) => item.category === category),
    "含有可见文档的分类应出现在分类列表中",
  );
});

test("[后台] 优惠券管理页展示核销与发行统计", async () => {
  const code = await createCoupon({ discountValue: 300, name: "验收展示券" });
  const { email, cookie } = await register();
  await promoteToAdmin(email);

  const response = await fetch(`${baseUrl}/admin/coupons`, { headers: { cookie } });
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.ok(html.includes("优惠券管理"), "页面应包含板块标题");
  assert.ok(html.includes(code), "页面应列出新建的优惠券");
});

/* ------------------------------------------------------------------ *
 * 限流与上限
 * ------------------------------------------------------------------ */

test("[限流] 同一账号连续登录失败达到阈值后触发 429", async () => {
  const { email } = await register();

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const failed = await post("/api/auth/login", null, { email, password: "wrong-password-xyz" });
    assert.equal(failed.status, 401, `第 ${attempt} 次错误密码应为 401，实际 ${failed.status}`);
  }

  // 阈值已满，此时即使密码正确也必须被拦截，避免继续消耗 bcrypt。
  const limited = await post("/api/auth/login", null, { email, password: PASSWORD });
  const body = await expectStatus(limited, 429, "超限登录");
  assert.equal(body.code, "too_many_requests");
});

test("[上限] 待支付订单达到 5 笔后被拒绝继续下单", async () => {
  const { cookie } = await register();

  for (let index = 1; index <= 5; index += 1) {
    const planId = await createPlan({ monthPrice: 990 });
    await expectStatus(
      await post("/api/client/orders", cookie, { plan_id: planId, period: "month_price" }),
      201,
      `第 ${index} 笔待支付订单`,
    );
  }

  const overflowPlan = await createPlan({ monthPrice: 990 });
  const overflow = await post("/api/client/orders", cookie, { plan_id: overflowPlan, period: "month_price" });
  const body = await expectStatus(overflow, 409, "超出待支付上限");
  assert.equal(body.code, "conflict");
});

test("[上限] 未关闭工单达到 10 个后被限流", async () => {
  const { cookie } = await register();

  for (let index = 1; index <= 10; index += 1) {
    await expectStatus(
      await post("/api/client/tickets", cookie, { subject: `验收工单-${index}`, level: 1, message: "上限测试" }),
      201,
      `第 ${index} 个未关闭工单`,
    );
  }

  const overflow = await post("/api/client/tickets", cookie, { subject: "超额工单", level: 1, message: "上限测试" });
  const body = await expectStatus(overflow, 429, "超出工单上限");
  assert.equal(body.code, "too_many_requests");
});

test("[边界] 分页 page_size 超上限被钳制，非法状态值被拒绝", async () => {
  const { cookie } = await register();

  const oversized = await expectStatus(await get("/api/client/orders?page_size=5000", cookie), 200, "超大分页");
  assert.equal(oversized.meta.page_size, 100, "page_size 应被钳制到上限 100");

  const invalidStatus = await get("/api/client/orders?status=not-a-number", cookie);
  await expectStatus(invalidStatus, 400, "非法订单状态");
});

/* ------------------------------------------------------------------ *
 * 佣金与安全信息
 * ------------------------------------------------------------------ */

test("[佣金] 划转把佣金余额转入可用余额并记录双向流水", async () => {
  const { email, cookie } = await register();
  const connection = await getDb();
  await connection.execute("UPDATE users SET commission_balance = 1000, balance = 0 WHERE email = ?", [email]);

  const body = await expectStatus(
    await post("/api/client/commission/transfer", cookie, { transfer_amount: 400 }),
    200,
    "佣金划转",
  );
  assert.equal(body.data.balance, 400, "可用余额应增加划转金额");
  assert.equal(body.data.commission_balance, 600, "佣金余额应扣减划转金额");

  const [rows] = await connection.query(
    "SELECT COUNT(*) AS total FROM wallet_transactions WHERE user_id = (SELECT id FROM users WHERE email = ?)",
    [email],
  );
  assert.equal(rows[0].total, 2, "应同时记录转出与转入两条流水");

  const insufficient = await post("/api/client/commission/transfer", cookie, { transfer_amount: 999999 });
  await expectStatus(insufficient, 400, "佣金余额不足");
});

test("[用户] 重置安全信息会轮换订阅 Token", async () => {
  const { cookie } = await register();

  const before = await expectStatus(await get("/api/user/getSubscribe", cookie), 200, "重置前订阅");
  const reset = await expectStatus(await post("/api/user/resetSecurity", cookie, {}), 200, "重置安全信息");
  assert.match(reset.data.token, /^[a-f0-9]{32}$/, "重置后应返回新 Token");
  assert.notEqual(reset.data.token, before.data.token, "Token 必须被轮换");

  const after = await expectStatus(await get("/api/user/getSubscribe", cookie), 200, "重置后订阅");
  assert.equal(after.data.token, reset.data.token, "后续订阅信息应使用新 Token");
});

/* ------------------------------------------------------------------ *
 * 门户数据接口
 * ------------------------------------------------------------------ */

test("[门户] 节点、流量、知识库、公告、统计返回结构正确", async () => {
  const { cookie } = await register();

  for (const [path, label] of [
    ["/api/client/nodes", "节点列表"],
    ["/api/client/traffic?days=7", "流量记录"],
    ["/api/client/knowledge", "知识库"],
    ["/api/client/knowledge/categories", "知识库分类"],
    ["/api/client/notices", "公告"],
  ]) {
    const body = await expectStatus(await get(path, cookie), 200, label);
    assert.ok(Array.isArray(body.data), `${label} 应返回数组`);
  }

  const stats = await expectStatus(await get("/api/client/stats", cookie), 200, "用户统计");
  assert.equal(typeof stats.data.unpaid_orders, "number");
  assert.equal(typeof stats.data.open_tickets, "number");
  assert.equal(typeof stats.data.referrals, "number");
});

test("[后台] 新建套餐同时出现在后台与前台列表", async () => {
  const planId = await createPlan({ monthPrice: 1990, isVisible: 1 });
  const { email, cookie } = await register();
  await promoteToAdmin(email);

  const connection = await getDb();
  const [rows] = await connection.query("SELECT name FROM plans WHERE id = ?", [planId]);
  const planName = rows[0].name;

  const adminHtml = await (await fetch(`${baseUrl}/admin/plans`, { headers: { cookie } })).text();
  assert.ok(adminHtml.includes(planName), "后台套餐页应列出新建套餐");

  const client = await expectStatus(await get("/api/client/plans", cookie), 200, "前台套餐列表");
  assert.ok(
    client.data.some((plan) => plan.id === planId),
    "前台列表应包含新建套餐",
  );
});

test("[后台] 有核销记录的优惠券不允许删除", async () => {
  const planId = await createPlan({ monthPrice: 990 });
  const code = await createCoupon({ discountValue: 500, planIds: [planId] });

  const { cookie } = await register();
  await placeAndPayOrder(cookie, planId, "month_price", code);

  const connection = await getDb();
  const [usages] = await connection.query(
    "SELECT COUNT(*) AS total FROM coupon_usages WHERE coupon_id = (SELECT id FROM coupons WHERE code = ?)",
    [code],
  );
  assert.ok(usages[0].total >= 1, "支付成功后应留下核销记录");

  const { email: adminEmail, cookie: adminCookie } = await register();
  await promoteToAdmin(adminEmail);
  const html = await (await fetch(`${baseUrl}/admin/coupons`, { headers: { cookie: adminCookie } })).text();
  assert.ok(html.includes(code), "后台应展示该优惠券");
});

test("[后台] 订单管理对待支付订单提供改单与补单入口", async () => {
  const planId = await createPlan({ monthPrice: 990 });
  const { email, cookie } = await register();
  const tradeNo = (await expectStatus(
    await post("/api/client/orders", cookie, { plan_id: planId, period: "month_price" }),
    201,
    "下单",
  )).data;

  await promoteToAdmin(email);
  const html = await (await fetch(`${baseUrl}/admin/orders`, { headers: { cookie } })).text();

  assert.ok(html.includes(tradeNo), "订单应出现在后台列表");
  assert.ok(html.includes("改单"), "待支付订单应提供改单入口");
  assert.ok(html.includes("补单"), "待支付订单应提供补单入口");
  assert.ok(html.includes("取消订单"), "待支付订单应保留取消入口");
});

test("[后台] 网关履约的订单标记来源且不提供改单入口", async () => {
  const planId = await createPlan({ monthPrice: 990 });
  const { email, cookie } = await register();
  await placeAndPayOrder(cookie, planId);

  await promoteToAdmin(email);
  const html = await (await fetch(`${baseUrl}/admin/orders`, { headers: { cookie } })).text();

  assert.ok(html.includes("网关回调"), "支付回调履约的订单应标记为网关回调");
  assert.ok(html.includes("备注"), "已履约订单仍应允许写内部备注");
});

test("[后台] 已完成但履约来源为空的早期订单不显示成未履约", async () => {
  const planId = await createPlan({ monthPrice: 990 });
  const { email, cookie } = await register();
  const { tradeNo, order } = await placeAndPayOrder(cookie, planId);
  assert.equal(order.status, 3, "支付后订单应为已完成");

  // fulfillment_source 是迁移里后加的列：加列之前就流转完的订单是 NULL。
  // 那代表「开通过了但没记录来源」，而不是「尚未履约」——显示成「—」会让
  // 管理员误判成没开通、甚至重复补单。
  const connection = await getDb();
  await connection.execute("UPDATE orders SET fulfillment_source = NULL WHERE trade_no = ?", [tradeNo]);

  await promoteToAdmin(email);
  const html = await (await fetch(`${baseUrl}/admin/orders`, { headers: { cookie } })).text();
  assert.ok(html.includes("早期订单"), "已完成但无履约来源的订单应显示「早期订单」而不是「—」");
});

test("[后台] 订单内部备注在后台列表可见", async () => {
  const planId = await createPlan({ monthPrice: 990 });
  const { email, cookie } = await register();
  const tradeNo = (await expectStatus(
    await post("/api/client/orders", cookie, { plan_id: planId, period: "month_price" }),
    201,
    "下单",
  )).data;

  const connection = await getDb();
  await connection.execute("UPDATE orders SET admin_remark = ? WHERE trade_no = ?", ["对账已确认", tradeNo]);

  await promoteToAdmin(email);
  const html = await (await fetch(`${baseUrl}/admin/orders`, { headers: { cookie } })).text();
  assert.ok(html.includes("对账已确认"), "备注应显示在后台订单列表");
});

/* ------------------------------------------------------------------ *
 * 其他门户接口
 * ------------------------------------------------------------------ */

test("[门户] 全部客户接口可用且返回统一封包", async () => {
  const { cookie } = await register();
  const endpoints = [
    "nodes",
    "notices",
    "knowledge",
    "knowledge/categories",
    "tickets",
    "invites",
    "invites/details",
    "traffic",
    "stats",
    "payment-methods",
  ];
  for (const endpoint of endpoints) {
    const body = await expectStatus(await get(`/api/client/${endpoint}`, cookie), 200, `/api/client/${endpoint}`);
    assert.ok("data" in body, `/api/client/${endpoint} 应返回 data 字段`);
  }
});

test("[门户] 未实现的路由返回 404 与统一错误码", async () => {
  const { cookie } = await register();
  const response = await get("/api/client/not-a-real-endpoint", cookie);
  const body = await expectStatus(response, 404, "未知接口");
  assert.equal(body.code, "not_found");
});

test("[门户] 未登录访问生产面板跳转登录页", async () => {
  for (const path of ["/dashboard", "/plan", "/order", "/ticket", "/profile", "/invite", "/traffic", "/knowledge"]) {
    const response = await fetch(`${baseUrl}${path}`, { redirect: "manual" });
    assert.equal(response.status, 307, `${path} 未登录应重定向`);
    assert.equal(new URL(response.headers.get("location"), baseUrl).pathname, "/login");
  }
});

test("[门户] 已登录用户可访问全部门户页面", async () => {
  const { cookie } = await register();
  for (const path of ["/dashboard", "/plan", "/order", "/ticket", "/profile", "/invite", "/traffic", "/knowledge"]) {
    const response = await fetch(`${baseUrl}${path}`, { headers: { cookie } });
    assert.equal(response.status, 200, `${path} 应返回 200，实际 ${response.status}`);
  }
});

/* ------------------------------------------------------------------ *
 * 流量上报
 *
 * user_traffic_records / node_traffic_records 两张表建好后一直只有读取、
 * 没有写入方，因此「流量明细」永远空着。这里验证新补的写入路径。
 * ------------------------------------------------------------------ */

const reportTraffic = (body, token = NODE_TRAFFIC_SECRET) =>
  fetch(`${baseUrl}/api/node/traffic`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });

async function userIdOf(email) {
  const connection = await getDb();
  const [rows] = await connection.query("SELECT id FROM users WHERE email = ?", [email]);
  return rows.length ? Number(rows[0].id) : null;
}

test("[流量] 缺少凭据或凭据错误的上报被拒绝", async () => {
  const missing = await reportTraffic({ records: [] }, null);
  assert.equal(missing.status, 401, "无凭据应为 401");

  const wrong = await reportTraffic({ records: [] }, "definitely-not-the-secret");
  assert.equal(wrong.status, 401, "错误凭据应为 401");
});

test("[流量] 非法入参被拒绝且不落库", async () => {
  const cases = [
    [{}, "空请求体"],
    [{ records: [], node_records: [] }, "两个数组都为空"],
    [{ records: [{ user_id: 1, upload_bytes: -1, download_bytes: 0, record_at: "2026-09-19" }] }, "负数流量"],
    [{ records: [{ user_id: 1, upload_bytes: 1.5, download_bytes: 1, record_at: "2026-09-19" }] }, "非整数流量"],
    [{ records: [{ user_id: 1, upload_bytes: 1, download_bytes: 1, record_at: "yesterday" }] }, "非法时间"],
    [{ records: [{ user_id: 1, upload_bytes: 1, download_bytes: 1, record_at: "2026-09-19", record_type: "century" }] }, "非法粒度"],
    [{ records: [{ node_id: 1, upload_bytes: 1, download_bytes: 1, record_at: "2026-09-19" }] }, "缺少 user_id"],
    [{ node_records: Array.from({ length: 201 }, () => ({ node_id: 1, upload_bytes: 1, download_bytes: 1, record_at: "2026-09-19" })) }, "超出条数上限"],
  ];
  for (const [body, label] of cases) {
    const response = await reportTraffic(body);
    assert.ok(response.status >= 400 && response.status < 500, `${label} 应为 4xx，实际 ${response.status}`);
  }
});

test("[流量] 引用不存在的用户或节点返回 400 而不是 500", async () => {
  // 外键约束会拦住不存在的 id，但那会变成 500；上报方填错 id 属于调用方错误。
  const missingUser = await reportTraffic({
    records: [{ user_id: 99999999, upload_bytes: 1, download_bytes: 1, record_at: "2026-09-19" }],
  });
  assert.equal(missingUser.status, 400, "不存在的 user_id 应为 400");

  const missingNode = await reportTraffic({
    node_records: [{ node_id: 99999999, upload_bytes: 1, download_bytes: 1, record_at: "2026-09-19" }],
  });
  assert.equal(missingNode.status, 400, "不存在的 node_id 应为 400");
});

test("[流量] 上报后门户可读取，同一天重复上报累加而不拆分", async () => {
  const nodeId = await createNode();
  const { email, cookie } = await register();
  const userId = await userIdOf(email);
  assert.ok(userId, "应能查到测试用户");

  const day = "2026-09-19";
  assert.equal(
    (await reportTraffic({
      records: [{ user_id: userId, node_id: nodeId, upload_bytes: 1000, download_bytes: 2000, record_at: day }],
    })).status,
    201,
    "首次上报应成功",
  );
  assert.equal(
    (await reportTraffic({
      // 同一天的另一个时刻：应归一到同一个桶，而不是新开一行。
      records: [{ user_id: userId, node_id: nodeId, upload_bytes: 500, download_bytes: 500, record_at: `${day} 23:30:00` }],
    })).status,
    201,
    "再次上报应成功",
  );

  const connection = await getDb();
  const [rows] = await connection.query(
    "SELECT upload_bytes AS u, download_bytes AS d FROM user_traffic_records WHERE user_id = ?",
    [userId],
  );
  assert.equal(rows.length, 1, `同一天应只有一条记录，实际 ${rows.length}`);
  assert.equal(Number(rows[0].u), 1500, "上行应累加");
  assert.equal(Number(rows[0].d), 2500, "下行应累加");

  // 既有读取路径（此前无写入方，一直读到空数组）应能看到这批数据。
  const traffic = await expectStatus(await get("/api/client/traffic", cookie), 200, "用户流量明细");
  assert.ok(Array.isArray(traffic.data) && traffic.data.length >= 1, "流量明细应有数据");
  const total = traffic.data.reduce((sum, item) => sum + item.u + item.d, 0);
  assert.equal(total, 4000, "明细合计应与上报一致");
});

test("[流量] 节点聚合写入 node_traffic_records", async () => {
  const nodeId = await createNode();
  const response = await reportTraffic({
    node_records: [
      { node_id: nodeId, upload_bytes: 10, download_bytes: 20, record_at: "2026-09-19" },
      { node_id: nodeId, upload_bytes: 1, download_bytes: 2, record_at: "2026-09-19 08:00:00" },
    ],
  });
  assert.equal(response.status, 201, "节点流量上报应成功");

  // 这张表此前全项目零引用，本轮才第一次被写入。
  const connection = await getDb();
  const [rows] = await connection.query(
    "SELECT upload_bytes AS u, download_bytes AS d FROM node_traffic_records WHERE node_id = ?",
    [nodeId],
  );
  assert.equal(rows.length, 1, "同一天应聚合为一行");
  assert.equal(Number(rows[0].u), 11, "节点上行应累加");
  assert.equal(Number(rows[0].d), 22, "节点下行应累加");
});

test("[流量] 带偏移量的 ISO 时间与东八区简写落在同一个桶", async () => {
  const nodeId = await createNode();
  const { email } = await register();
  const userId = await userIdOf(email);

  // 2026-09-19 08:00+08:00 与 "2026-09-19 23:00"（按东八区）是同一个东八区的天。
  const response = await reportTraffic({
    records: [
      { user_id: userId, node_id: nodeId, upload_bytes: 100, download_bytes: 0, record_at: "2026-09-19T08:00:00+08:00" },
      { user_id: userId, node_id: nodeId, upload_bytes: 200, download_bytes: 0, record_at: "2026-09-19 23:00:00" },
    ],
  });
  assert.equal(response.status, 201, "混合写法应被接受");

  const connection = await getDb();
  // 用 DATE_FORMAT 取字面量：测试连接没配 timezone（默认 local），
  // 直接读 DATETIME 会被按本机时区解析，和应用的连接池（timezone: "Z"）差 8 小时。
  const [rows] = await connection.query(
    `SELECT DATE_FORMAT(record_at, '%Y-%m-%d %H:%i:%s') AS record_at, upload_bytes AS u
       FROM user_traffic_records WHERE user_id = ?`,
    [userId],
  );
  assert.equal(rows.length, 1, "两种写法应归一到同一个桶");
  assert.equal(Number(rows[0].u), 300, "应按累加写入");

  // 存的是桶起点的 UTC 瞬时：东八区 2026-09-19 00:00 对应 UTC 2026-09-18 16:00。
  assert.equal(rows[0].record_at, "2026-09-18 16:00:00", "record_at 应存桶起点的 UTC 瞬时");
});

/* ------------------------------------------------------------------ *
 * 返佣（佣金）
 *
 * commission_logs 此前只有 SELECT、没有 INSERT，实测邀请页佣金恒为 0、
 * 明细恒空、划转恒报「佣金余额不足」。这里验证补上的写入与结算。
 * ------------------------------------------------------------------ */

/** 与服务端读同一个 .env.local；测试据此推算期望金额。 */
const COMMISSION_RATE_PERCENT = Number(process.env.COMMISSION_RATE_PERCENT ?? 0);
const expectedCommission = (amountCents) => Math.floor((amountCents * COMMISSION_RATE_PERCENT) / 100);

/** 用邀请码注册，建立真实的推荐关系（而不是手工插 user_referrals）。 */
async function registerWithInvite(inviteCode) {
  const email = `anx-accept-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
  created.emails.push(email);
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      password_confirmation: PASSWORD,
      email_code: "666666",
      invite_code: inviteCode,
    }),
  });
  if (response.status !== 201) assert.fail(`带邀请码注册失败：${await response.text()}`);
  const cookie = response.headers.getSetCookie()[0]?.split(";", 1)[0];
  assert.ok(cookie, "注册应下发会话 Cookie");
  return { email, cookie };
}

test("[返佣] 被邀请人支付后为邀请人记录佣金", async () => {
  assert.ok(
    COMMISSION_RATE_PERCENT > 0,
    "本用例需要 .env.local 里 COMMISSION_RATE_PERCENT > 0 才有意义，请配置后重跑",
  );

  const planId = await createPlan({ monthPrice: 9900 });
  const { cookie: inviterCookie } = await register();
  const inviteCode = (await expectStatus(
    await post("/api/client/invites", inviterCookie, {}),
    201,
    "生成邀请码",
  )).data;

  const { cookie: buyerCookie } = await registerWithInvite(inviteCode);
  const { tradeNo, order } = await placeAndPayOrder(buyerCookie, planId);
  assert.equal(order.status, 3, "支付后订单应为已完成");

  const connection = await getDb();
  const [rows] = await connection.query(
    `SELECT c.inviter_user_id, c.invited_user_id, c.order_amount, c.commission_amount, c.status
       FROM commission_logs c JOIN orders o ON o.id = c.order_id WHERE o.trade_no = ?`,
    [tradeNo],
  );
  assert.equal(rows.length, 1, "应记一条佣金");
  assert.equal(Number(rows[0].order_amount), 9900, "佣金应基于订单实付金额");
  assert.equal(
    Number(rows[0].commission_amount),
    expectedCommission(9900),
    `佣金应为 ${COMMISSION_RATE_PERCENT}% 的实付金额`,
  );

  const [orderRows] = await connection.query(
    "SELECT commission_status, commission_amount FROM orders WHERE trade_no = ?",
    [tradeNo],
  );
  assert.equal(Number(orderRows[0].commission_status), 1, "订单应标记为已计算佣金");
  assert.equal(Number(orderRows[0].commission_amount), expectedCommission(9900), "订单佣金金额应与明细一致");
});

test("[返佣] 无邀请人的订单不产生佣金", async () => {
  const planId = await createPlan({ monthPrice: 9900 });
  const { cookie } = await register();
  const { tradeNo } = await placeAndPayOrder(cookie, planId);

  const connection = await getDb();
  const [rows] = await connection.query(
    "SELECT c.id FROM commission_logs c JOIN orders o ON o.id = c.order_id WHERE o.trade_no = ?",
    [tradeNo],
  );
  assert.equal(rows.length, 0, "没有邀请人时不应记佣金");
});

test("[返佣] 佣金结算进余额后可划转", async () => {
  assert.ok(COMMISSION_RATE_PERCENT > 0, "本用例需要 COMMISSION_RATE_PERCENT > 0");

  const planId = await createPlan({ monthPrice: 9900 });
  const { email, cookie: inviterCookie } = await register();
  const inviteCode = (await expectStatus(
    await post("/api/client/invites", inviterCookie, {}),
    201,
    "生成邀请码",
  )).data;

  const { cookie: buyerCookie } = await registerWithInvite(inviteCode);
  await placeAndPayOrder(buyerCookie, planId);

  const expected = expectedCommission(9900);
  const connection = await getDb();
  const [inviterRows] = await connection.query("SELECT id FROM users WHERE email = ?", [email]);
  const inviterId = Number(inviterRows[0].id);

  const [before] = await connection.query("SELECT commission_balance FROM users WHERE id = ?", [inviterId]);
  assert.equal(Number(before[0].commission_balance), 0, "结算前佣金余额应为 0");

  // 读取邀请概览会顺带把到期佣金结算掉。
  await expectStatus(await get("/api/client/invites", inviterCookie), 200, "邀请概览");
  const [after] = await connection.query("SELECT commission_balance FROM users WHERE id = ?", [inviterId]);
  assert.equal(Number(after[0].commission_balance), expected, "结算后佣金余额应等于佣金金额");

  // 划转此前必然报「佣金余额不足」，因为 commission_balance 从不曾被记入。
  const transfer = await post("/api/client/commission/transfer", inviterCookie, { transfer_amount: expected });
  await expectStatus(transfer, 200, "佣金划转");

  const [final] = await connection.query("SELECT commission_balance, balance FROM users WHERE id = ?", [inviterId]);
  assert.equal(Number(final[0].commission_balance), 0, "划转后佣金余额应清零");
  assert.equal(Number(final[0].balance), expected, "划转金额应进入余额");
});

test("[返佣] 重复支付回调不会重复计佣", async () => {
  assert.ok(COMMISSION_RATE_PERCENT > 0, "本用例需要 COMMISSION_RATE_PERCENT > 0");

  const planId = await createPlan({ monthPrice: 9900 });
  const { cookie: inviterCookie } = await register();
  const inviteCode = (await expectStatus(
    await post("/api/client/invites", inviterCookie, {}),
    201,
    "生成邀请码",
  )).data;

  const { cookie: buyerCookie } = await registerWithInvite(inviteCode);
  const create = await post("/api/client/orders", buyerCookie, { plan_id: planId, period: "month_price" });
  const tradeNo = (await expectStatus(create, 201, "下单")).data;
  const { transactionId } = await placeAndPayOrderFor(buyerCookie, tradeNo);

  // 用同一个 transaction_id 重放回调。
  await post("/api/client/orders/mock-confirm", buyerCookie, { trade_no: tradeNo, transaction_id: transactionId });

  const connection = await getDb();
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS n, COALESCE(SUM(c.commission_amount), 0) AS total
       FROM commission_logs c JOIN orders o ON o.id = c.order_id WHERE o.trade_no = ?`,
    [tradeNo],
  );
  assert.equal(Number(rows[0].n), 1, "重放回调不应产生第二条佣金");
  assert.equal(Number(rows[0].total), expectedCommission(9900), "重放回调不应让佣金翻倍");
});

test("[流量] 后台「流量统计」能看见节点上报的数据", async () => {
  const nodeId = await createNode();
  const connection = await getDb();
  const [nodeRows] = await connection.query("SELECT name FROM nodes WHERE id = ?", [nodeId]);
  const nodeName = String(nodeRows[0].name);

  const response = await reportTraffic({
    node_records: [
      { node_id: nodeId, upload_bytes: BYTES_PER_GB, download_bytes: BYTES_PER_GB * 2, record_at: "2026-09-19" },
    ],
  });
  assert.equal(response.status, 201, "节点流量上报应成功");

  const { email, cookie } = await register();
  await promoteToAdmin(email);
  // 按节点名筛选：node_traffic_records 是全局表，整轮跑下来会累积多条记录，
  // 不筛选的话本节点的行可能被挤到第二页，断言就变成掷骰子了。
  const html = await (await fetch(
    `${baseUrl}/admin/traffic?q=${encodeURIComponent(nodeName)}`,
    { headers: { cookie } },
  )).text();

  // 这个板块存在的意义：node_traffic_records 曾经写入了却没有任何地方看得见。
  assert.ok(html.includes("流量统计"), "页面标题应为流量统计");
  assert.ok(html.includes(nodeName), `后台应列出上报的节点「${nodeName}」`);
  assert.ok(html.includes("1.00 GB"), "应显示上行 1.00 GB");
  assert.ok(html.includes("2.00 GB"), "应显示下行 2.00 GB");
  assert.ok(html.includes("3.00 GB"), "合计应为 3.00 GB");
  assert.ok(html.includes("只读"), "流量板块应标记为只读，而非「可编辑」");
});

test("[流量] 后台汇总按统计粒度分开，混合上报不会重复相加", async () => {
  const nodeId = await createNode();

  // 同一天既按日粒度、又按小时粒度上报，两条都会落库（唯一键含 record_type）。
  const reported = await reportTraffic({
    node_records: [
      { node_id: nodeId, upload_bytes: BYTES_PER_GB, download_bytes: 0, record_type: "day", record_at: "2026-09-19" },
      { node_id: nodeId, upload_bytes: BYTES_PER_GB, download_bytes: 0, record_type: "hour", record_at: "2026-09-19 10:00:00" },
    ],
  });
  assert.equal(reported.status, 201, "混合粒度上报应成功");

  const connection = await getDb();
  const [nodeRows] = await connection.query("SELECT name FROM nodes WHERE id = ?", [nodeId]);
  const nodeName = String(nodeRows[0].name);

  const { email, cookie } = await register();
  await promoteToAdmin(email);
  const html = await (await fetch(
    `${baseUrl}/admin/traffic?q=${encodeURIComponent(nodeName)}`,
    { headers: { cookie } },
  )).text();

  // 合并相加会得到 2 GB 并让人误以为用了两倍流量，因此两种粒度各自汇总。
  assert.ok(html.includes("日粒度汇总"), "应分别展示日粒度汇总");
  assert.ok(html.includes("小时粒度汇总"), "应分别展示小时粒度汇总");
  assert.ok(html.includes("合并相加会导致流量被重复统计"), "混合粒度时应给出说明");

  // 筛选后汇总必须跟着筛选走，否则「表格变了、卡片没变」会被当成算错。
  const [totals] = await connection.query(
    `SELECT COALESCE(SUM(upload_bytes), 0) AS up FROM node_traffic_records WHERE node_id = ?`,
    [nodeId],
  );
  assert.equal(Number(totals[0].up), BYTES_PER_GB * 2, "本节点上行合计应为 2 GB");
  assert.ok(!html.includes("2.00 GB"), "两种粒度各 1 GB，不应出现合并后的 2.00 GB");
});
