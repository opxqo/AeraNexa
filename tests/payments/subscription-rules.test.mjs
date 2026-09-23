import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decideActivation,
  monthlyPriceCents,
  purchaseBlockReason,
  resetTrafficPriceCents,
} from "../../src/lib/server/subscription-rules.ts";

const NOW = 1_800_000_000;
const active = (planId) => ({ planId, expiresAt: NOW + 86400, now: NOW });
const expired = (planId) => ({ planId, expiresAt: NOW - 1, now: NOW });
const permanent = (planId) => ({ planId, expiresAt: null, now: NOW });
const none = { planId: null, expiresAt: null, now: NOW };

test("月付价：优先月付，否则按最短周期换算，再否则用一次性价", () => {
  assert.equal(monthlyPriceCents({ month_price: 200, year_price: 2000 }), 200);
  assert.equal(monthlyPriceCents({ month_price: null, quarter_price: 500 }), 167);
  assert.equal(monthlyPriceCents({ year_price: 1200 }), 100);
  assert.equal(monthlyPriceCents({ onetime_price: 3000 }), 3000);
  assert.equal(monthlyPriceCents({}), null);
});

test("重置价 = 月付价 × 比例", () => {
  assert.equal(resetTrafficPriceCents(200, 75), 150);
  assert.equal(resetTrafficPriceCents(100, 75), 75);
  assert.equal(resetTrafficPriceCents(999, 75), 749);
  assert.equal(resetTrafficPriceCents(200, 0), 0);
});

test("生效中购买其它套餐：排队", () => {
  assert.equal(decideActivation({ isReset: false, targetPlanId: 2, user: active(1), hasQueued: false }), "queue");
});

test("生效中续费同一套餐：立即叠加，即便后面还有排队", () => {
  assert.equal(decideActivation({ isReset: false, targetPlanId: 1, user: active(1), hasQueued: false }), "activate");
  assert.equal(decideActivation({ isReset: false, targetPlanId: 1, user: active(1), hasQueued: true }), "activate");
});

test("已有排队订单：新订单排到最后", () => {
  assert.equal(decideActivation({ isReset: false, targetPlanId: 3, user: active(1), hasQueued: true }), "queue");
  assert.equal(decideActivation({ isReset: false, targetPlanId: 3, user: expired(1), hasQueued: true }), "queue");
});

test("无套餐或已到期且无排队：立即生效", () => {
  assert.equal(decideActivation({ isReset: false, targetPlanId: 2, user: none, hasQueued: false }), "activate");
  assert.equal(decideActivation({ isReset: false, targetPlanId: 2, user: expired(1), hasQueued: false }), "activate");
});

test("流量重置总是立即生效", () => {
  assert.equal(decideActivation({ isReset: true, targetPlanId: 1, user: active(1), hasQueued: true }), "activate");
});

test("下单校验：永久套餐不能买其它套餐；重置只能用于生效中的当前套餐", () => {
  assert.match(purchaseBlockReason({ isReset: false, targetPlanId: 2, user: permanent(1) }), /永久套餐/);
  assert.equal(purchaseBlockReason({ isReset: false, targetPlanId: 1, user: permanent(1) }), null);
  assert.equal(purchaseBlockReason({ isReset: false, targetPlanId: 2, user: active(1) }), null);
  assert.equal(purchaseBlockReason({ isReset: true, targetPlanId: 1, user: active(1) }), null);
  assert.equal(purchaseBlockReason({ isReset: true, targetPlanId: 1, user: permanent(1) }), null);
  assert.match(purchaseBlockReason({ isReset: true, targetPlanId: 2, user: active(1) }), /当前生效中的套餐/);
  assert.match(purchaseBlockReason({ isReset: true, targetPlanId: 1, user: expired(1) }), /生效中的订阅/);
  assert.match(purchaseBlockReason({ isReset: true, targetPlanId: 1, user: none }), /生效中的订阅/);
});
