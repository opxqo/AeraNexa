/**
 * 系统设置项校验（src/lib/server/settings-schema.ts）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { findSettingDef, normalizeSettingValue, SETTING_DEFS } from "../../src/lib/server/settings-schema.ts";

const def = (key) => findSettingDef(key);

test("设置项 key 唯一，默认值本身能通过校验（空默认值除外）", () => {
  const keys = SETTING_DEFS.map((d) => d.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const d of SETTING_DEFS) {
    if (d.defaultValue === "") continue;
    assert.equal(normalizeSettingValue(d, d.defaultValue).ok, true, d.key);
  }
});

test("不收纳必须留在环境变量的配置", () => {
  const envs = SETTING_DEFS.map((d) => d.env);
  for (const name of ["DB_PASSWORD", "AUTH_SESSION_SECRET", "SMTP_CONFIG_ENCRYPTION_KEY", "PAYMENT_CONFIG_ENCRYPTION_KEY", "EMAIL_VERIFICATION_PEPPER", "RECHARGE_CARD_SECRET", "SETTINGS_ENCRYPTION_KEY"]) {
    assert.ok(!envs.includes(name), name);
  }
});

test("网址：规整、只允许 http/https、不允许查询串", () => {
  assert.deepEqual(normalizeSettingValue(def("panel.base_url"), " http://localhost:2053/path/ "), { ok: true, value: "http://localhost:2053/path/" });
  assert.equal(normalizeSettingValue(def("subscribe.base_url"), "ftp://x").ok, false);
  assert.equal(normalizeSettingValue(def("subscribe.base_url"), "https://a.com/?x=1").ok, false);
  assert.equal(normalizeSettingValue(def("subscribe.base_url"), "not a url").ok, false);
});

test("整数与范围", () => {
  assert.deepEqual(normalizeSettingValue(def("panel.timeout_ms"), "15000"), { ok: true, value: "15000" });
  assert.equal(normalizeSettingValue(def("panel.timeout_ms"), "500").ok, false);
  assert.equal(normalizeSettingValue(def("commission.available_after_days"), "1.5").ok, false);
  assert.equal(normalizeSettingValue(def("worker.event_interval_ms"), "abc").ok, false);
});

test("小数比例", () => {
  assert.deepEqual(normalizeSettingValue(def("commission.rate_percent"), "12.5"), { ok: true, value: "12.5" });
  assert.equal(normalizeSettingValue(def("commission.rate_percent"), "101").ok, false);
  assert.equal(normalizeSettingValue(def("commission.rate_percent"), "-1").ok, false);
});

test("密钥：长度与空白", () => {
  assert.equal(normalizeSettingValue(def("panel.api_token"), "short").ok, false);
  assert.equal(normalizeSettingValue(def("panel.api_token"), "has space inside").ok, false);
  assert.deepEqual(normalizeSettingValue(def("panel.api_token"), "  abcdefghij  "), { ok: true, value: "abcdefghij" });
});
