import "server-only";

import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { conflict, notFound } from "./errors";
import { getDbPool } from "./db";

function asNumber(value: number | string | null | undefined): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

/**
 * 仅退回余额支付的完整实付额。订单仍保持已完成，避免把退款误当作订阅回滚。
 */
export async function refundBalanceOrder(orderId: number, adminId: number, rawReason: string) {
  const reason = rawReason.trim().slice(0, 500);
  if (!reason) throw conflict("请填写退款原因");
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [transactions] = await connection.execute<RowDataPacket[]>(
      `SELECT pt.id, pt.order_id, pt.amount, pt.status, o.user_id, pm.provider
         FROM payment_transactions pt
         INNER JOIN orders o ON o.id = pt.order_id
         INNER JOIN payment_methods pm ON pm.id = pt.payment_method_id
        WHERE pt.order_id = ? AND pt.status = 'completed'
        ORDER BY pt.id DESC LIMIT 1 FOR UPDATE`,
      [orderId],
    );
    const transaction = transactions[0];
    if (!transaction) throw notFound("未找到已完成的支付交易");
    if (String(transaction.provider) !== "balance") throw conflict("当前仅支持余额支付订单退款");

    const transactionId = asNumber(transaction.id);
    const [existing] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM payment_refunds WHERE transaction_id = ? LIMIT 1 FOR UPDATE",
      [transactionId],
    );
    if (existing[0]) throw conflict("该笔交易已经退款");

    const userId = asNumber(transaction.user_id);
    const [users] = await connection.execute<RowDataPacket[]>(
      "SELECT balance FROM users WHERE id = ? LIMIT 1 FOR UPDATE",
      [userId],
    );
    const user = users[0];
    if (!user) throw notFound("退款用户不存在");
    const amount = asNumber(transaction.amount);
    if (amount <= 0) throw conflict("退款金额不正确");
    const nextBalance = asNumber(user.balance) + amount;
    const [refund] = await connection.execute<ResultSetHeader>(
      `INSERT INTO payment_refunds (order_id, transaction_id, user_id, admin_id, amount, reason, status, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, 'completed', CURRENT_TIMESTAMP)`,
      [orderId, transactionId, userId, adminId, amount, reason],
    );
    const refundId = Number(refund.insertId);
    await connection.execute("UPDATE users SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [nextBalance, userId]);
    await connection.execute(
      `INSERT INTO wallet_transactions
        (user_id, wallet_type, transaction_type, amount, balance_after, reference_type, reference_id, description)
       VALUES (?, 'balance', 'order_refund', ?, ?, 'payment_refund', ?, '管理员余额退款')`,
      [userId, amount, nextBalance, refundId],
    );
    await connection.commit();
    return { id: refundId, amount, userId, transactionId, balance: nextBalance };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
