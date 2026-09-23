import "server-only";

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { badRequest, conflict, forbidden, notFound, unavailable } from "./errors";
import { getDbPool } from "./db";
import { getPaymentCallbackSecret } from "./payment-credentials";
import { getOrder, settleOrder } from "./client-portal";
import { ORDER_STATUS } from "./subscription";

const MAX_CALLBACK_AGE_SECONDS = 300;

type CallbackPayload = {
  trade_no: string;
  provider_trade_no: string;
  amount_cents: number;
  currency: string;
  status: "succeeded" | "paid";
};

function asNumber(value: number | string | null | undefined): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function signatureInput(timestamp: string, eventId: string, body: string) {
  return `${timestamp}.${eventId}.${body}`;
}

export function signPaymentCallback(timestamp: string, eventId: string, rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(signatureInput(timestamp, eventId, rawBody)).digest("hex");
}

function isValidSignature(actual: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(actual)) return false;
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function parsePayload(rawBody: string): CallbackPayload {
  let candidate: unknown;
  try { candidate = JSON.parse(rawBody); } catch { throw badRequest("回调 JSON 格式不正确"); }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw badRequest("回调内容不正确");
  const source = candidate as Record<string, unknown>;
  const tradeNo = typeof source.trade_no === "string" ? source.trade_no.trim().slice(0, 64) : "";
  const providerTradeNo = typeof source.provider_trade_no === "string" ? source.provider_trade_no.trim().slice(0, 255) : "";
  const amount = Number(source.amount_cents);
  const currency = typeof source.currency === "string" ? source.currency.trim().toUpperCase() : "";
  const status = source.status === "succeeded" || source.status === "paid" ? source.status : null;
  if (!tradeNo || !providerTradeNo || !Number.isSafeInteger(amount) || amount <= 0 || currency !== "CNY" || !status) {
    throw badRequest("回调字段不正确");
  }
  return { trade_no: tradeNo, provider_trade_no: providerTradeNo, amount_cents: amount, currency, status };
}

type ProcessInput = { provider: string; timestamp: string; eventId: string; signature: string; rawBody: string };

/** 处理真实渠道与本地沙箱共用的 HMAC 回调。 */
export async function processPaymentCallback(input: ProcessInput) {
  const provider = input.provider.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,50}$/.test(provider)) throw badRequest("支付渠道标识不正确");
  if (!input.eventId || input.eventId.length > 255) throw badRequest("缺少回调事件编号");
  const timestampSeconds = Number(input.timestamp);
  if (!Number.isSafeInteger(timestampSeconds) || Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > MAX_CALLBACK_AGE_SECONDS) {
    throw badRequest("回调时间戳无效或已过期");
  }
  const payload = parsePayload(input.rawBody);
  return applyGatewayCallback({
    provider,
    eventId: input.eventId,
    timestampSeconds,
    rawBody: input.rawBody,
    payload,
    verify: (secret) => Boolean(secret && isValidSignature(input.signature, signPaymentCallback(input.timestamp, input.eventId, input.rawBody, secret))),
  });
}

type GatewayCallbackInput = {
  provider: string;
  eventId: string;
  timestampSeconds: number;
  /** 原始报文（JSON 字符串），落库留痕。 */
  rawBody: string;
  /** trade_no 为空时按 provider_trade_no 关联到的订单处理（易支付类渠道只回传交易号）。 */
  payload: CallbackPayload;
  /** 用渠道保存的密钥校验签名；密钥缺失时传入 null。 */
  verify: (secret: string | null) => boolean;
};

