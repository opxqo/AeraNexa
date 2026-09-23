import "server-only";

import type { RowDataPacket } from "mysql2";
import { getDbPool } from "../db";
import { applyGatewayCallback } from "../payment-callbacks";
import { getEpayConfig } from "./epay-config";
import { isEpayTestTradeNo, parseEpayNotice, verifyEpaySign } from "./epay-protocol";
import { handleEpayTestNotice } from "./epay-test";

/**
 * 处理易支付异步通知或 return_url 跳转携带的已签名参数。
 * 两个入口共用同一个事件编号，先到者入账，后到者按重复事件返回。
 */
export async function handleEpayNotice(params: Record<string, string>, source: "notify" | "return") {
  const notice = parseEpayNotice(params, (await getEpayConfig()).pid);
  if (!notice) return { processed: false, tradeNo: null, testTradeNo: null };
  if (isEpayTestTradeNo(notice.outTradeNo)) {
    const processed = await handleEpayTestNotice(notice, params, source);
    return { processed, tradeNo: null, testTradeNo: notice.outTradeNo };
  }
  const result = await applyGatewayCallback({
    provider: notice.provider,
    eventId: `epay-${notice.epayTradeNo}`,
    timestampSeconds: Math.floor(Date.now() / 1000),
    rawBody: JSON.stringify(params),
    payload: {
      trade_no: "",
      provider_trade_no: notice.outTradeNo,
      amount_cents: notice.amountCents,
      currency: "CNY",
      status: "paid",
    },
    verify: (secret) => Boolean(secret && verifyEpaySign(params, secret)),
  });
  return { processed: result.processed, tradeNo: await orderTradeNoOf(notice.outTradeNo), testTradeNo: null };
}

async function orderTradeNoOf(providerTradeNo: string): Promise<string | null> {
  const [rows] = await getDbPool().execute<RowDataPacket[]>(
    `SELECT o.trade_no FROM payment_transactions pt INNER JOIN orders o ON o.id = pt.order_id
      WHERE pt.provider_trade_no = ? LIMIT 1`,
    [providerTradeNo],
  );
  return rows[0] ? String(rows[0].trade_no) : null;
}
