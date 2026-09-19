import "server-only";

import type { PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { getDbPool } from "./db";
import { getNumberSetting } from "./settings";

/**
 * 返佣（佣金）。
 *
 * `commission_logs` 表早就建好了（按 order_id 唯一、带 pending → settled 的生命周期字段），
 * 但项目里此前**只有 SELECT、没有任何 INSERT**——实测下来邀请页佣金恒为 0、明细恒为空、
 * 划转恒报「佣金余额不足」。这里补上写入与结算，读取沿用既有的 `getInvites`。
 *
 * 比例与冷静期是**全局统一**的，在后台「系统设置」中调整（未设置时回退环境变量
 * COMMISSION_RATE_PERCENT / COMMISSION_AVAILABLE_AFTER_DAYS），只影响之后产生的佣金。
 */

/** 佣金状态。与 commission_logs.status 列一致。 */
export const COMMISSION_STATUS = { PENDING: "pending", SETTLED: "settled", INVALID: "invalid" } as const;

/** orders.commission_status：0 = 未计算，1 = 已计算。 */
const ORDER_COMMISSION_CALCULATED = 1;

/**
 * 全局返佣比例（百分数）。
 *
 * 默认 0 = 不返佣。这是钱相关的设置，**默认关比默认送钱安全**——
 * 部署时没配就自动送 10% 是很糟糕的默认值。
 */
export async function commissionRatePercent(): Promise<number> {
  const raw = await getNumberSetting("commission.rate_percent");
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(raw, 100);
}

/**
 * 佣金入账等待天数。
 *
 * 留出冷静期是为了退款：订单退款后应把佣金置为 invalid，而一旦已经结算进余额就追不回来了。
 * 默认 0（立即可结算），因为当前项目还没有退款写路径，留着只会让「待结算」永远是 0。
 */
async function commissionAvailableAfterDays(): Promise<number> {
  const raw = await getNumberSetting("commission.available_after_days");
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(Math.floor(raw), 365);
}

function asNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 为一笔已确认收款的订单记录佣金。
 *
 * 调用方必须已处于事务中（与履约同一事务）：佣金和「订单推进到已完成」必须同时成功或同时失败，
 * 否则会出现订单已完成但佣金没记、或佣金记了但订单没成的对不上账。
 *
 * 无邀请人、比例为 0、或金额算出来是 0 时直接返回，不写任何东西。
 */
export async function recordCommissionForOrder(
  connection: PoolConnection,
  orderId: number,
  buyerUserId: number,
  orderAmount: number,
): Promise<void> {
  const rate = await commissionRatePercent();
  if (!rate) return;

  const [referral] = await connection.execute<RowDataPacket[]>(
    `SELECT inviter_user_id FROM user_referrals WHERE invited_user_id = ? LIMIT 1`,
    [buyerUserId],
  );
  const inviterId = asNumber(referral[0]?.inviter_user_id);
  // 自己邀请自己不该产生佣金。
  if (!inviterId || inviterId === buyerUserId) return;

  const amount = Math.floor((Math.max(0, orderAmount) * rate) / 100);
  if (amount <= 0) return;

  // 按 order_id 唯一，重复履约不会记两份；status 一旦不是 pending 就不再改动，
  // 避免把已结算/已作废的记录重新拉回待结算。
  await connection.execute(
    `INSERT INTO commission_logs
       (inviter_user_id, invited_user_id, order_id, order_amount, commission_amount, status, available_at)
     VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? DAY))
     ON DUPLICATE KEY UPDATE commission_amount = commission_amount`,
    [inviterId, buyerUserId, orderId, Math.max(0, orderAmount), amount, COMMISSION_STATUS.PENDING, await commissionAvailableAfterDays()],
  );

  await connection.execute(
    `UPDATE orders SET commission_status = ?, commission_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [ORDER_COMMISSION_CALCULATED, amount, orderId],
  );
}

/**
 * 把已到期的待结算佣金结算进 `users.commission_balance`。
 *
 * 独立事务、`FOR UPDATE` 锁行，重复调用不会重复入账（结算完状态即变成 settled）。
 * 这是「懒结算」：没有后台任务，由读取邀请概览和划转前触发。
 *
 * 划转读的是 `users.commission_balance`，不结算的话余额永远是 0、划转必然报「佣金余额不足」。
 */
export async function settleMaturedCommissions(userId: number): Promise<number> {
  const pool = getDbPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, commission_amount FROM commission_logs
        WHERE inviter_user_id = ? AND status = ?
          AND (available_at IS NULL OR available_at <= CURRENT_TIMESTAMP)
        FOR UPDATE`,
      [userId, COMMISSION_STATUS.PENDING],
    );
    if (!rows.length) {
      await connection.commit();
      return 0;
    }

    let total = 0;
    const ids: number[] = [];
    for (const row of rows) {
      total += asNumber(row.commission_amount);
      ids.push(asNumber(row.id));
    }
    if (total <= 0) {
      await connection.commit();
      return 0;
    }

    const [userRows] = await connection.execute<RowDataPacket[]>(
      `SELECT commission_balance FROM users WHERE id = ? FOR UPDATE`,
      [userId],
    );
    if (!userRows.length) {
      await connection.rollback();
      return 0;
    }
    const nextBalance = asNumber(userRows[0].commission_balance) + total;
    await connection.execute(
      `UPDATE users SET commission_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [nextBalance, userId],
    );

    const placeholders = ids.map(() => "?").join(",");
    await connection.execute(
      `UPDATE commission_logs SET status = ?, settled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id IN (${placeholders}) AND status = ?`,
      [COMMISSION_STATUS.SETTLED, ...ids, COMMISSION_STATUS.PENDING],
    );

    // 流水类型用 commission_credit：统计「已划转」时筛的是 transaction_type = 'transfer'，
    // 用别的类型才不会把入账算进划转里。
    await connection.execute(
      `INSERT INTO wallet_transactions
        (user_id, wallet_type, transaction_type, amount, balance_after, reference_type, reference_id, description)
       VALUES (?, 'commission', 'commission_credit', ?, ?, 'commission', ?, '推广佣金入账')`,
      [userId, total, nextBalance, ids[0]],
    );

    await connection.commit();
    return total;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