/** 各渠道验签方式不同，验签之后的幂等落库、金额核对与履约共用这一段。 */
export async function applyGatewayCallback(input: GatewayCallbackInput) {
  const { provider, payload } = input;
  const connection = await getDbPool().getConnection();
  const payloadHash = createHash("sha256").update(input.rawBody).digest("hex");
  let receiptId = 0;
  try {
    await connection.beginTransaction();
    const [existingRows] = await connection.execute<RowDataPacket[]>(
      "SELECT id, processing_status FROM payment_callback_events WHERE provider = ? AND event_id = ? LIMIT 1 FOR UPDATE",
      [provider, input.eventId],
    );
    if (existingRows[0]) {
      await connection.commit();
      return { duplicate: true, processed: String(existingRows[0].processing_status) === "processed" };
    }

    const [methods] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM payment_methods WHERE provider = ? LIMIT 1",
      [provider],
    );
    const method = methods[0];
    const secret = method ? await getPaymentCallbackSecret(asNumber(method.id), provider) : null;
    const valid = input.verify(secret);
    const [receipt] = await connection.execute<ResultSetHeader>(
      `INSERT INTO payment_callback_events
        (provider, event_id, timestamp_seconds, signature_valid, payload, payload_sha256, processing_status, error_message)
       VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?)`,
      [provider, input.eventId, input.timestampSeconds, valid ? 1 : 0, input.rawBody, payloadHash, valid ? "received" : "rejected", valid ? null : "signature invalid or provider unavailable"],
    );
    receiptId = Number(receipt.insertId);
    if (!valid) {
      await connection.commit();
      throw forbidden("支付回调验签失败");
    }

    const [transactions] = await connection.execute<RowDataPacket[]>(
      `SELECT pt.id, pt.order_id, pt.amount, pt.currency, pt.status, pm.provider, o.user_id, o.trade_no
         FROM payment_transactions pt
         INNER JOIN payment_methods pm ON pm.id = pt.payment_method_id
         INNER JOIN orders o ON o.id = pt.order_id
        WHERE pt.provider_trade_no = ? AND pm.provider = ? LIMIT 1 FOR UPDATE`,
      [payload.provider_trade_no, provider],
    );
    const transaction = transactions[0];
    if (!transaction || asNumber(transaction.amount) !== payload.amount_cents || String(transaction.currency) !== payload.currency) {
      await connection.execute(
        "UPDATE payment_callback_events SET processing_status = 'unmatched', error_message = ? WHERE id = ?",
        [transaction ? "amount or currency mismatch" : "transaction not found", receiptId],
      );
      await connection.commit();
      return { duplicate: false, processed: false, unmatched: true };
    }
    const transactionId = asNumber(transaction.id);
    const orderId = asNumber(transaction.order_id);
    const order = await getOrder(connection, asNumber(transaction.user_id), payload.trade_no || String(transaction.trade_no), true);
    if (!order || asNumber(order.id) !== orderId) {
      await connection.execute("UPDATE payment_callback_events SET processing_status = 'unmatched', error_message = 'order not found' WHERE id = ?", [receiptId]);
      await connection.commit();
      return { duplicate: false, processed: false, unmatched: true };
    }

    if (asNumber(order.status) === ORDER_STATUS.COMPLETED && String(transaction.status) === "completed") {
      await connection.execute(
        `UPDATE payment_callback_events SET processing_status = 'processed', transaction_id = ?, order_id = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [transactionId, orderId, receiptId],
      );
      await connection.commit();
      return { duplicate: false, processed: true };
    }
    if (asNumber(order.status) !== ORDER_STATUS.PENDING || String(transaction.status) !== "pending") throw conflict("订单或支付交易当前不可处理");

    await settleOrder(connection, order, asNumber(transaction.user_id), "gateway", null, payload.provider_trade_no);
    await connection.execute("UPDATE payment_transactions SET status = 'completed', paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [transactionId]);
    await connection.execute(
      `INSERT INTO payment_events
        (order_id, transaction_id, provider, provider_event_id, event_type, signature_valid, payload, processing_status, processed_at)
       VALUES (?, ?, ?, ?, 'payment.succeeded', 1, CAST(? AS JSON), 'processed', CURRENT_TIMESTAMP)`,
      [orderId, transactionId, provider, input.eventId, input.rawBody],
    );
    await connection.execute(
      `UPDATE payment_callback_events SET processing_status = 'processed', transaction_id = ?, order_id = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [transactionId, orderId, receiptId],
    );
    await connection.commit();
    return { duplicate: false, processed: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function dispatchSandboxPaymentCallback(transactionId: number) {
  const [rows] = await getDbPool().execute<RowDataPacket[]>(
    `SELECT pt.id, pt.provider_trade_no, pt.amount, pt.currency, o.trade_no, pm.provider, pm.id AS method_id
       FROM payment_transactions pt
       INNER JOIN orders o ON o.id = pt.order_id
       INNER JOIN payment_methods pm ON pm.id = pt.payment_method_id
      WHERE pt.id = ? AND pt.status = 'pending' LIMIT 1`,
    [transactionId],
  );
  const row = rows[0];
  if (!row || String(row.provider) !== "mock") throw notFound("待处理的模拟支付交易不存在");
  const secret = await getPaymentCallbackSecret(asNumber(row.method_id), "mock");
  if (!secret) throw unavailable("签名沙箱密钥不可用");
  const eventId = `sandbox-${randomUUID()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = JSON.stringify({ trade_no: String(row.trade_no), provider_trade_no: String(row.provider_trade_no), amount_cents: asNumber(row.amount), currency: String(row.currency), status: "succeeded" });
  return processPaymentCallback({ provider: "mock", timestamp, eventId, rawBody, signature: signPaymentCallback(timestamp, eventId, rawBody, secret) });
}
