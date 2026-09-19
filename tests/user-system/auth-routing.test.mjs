import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = process.env.TEST_BASE_URL ?? "http://localhost:3000";

test("未登录用户访问生产面板时跳转到登录页", async () => {
  const response = await fetch(`${baseUrl}/dashboard`, { redirect: "manual" });

  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get("location"), baseUrl).pathname, "/login");
});

test("无效会话不能访问生产面板", async () => {
  const response = await fetch(`${baseUrl}/dashboard`, {
    redirect: "manual",
    headers: { cookie: "aeranexa_session=not-a-valid-session" },
  });

  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get("location"), baseUrl).pathname, "/login");
});
