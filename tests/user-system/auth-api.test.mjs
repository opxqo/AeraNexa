import assert from "node:assert/strict";
import test from "node:test";
import { assertApiError } from "./helpers.mjs";

const baseUrl = process.env.TEST_BASE_URL ?? "http://localhost:3000";

test("注册接口将损坏的 JSON 识别为客户端请求错误", async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });

  assert.equal(response.status, 400);
  await assertApiError(response, { message: "请求格式不正确", code: "invalid_request" });
});

test("登录接口将损坏的 JSON 识别为客户端请求错误", async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });

  assert.equal(response.status, 400);
  await assertApiError(response, { message: "请求格式不正确", code: "invalid_request" });
});

test("未启用 SMTP 时发送接口安全拒绝且不回显验证码", async () => {
  const response = await fetch(`${baseUrl}/api/auth/send-email-verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "verification@example.test" }),
  });

  assert.equal(response.status, 503);
  await assertApiError(response, { message: "邮件验证服务暂未启用", code: "unavailable" });
});
