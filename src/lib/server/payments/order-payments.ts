import "server-only";

import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { closePendingTransactions } from "../client-portal";
import { getDbPool } from "../db";
import { applyGatewayCallback } from "../payment-callbacks";
import { getPaymentCallbackSecret } from "../payment-credentials";
import { callEpayApi } from "./epay-api";
import { getEpayConfig } from "./epay-config";
import { epayTypeOf, parseEpayOrderQuery } from "./epay-protocol";
import { PENDING_ORDER_TIMEOUT_MINUTES } from "./order-payment-policy";

/**
 * 订单与支付渠道的主动对账：不依赖渠道的异步通知，由本站向渠道查单补单。
 *
 * 三个入口共用 syncEpayTransaction：
 * - 订单页轮询状态时顺带查一次（用户付完款关掉页面、通知又丢了也能开通）；
 * - worker 定时扫描近期交易，并关闭超时未付的订单；
 * - 后台订单「向渠道查单」。
 *
 * 查单结果与异步通知用同一个事件编号（epay-渠道单号）进入 applyGatewayCallback，谁先到谁入账，后到的按重复事件忽略。
 * 本文件会被 worker 引用（Node 剥离类型运行），只能使用可擦除的 TS 语法。
 */

export type SyncOutcome = "paid" | "unpaid" | "skipped";

type TransactionRow = RowDataPacket & {
  id: number;
  provider_trade_no: string | null;
  status: string;
  method_id: number;
  provider: string;
};

async function loadTransaction(transactionId: number): Promise<TransactionRow | null> {
  const [rows] = await getDbPool().execute<TransactionRow[]>(
    `SELECT pt.id, pt.provider_trade_no, pt.status, pm.id AS method_id, pm.provider
       FROM payment_transactions pt INNER JOIN payment_methods pm ON pm.id = pt.payment_method_id
      WHERE pt.id = ? LIMIT 1`,
    [transactionId],
  );
  return rows[0] ?? null;
}

/**
 * 向渠道查询一笔易支付流水；已支付则按网关回调入账（待支付 → 开通，已关闭 → 恢复开通或转余额）。
 * minIntervalSeconds 用于限频：距上次查单不足该秒数时跳过，返回 skipped。
 */
export async function syncEpayTransaction(transactionId: number, minIntervalSeconds = 0): Promise<SyncOutcome> {
  const transaction = await loadTransaction(transactionId);
  if (!transaction || !transaction.provider_trade_no || !epayTypeOf(transaction.provider)) return "skipped";
  if (transaction.status !== "pending" && transaction.status !== "closed") return "skipped";

  // 先占住查单时间再发请求：并发的轮询请求只会有一个真正打到渠道。
  const [claimed] = await getDbPool().execute<ResultSetHeader>(
    `UPDATE payment_transactions SET last_queried_at = CURRENT_TIMESTAMP
      WHERE id = ? AND (last_queried_at IS NULL OR last_queried_at <= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? SECOND))`,
    [transactionId, minIntervalSeconds],
  );
  if (claimed.affectedRows !== 1) return "skipped";

  const key = await getPaymentCallbackSecret(Number(transaction.method_id), transaction.provider);
  if (!key) return "skipped";
  const { gatewayUrl, pid } = await getEpayConfig();
  const outTradeNo = transaction.provider_trade_no;
  const body = await callEpayApi(gatewayUrl, { act: "order", pid, key, out_trade_no: outTradeNo });

  let result: ReturnType<typeof parseEpayOrderQuery>;
  try {
    result = parseEpayOrderQuery(body);
  } catch {
    // 用户还没打开收银台时渠道里没有这笔单，查询返回「订单不存在」。
    return "unpaid";
  }
  if (!result.paid || result.amountCents === null || !result.tradeNo) return "unpaid";

  const applied = await applyGatewayCallback({
    provider: transaction.provider,
    eventId: `epay-${result.tradeNo}`,
    timestampSeconds: Math.floor(Date.now() / 1000),
    rawBody: JSON.stringify({ source: "query", ...body }),
    payload: {
      trade_no: "",
      provider_trade_no: outTradeNo,
      amount_cents: result.amountCents,
      currency: "CNY",
      status: "paid",
    },
    // 查单是本站带商户密钥主动发起的 HTTPS 请求，结果本身可信，无需再验签。
    verify: () => true,
  });
  if (!applied.processed) throw new Error(`渠道已收款但与本站流水 ${outTradeNo} 不一致（金额或币种），需人工核对`);
  return "paid";
}

async function epayTransactionIdsOfOrder(orderId: number, statuses: readonly string[]): Promise<number[]> {
  const [rows] = await getDbPool().query<RowDataPacket[]>(
    `SELECT pt.id FROM payment_transactions pt INNER JOIN payment_methods pm ON pm.id = pt.payment_method_id
      WHERE pt.order_id = ? AND pt.status IN (?) AND pm.provider LIKE 'epay\\_%' ORDER BY pt.id DESC`,
    [orderId, statuses],
  );
  return rows.map((row) => Number(row.id));
}

