import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildEpayMapiParams,
  buildEpaySubmitUrl,
  isEpayTestTradeNo,
  parseEpayOrderQuery,
  epaySign,
  epayTypeOf,
  parseEpayMapiResponse,
  parseEpayNotice,
  verifyEpaySign,
  yuanToCents,
} from "../../src/lib/server/payments/epay-protocol.ts";

const KEY = "testkey";

test("签名与易支付文档算法一致（参考值由独立 md5 计算）", () => {
  const params = {
    pid: "1000",
    type: "wxpay",
    out_trade_no: "MPABC",
    notify_url: "https://a.example/api/payments/epay/notify",
    return_url: "https://a.example/api/payments/epay/return",
    name: "订单 T1",
    money: "12.30",
    sign_type: "MD5",
    empty: "",
  };
  assert.equal(epaySign(params, KEY), "869ce0cd46011a7b1ea27716c584959f");
});

test("submit 地址携带可被验签的参数", () => {
  const url = new URL(buildEpaySubmitUrl({
    gatewayUrl: "http://pay.example/sub",
    pid: "1000",
    key: KEY,
    type: "alipay",
    outTradeNo: "MP1",
    amountCents: 1230,
    name: "订单 T1",
    notifyUrl: "https://a.example/n",
    returnUrl: "https://a.example/r",
  }));
  assert.equal(url.origin + url.pathname, "http://pay.example/sub/submit.php");
  const params = Object.fromEntries(url.searchParams);
  assert.equal(params.money, "12.30");
  assert.equal(params.sign_type, "MD5");
  assert.ok(verifyEpaySign(params, KEY));
  assert.ok(!verifyEpaySign({ ...params, money: "0.01" }, KEY));
  assert.ok(!verifyEpaySign(params, "wrong"));
});

test("金额按字符串解析，拒绝不合法格式", () => {
  assert.equal(yuanToCents("12.3"), 1230);
  assert.equal(yuanToCents("0.01"), 1);
  assert.equal(yuanToCents("5"), 500);
  assert.equal(yuanToCents("1.005"), null);
  assert.equal(yuanToCents("-1"), null);
  assert.equal(yuanToCents("1e3"), null);
});

test("渠道标识映射", () => {
  assert.equal(epayTypeOf("epay_wxpay"), "wxpay");
  assert.equal(epayTypeOf("epay_alipay"), "alipay");
  assert.equal(epayTypeOf("epay_qqpay"), null);
  assert.equal(epayTypeOf("mock"), null);
});

test("通知解析校验商户号与交易状态", () => {
  const notice = { pid: "1000", trade_no: "H123", out_trade_no: "MP1", type: "wxpay", name: "x", money: "12.30", trade_status: "TRADE_SUCCESS" };
  assert.deepEqual(parseEpayNotice(notice, "1000"), { provider: "epay_wxpay", epayTradeNo: "H123", outTradeNo: "MP1", amountCents: 1230 });
  assert.equal(parseEpayNotice(notice, "1001"), null);
  assert.equal(parseEpayNotice({ ...notice, trade_status: "WAIT" }, "1000"), null);
  assert.equal(parseEpayNotice({ ...notice, type: "qqpay" }, "1000"), null);
});

test("测试单与真实订单前缀互不重叠", () => {
  assert.ok(isEpayTestTradeNo("ET0123"));
  assert.ok(!isEpayTestTradeNo("EP0123"));
});

test("订单查询结果解析", () => {
  assert.deepEqual(
    parseEpayOrderQuery({ code: 1, trade_no: "2016", type: "alipay", money: "1.00", status: 1, endtime: "2026-09-23 10:00:00" }),
    { paid: true, tradeNo: "2016", type: "alipay", amountCents: 100, paidAt: "2026-09-23 10:00:00" },
  );
  assert.equal(parseEpayOrderQuery({ code: 1, status: 0, money: "1.00", endtime: "x" }).paidAt, null);
  assert.throws(() => parseEpayOrderQuery({ code: -1, msg: "订单号不存在" }), /订单号不存在/);
});

test("mapi.php 下单参数：签名覆盖 clientip，sign/sign_type 不参与签名，空 return_url 被剔除", () => {
  const params = buildEpayMapiParams({
    gatewayUrl: "https://pay.example.com", pid: "1000", key: KEY, type: "alipay", outTradeNo: "ETKABC",
    amountCents: 1, name: "保活", notifyUrl: "https://site.example.com/n", clientIp: "1.2.3.4",
  });
  assert.equal(params.money, "0.01");
  assert.equal(params.clientip, "1.2.3.4");
  assert.equal(params.sign_type, "MD5");
  assert.ok(!("return_url" in params));
  assert.equal(verifyEpaySign(params, KEY), true);
  assert.equal(verifyEpaySign({ ...params, clientip: "5.6.7.8" }, KEY), false);
});

test("mapi.php 返回：code=1 取 trade_no，失败时抛出渠道原因", () => {
  assert.deepEqual(parseEpayMapiResponse({ code: 1, trade_no: "2026092512345", qrcode: "https://qr" }), { tradeNo: "2026092512345" });
  assert.throws(() => parseEpayMapiResponse({ code: -1, msg: "签名校验失败" }), /签名校验失败/);
  assert.throws(() => parseEpayMapiResponse({ code: 1 }), /未返回订单号/);
});
