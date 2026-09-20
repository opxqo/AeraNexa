import assert from "node:assert/strict";
import mysql from "mysql2/promise";

/**
 * 断言业务错误响应。
 *
 * 服务端错误封包为 `{ message, code }`：
 * - `message` 面向用户展示；
 * - `code` 是稳定的业务错误码（invalid_request / unauthenticated / forbidden /
 *   not_found / conflict / too_many_requests / unavailable / internal_error），
 *   供前端分支处理，避免解析中文文案。
 *
 * 这里显式校验需要的字段，而不是用 deepEqual 锁死「恰好等于 { message }」，
 * 否则后续为响应补充任何附加字段都会误报失败。
 */
export async function assertApiError(response, expected = {}) {
  const json = await response.json();
  assert.equal(typeof json.message, "string", "错误响应应包含 message 字符串");
  if (expected.message !== undefined) assert.equal(json.message, expected.message);
  if (expected.code !== undefined) assert.equal(json.code, expected.code);
  return json;
}

export const dbConfig = {
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3306),
  database: process.env.DB_NAME ?? "aeranexa",
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD,
};

/**
 * 测试期间保证「模拟支付」开着，返回跑完要还原到的状态。
 *
 * 支付方式是**全局可变状态**：后台「支付管理」随时能把它关掉，而多套用例依赖它。
 * 曾经因为别处关掉了它，一次冒出 11 条假失败，看起来像业务回归，实际是环境被改了。
 * 测试不应该依赖现网配置——自己打开，跑完还原。
 *
 * 返回值传给 restoreMockPaymentMethod()；为 null 表示该行尚不存在
 * （首次调用接口时 ensureSystemPaymentMethods 会播种，届时无需还原）。
 */
export async function enableMockPaymentForTests() {
  const connection = await mysql.createConnection(dbConfig);
  try {
    const [rows] = await connection.query(
      "SELECT id, is_enabled FROM payment_methods WHERE provider = 'mock'",
    );
    if (!rows.length) return null;
    const enabled = Number(rows[0].is_enabled) === 1;
    if (!enabled) {
      await connection.query("UPDATE payment_methods SET is_enabled = 1 WHERE id = ?", [rows[0].id]);
    }
    return enabled;
  } finally {
    await connection.end();
  }
}

/** 把「模拟支付」开关还原到测试开始前的状态。 */
export async function restoreMockPaymentMethod(original) {
  if (original === null) return;
  const connection = await mysql.createConnection(dbConfig);
  try {
    await connection.query("UPDATE payment_methods SET is_enabled = ? WHERE provider = 'mock'", [
      original ? 1 : 0,
    ]);
  } finally {
    await connection.end();
  }
}

/**
 * 邮件服务是否已在后台启用。
 *
 * 「未启用 SMTP 时返回 503」这类断言只对没有配置邮件服务的部署成立：
 * 运营方一旦在后台打开邮件服务，同一个请求就会真的发信（202/429）。
 * 所以先问一次真实配置，让用例在两种环境下都能给出正确结论，
 * 而不是把现网配置当成测试前提。
 */
export async function isEmailServiceEnabled() {
  const connection = await mysql.createConnection(dbConfig);
  try {
    const [rows] = await connection.query("SELECT is_enabled FROM smtp_settings WHERE id = 1");
    return Boolean(rows.length) && Number(rows[0].is_enabled) === 1;
  } finally {
    await connection.end();
  }
}
