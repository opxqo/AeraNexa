import assert from "node:assert/strict";
import { after, test } from "node:test";
import mysql from "mysql2/promise";

const baseUrl = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const testEmails = [];
const testPlanIds = [];

after(async () => {
  if (!testEmails.length) return;

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    database: process.env.DB_NAME ?? "aeranexa",
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD,
  });
  try {
    await connection.query("DELETE FROM orders WHERE user_id IN (SELECT id FROM (SELECT id FROM users WHERE email IN (?)) AS test_users)", [testEmails]);
    await connection.query("DELETE FROM users WHERE email IN (?)", [testEmails]);
    if (testPlanIds.length) await connection.query("DELETE FROM plans WHERE id IN (?)", [testPlanIds]);
  } finally {
    await connection.end();
  }
});

async function registerTestUser() {
  const email = `codex-user-system-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
  testEmails.push(email);

  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "test-password-123",
      password_confirmation: "test-password-123",
      email_code: "666666",
    }),
  });
  assert.equal(response.status, 201, await response.text());

  const sessionCookie = response.headers.getSetCookie()[0]?.split(";", 1)[0];
  assert.ok(sessionCookie, "注册成功后应设置会话 Cookie");
  return { email, sessionCookie };
}

async function login(email, password) {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

test("偏好更新拒绝 0 和 1 之外的值", async () => {
  const { sessionCookie } = await registerTestUser();
  const response = await fetch(`${baseUrl}/api/user/update`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: sessionCookie,
    },
    body: JSON.stringify({ remind_expire: "yes" }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { message: "提醒设置格式不正确" });
});

test("修改密码接口将损坏的 JSON 识别为客户端请求错误", async () => {
  const { sessionCookie } = await registerTestUser();
  const response = await fetch(`${baseUrl}/api/user/changePassword`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: sessionCookie,
    },
    body: "{",
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { message: "请求格式不正确" });
});

test("用户不存在后有效签名的旧会话也不能访问生产面板", async () => {
  const { email, sessionCookie } = await registerTestUser();
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    database: process.env.DB_NAME ?? "aeranexa",
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD,
  });
  try {
    await connection.execute("DELETE FROM users WHERE email = ?", [email]);
  } finally {
    await connection.end();
  }

  const response = await fetch(`${baseUrl}/dashboard`, {
    redirect: "manual",
    headers: { cookie: sessionCookie },
  });

  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get("location"), baseUrl).pathname, "/login");
});

test("注销后旧会话不能再次访问用户接口", async () => {
  const { sessionCookie } = await registerTestUser();
  const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { cookie: sessionCookie },
  });
  assert.equal(logoutResponse.status, 200);

  const replayResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { cookie: sessionCookie },
  });

  assert.equal(replayResponse.status, 401);
});

test("订阅信息返回当前用户可用的私有订阅地址", async () => {
  const { sessionCookie } = await registerTestUser();
  const response = await fetch(`${baseUrl}/api/user/getSubscribe`, {
    headers: { cookie: sessionCookie },
  });

  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.match(data.token, /^[a-f0-9]{32}$/);
  const subscribeUrl = new URL(data.subscribe_url);
  assert.equal(subscribeUrl.origin, new URL(baseUrl).origin);
  assert.equal(subscribeUrl.pathname, "/api/v1/client/subscribe");
  assert.equal(subscribeUrl.searchParams.get("token"), data.token);
});

test("修改密码后撤销该账户的所有旧会话", async () => {
  const oldPassword = "test-password-123";
  const newPassword = "changed-password-456";
  const { email, sessionCookie: firstSession } = await registerTestUser();
  const secondLogin = await login(email, oldPassword);
  assert.equal(secondLogin.status, 200, await secondLogin.text());
  const secondSession = secondLogin.headers.getSetCookie()[0]?.split(";", 1)[0];
  assert.ok(secondSession);

  const changeResponse = await fetch(`${baseUrl}/api/user/changePassword`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: firstSession,
    },
    body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
  });
  assert.equal(changeResponse.status, 200, await changeResponse.text());

  for (const cookie of [firstSession, secondSession]) {
    const response = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie } });
    assert.equal(response.status, 401);
  }
  assert.equal((await login(email, oldPassword)).status, 401);
  assert.equal((await login(email, newPassword)).status, 200);
});

test("登录响应返回本次登录时间", async () => {
  const password = "test-password-123";
  const { email, sessionCookie } = await registerTestUser();
  await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { cookie: sessionCookie },
  });

  const beforeLogin = Math.floor(Date.now() / 1000) - 2;
  const response = await login(email, password);
  if (response.status !== 200) assert.fail(await response.text());
  const { data } = await response.json();
  assert.equal(typeof data.last_login_at, "number");
  assert.ok(data.last_login_at >= beforeLogin);
});

test("修改密码拒绝继续使用原密码", async () => {
  const password = "test-password-123";
  const { sessionCookie } = await registerTestUser();
  const response = await fetch(`${baseUrl}/api/user/changePassword`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: sessionCookie,
    },
    body: JSON.stringify({ old_password: password, new_password: password }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { message: "新密码不能与旧密码相同" });
});

test("注册必须提交默认邮箱验证码", async () => {
  const email = `codex-missing-code-${Date.now()}@example.test`;
  testEmails.push(email);
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "test-password-123",
      password_confirmation: "test-password-123",
    }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { message: "邮箱验证码错误" });
});

test("客户面板通过本地接口完成模拟支付并开通套餐", async () => {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST ?? "127.0.0.1", port: Number(process.env.DB_PORT ?? 3306),
    database: process.env.DB_NAME ?? "aeranexa", user: process.env.DB_USER ?? "root", password: process.env.DB_PASSWORD,
  });
  let planId;
  try {
    const [result] = await connection.execute(
      "INSERT INTO plans (name, transfer_enable, month_price, is_visible, is_renewable) VALUES (?, 120, 990, 1, 1)",
      [`codex-client-plan-${Date.now()}`],
    );
    planId = Number(result.insertId);
    testPlanIds.push(planId);
  } finally {
    await connection.end();
  }

  const { sessionCookie } = await registerTestUser();
  const headers = { "content-type": "application/json", cookie: sessionCookie };
  const plans = await fetch(`${baseUrl}/api/client/plans`, { headers: { cookie: sessionCookie } });
  if (plans.status !== 200) assert.fail(await plans.text());
  assert.ok((await plans.json()).data.some((plan) => plan.id === planId));

  const create = await fetch(`${baseUrl}/api/client/orders`, { method: "POST", headers, body: JSON.stringify({ plan_id: planId, period: "month_price" }) });
  if (create.status !== 201) assert.fail(await create.text());
  const tradeNo = (await create.json()).data;
  assert.match(tradeNo, /^ANX/);

  const methods = await fetch(`${baseUrl}/api/client/payment-methods`, { headers: { cookie: sessionCookie } });
  if (methods.status !== 200) assert.fail(await methods.text());
  const mock = (await methods.json()).data.find((method) => method.payment === "mock");
  assert.ok(mock, "应自动提供模拟支付方式");

  const checkout = await fetch(`${baseUrl}/api/client/orders/checkout`, { method: "POST", headers, body: JSON.stringify({ trade_no: tradeNo, method: mock.id }) });
  if (checkout.status !== 200) assert.fail(await checkout.text());
  const checkoutData = (await checkout.json()).data;
  assert.equal(checkoutData.provider, "mock");

  const confirm = await fetch(`${baseUrl}/api/client/orders/mock-confirm`, { method: "POST", headers, body: JSON.stringify({ trade_no: tradeNo, transaction_id: checkoutData.transaction_id }) });
  if (confirm.status !== 200) assert.fail(await confirm.text());
  assert.equal((await confirm.json()).data.status, 3);

  const info = await fetch(`${baseUrl}/api/user/info`, { headers: { cookie: sessionCookie } });
  if (info.status !== 200) assert.fail(await info.text());
  assert.equal((await info.json()).data.plan_id, planId);

  for (const endpoint of ["nodes", "notices", "knowledge", "tickets", "invites", "traffic", "stats"]) {
    const response = await fetch(`${baseUrl}/api/client/${endpoint}`, { headers: { cookie: sessionCookie } });
    if (response.status !== 200) assert.fail(`${endpoint}: ${await response.text()}`);
  }

  const ticketCreate = await fetch(`${baseUrl}/api/client/tickets`, { method: "POST", headers, body: JSON.stringify({ subject: "测试工单", level: 1, message: "接口联调消息" }) });
  if (ticketCreate.status !== 201) assert.fail(await ticketCreate.text());
  const tickets = await fetch(`${baseUrl}/api/client/tickets`, { headers: { cookie: sessionCookie } });
  const ticketId = (await tickets.json()).data.find((ticket) => ticket.subject === "测试工单").id;
  const reply = await fetch(`${baseUrl}/api/client/tickets/reply`, { method: "POST", headers, body: JSON.stringify({ id: ticketId, message: "补充说明" }) });
  if (reply.status !== 200) assert.fail(await reply.text());
  const ticket = await fetch(`${baseUrl}/api/client/tickets/${ticketId}`, { headers: { cookie: sessionCookie } });
  if (ticket.status !== 200) assert.fail(await ticket.text());
  assert.equal((await ticket.json()).data.message.length, 2);
  const close = await fetch(`${baseUrl}/api/client/tickets/close`, { method: "POST", headers, body: JSON.stringify({ id: ticketId }) });
  if (close.status !== 200) assert.fail(await close.text());
});
