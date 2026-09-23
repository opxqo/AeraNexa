import assert from "node:assert/strict";
import { test } from "node:test";
import { decideConfirmedPayment } from "../../src/lib/server/payments/order-payment-policy.ts";

test("待支付订单收款后正常开通", () => {
  assert.equal(decideConfirmedPayment({ status: 0, orderType: 1, hasSurplus: false, fulfillmentSource: null }), "settle");
  assert.equal(decideConfirmedPayment({ status: 0, orderType: 3, hasSurplus: true, fulfillmentSource: null }), "settle");
});

test("已关闭的新购 / 续费 / 重置单迟到付款：恢复并开通", () => {
  for (const orderType of [1, 2, 4]) {
    assert.equal(decideConfirmedPayment({ status: 2, orderType, hasSurplus: false, fulfillmentSource: null }), "reopen");
  }
});

test("已关闭的升级单迟到付款：转入余额", () => {
  assert.equal(decideConfirmedPayment({ status: 2, orderType: 3, hasSurplus: false, fulfillmentSource: null }), "credit");
  assert.equal(decideConfirmedPayment({ status: 2, orderType: 1, hasSurplus: true, fulfillmentSource: null }), "credit");
});

test("已完成 / 已退款等订单再次收款（重复支付）：转入余额", () => {
  for (const status of [1, 3, 4, 5]) {
    assert.equal(decideConfirmedPayment({ status, orderType: 1, hasSurplus: false, fulfillmentSource: null }), "credit");
  }
});

test("人工补单后的订单再收到付款：只记账，不重复开通也不转余额", () => {
  assert.equal(decideConfirmedPayment({ status: 3, orderType: 1, hasSurplus: false, fulfillmentSource: "admin" }), "confirm");
  assert.equal(decideConfirmedPayment({ status: 1, orderType: 1, hasSurplus: false, fulfillmentSource: "admin" }), "confirm");
  assert.equal(decideConfirmedPayment({ status: 3, orderType: 1, hasSurplus: false, fulfillmentSource: "gateway" }), "credit");
});
