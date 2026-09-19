import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = process.env.TEST_BASE_URL ?? "http://localhost:3000";

test("注册接口将损坏的 JSON 识别为客户端请求错误", async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { message: "请求格式不正确" });
});

test("登录接口将损坏的 JSON 识别为客户端请求错误", async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { message: "请求格式不正确" });
});

test("未配置 SMTP 时发送接口返回默认验证码提示", async () => {
  const response = await fetch(`${baseUrl}/api/auth/send-email-verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "verification@example.test" }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    data: "666666",
    message: "SMTP 尚未配置，当前验证码为 666666",
  });
});
