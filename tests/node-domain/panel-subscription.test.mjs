import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPanelClashUrl } from "../../src/lib/server/panel/subscription.ts";

test("3x-ui Clash 地址使用管理员配置的订阅前缀", () => {
  assert.equal(
    buildPanelClashUrl("http://127.0.0.1:2053", "https://sub.example.com/clash/", "abcDEF12_34"),
    "https://sub.example.com/clash/abcDEF12_34",
  );
});

test("未配置 Clash 地址时使用面板源站的 Mihomo 兼容路径", () => {
  assert.equal(
    buildPanelClashUrl("http://127.0.0.1:2053/panel/", "", "abcDEF12_34"),
    "http://127.0.0.1:2053/mihomo/abcDEF12_34",
  );
});

test("订阅标识不能注入路径", () => {
  assert.throws(() => buildPanelClashUrl("http://127.0.0.1:2053", "", "../private"));
});