export type OrderSyncSummary = { transactions: number; paid: number; errors: string[] };

/** 逐笔查询订单下的易支付流水。任一笔确认已支付即入账；查询出错不中断其余流水。 */
export async function syncOrderPayments(
  orderId: number,
  options: { minIntervalSeconds?: number; includeClosed?: boolean } = {},
): Promise<OrderSyncSummary> {
  const ids = await epayTransactionIdsOfOrder(orderId, options.includeClosed ? ["pending", "closed"] : ["pending"]);
  const summary: OrderSyncSummary = { transactions: ids.length, paid: 0, errors: [] };
  for (const id of ids) {
    try {
      if ((await syncEpayTransaction(id, options.minIntervalSeconds ?? 0)) === "paid") summary.paid += 1;
    } catch (error) {
      summary.errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return summary;
}

/** 订单页轮询用：只查属于该用户的待支付订单，按 minIntervalSeconds 限频。 */
export async function syncPendingOrderForUser(userId: number, tradeNo: string, minIntervalSeconds: number): Promise<void> {
  const [rows] = await getDbPool().execute<RowDataPacket[]>(
    "SELECT id FROM orders WHERE user_id = ? AND trade_no = ? AND status = 0 LIMIT 1",
    [userId, tradeNo],
  );
  if (rows[0]) await syncOrderPayments(Number(rows[0].id), { minIntervalSeconds });
}

export type PaymentSweepResult = { queried: number; paid: number; closedOrders: number; errors: number };

/** 一轮最多处理的数量，避免渠道异常时一轮拖太久；剩下的下一轮继续。 */
const SWEEP_BATCH = 30;
/** 已关闭流水在这段时间内仍查单，兜住「关单后在旧收银台付款且通知丢失」。 */
const CLOSED_RECHECK_MINUTES = 120;

/**
 * worker 定时任务：
 * 1. 查询近期未完成的易支付流水（待支付订单的 pending 流水每 20 秒一次；已关闭流水每 3 分钟一次，保留 2 小时）；
 * 2. 关闭超时未付的待支付订单：关单前先向渠道查一次，已付的直接开通而不是关单。
 */
export async function sweepOrderPayments(): Promise<PaymentSweepResult> {
  const result: PaymentSweepResult = { queried: 0, paid: 0, closedOrders: 0, errors: 0 };
  const pool = getDbPool();

  const [recent] = await pool.query<RowDataPacket[]>(
    `SELECT pt.id, pt.status FROM payment_transactions pt INNER JOIN payment_methods pm ON pm.id = pt.payment_method_id
      WHERE pm.provider LIKE 'epay\\_%'
        AND ((pt.status = 'pending' AND (pt.last_queried_at IS NULL OR pt.last_queried_at <= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 20 SECOND)))
          OR (pt.status = 'closed' AND pt.created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? MINUTE)
              AND (pt.last_queried_at IS NULL OR pt.last_queried_at <= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 3 MINUTE))))
      ORDER BY pt.status = 'pending' DESC, pt.id DESC
      LIMIT ?`,
    [CLOSED_RECHECK_MINUTES, SWEEP_BATCH],
  );
  for (const row of recent) {
    const interval = String(row.status) === "pending" ? 20 : 180;
    try {
      const outcome = await syncEpayTransaction(Number(row.id), interval);
      if (outcome !== "skipped") result.queried += 1;
      if (outcome === "paid") result.paid += 1;
    } catch {
      result.errors += 1;
    }
  }

  const [expired] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM orders WHERE status = 0 AND updated_at <= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? MINUTE) ORDER BY id ASC LIMIT ?`,
    [PENDING_ORDER_TIMEOUT_MINUTES, SWEEP_BATCH],
  );
  for (const row of expired) {
    const orderId = Number(row.id);
    const sync = await syncOrderPayments(orderId);
    result.queried += sync.transactions;
    result.paid += sync.paid;
    // 渠道查不通时不能确定用户没付款，这一轮先不关，下一轮再试。
    if (sync.errors.length) {
      result.errors += sync.errors.length;
      continue;
    }
    if (await closeExpiredOrder(orderId)) result.closedOrders += 1;
  }
  return result;
}

/** 关闭超时订单：与用户取消一致，释放优惠券、关闭未完成流水。条件更新保证期间被支付 / 改单的订单不会被误关。 */
async function closeExpiredOrder(orderId: number): Promise<boolean> {
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [updated] = await connection.execute<ResultSetHeader>(
      `UPDATE orders SET status = 2, cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 0 AND updated_at <= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? MINUTE)`,
      [orderId, PENDING_ORDER_TIMEOUT_MINUTES],
    );
    if (updated.affectedRows !== 1) {
      await connection.rollback();
      return false;
    }
    await closePendingTransactions(connection, orderId);
    await connection.execute("DELETE FROM coupon_usages WHERE order_id = ?", [orderId]);
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
