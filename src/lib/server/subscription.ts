import "server-only";

/** 流量单位换算：套餐侧以 GB 存储，用户侧以字节存储（与 V2Board 一致）。 */
export const BYTES_PER_GB = 1073741824;

export const gbToBytes = (gb: number): number => Math.round(gb * BYTES_PER_GB);
export const bytesToGb = (bytes: number): number => bytes / BYTES_PER_GB;

/** 周期 → 月数。与 V2Board OrderService::getTime 的 strtotime('+N month') 对齐。 */
export const PERIOD_MONTHS: Record<string, number> = {
  month_price: 1,
  quarter_price: 3,
  half_year_price: 6,
  year_price: 12,
  two_year_price: 24,
  three_year_price: 36,
};

export const RECURRING_PERIODS = Object.keys(PERIOD_MONTHS);
export const ONETIME_PERIOD = "onetime_price";
export const RESET_PERIOD = "reset_price";
export const ORDER_PERIODS: string[] = [...RECURRING_PERIODS, ONETIME_PERIOD, RESET_PERIOD];

export const PERIOD_LABELS: Record<string, string> = {
  month_price: "月付",
  quarter_price: "季付",
  half_year_price: "半年付",
  year_price: "年付",
  two_year_price: "两年付",
  three_year_price: "三年付",
  onetime_price: "一次性",
  reset_price: "流量重置",
};

/** orders.order_type：1 新购，2 续费，3 升级（已停用，仅历史订单），4 流量重置 */
export const ORDER_TYPE = {
  NEW: 1,
  RENEW: 2,
  UPGRADE: 3,
  RESET_TRAFFIC: 4,
} as const;

export const ORDER_TYPE_LABELS: Record<number, string> = {
  1: "新购",
  2: "续费",
  3: "升级",
  4: "流量重置",
};

/**
 * orders.status：0 待支付，1 待生效，2 已取消，3 已完成，4 已折抵（仅历史升级单），5 已退款
 * 待生效 = 已付款、排队等当前套餐到期后开通（见 subscription-rules.ts）。
 */
export const ORDER_STATUS = {
  PENDING: 0,
  PROVISIONING: 1,
  CANCELLED: 2,
  COMPLETED: 3,
  OFFSET: 4,
  REFUNDED: 5,
} as const;

export const ORDER_STATUS_LABELS: Record<number, string> = {
  0: "待支付",
  1: "待生效",
  2: "已取消",
  3: "已完成",
  4: "已折抵",
  5: "已退款",
};

/** 视为「已实际收款」的订单状态，用于统计与优惠券核销口径。 */
export const SETTLED_ORDER_STATUSES: number[] = [ORDER_STATUS.PROVISIONING, ORDER_STATUS.COMPLETED, ORDER_STATUS.OFFSET];

/**
 * 在时间戳上叠加自然月，与 PHP strtotime('+N month') 的溢出行为保持一致
 * （例如 1 月 31 日 +1 月 = 3 月 3 日）。
 */
export function addMonths(timestampSeconds: number, months: number): number {
  const date = new Date(timestampSeconds * 1000);
  date.setUTCMonth(date.getUTCMonth() + months);
  return Math.floor(date.getTime() / 1000);
}

export type SubscriptionState = {
  planId: number | null;
  /** 到期时间戳；null 表示永久有效（一次性套餐）。 */
  expiresAt: number | null;
  /** 是否处于永久有效状态。 */
  isPermanent: boolean;
  /** 当前是否有生效中的订阅。 */
  isActive: boolean;
};

export function resolveSubscriptionState(
  planId: number | null,
  expiredAt: number | null,
  nowSeconds: number,
): SubscriptionState {
  if (planId === null) {
    return { planId: null, expiresAt: expiredAt, isPermanent: false, isActive: false };
  }
  if (expiredAt === null || expiredAt === 0) {
    return { planId, expiresAt: null, isPermanent: true, isActive: true };
  }
  return { planId, expiresAt: expiredAt, isPermanent: false, isActive: expiredAt > nowSeconds };
}

/**
 * 推导订单类型：
 * - reset_price 一律为流量重置；
 * - 订阅仍生效且购买同一套餐 → 续费；
 * - 其余（含生效中购买其它套餐，付款后排队）→ 新购。
 * 与 V2Board 不同，不再有「升级折抵」。
 */
export function resolveOrderType(input: {
  period: string;
  currentPlanId: number | null;
  currentExpiresAt: number | null;
  targetPlanId: number;
  nowSeconds: number;
}): number {
  const { period, currentPlanId, currentExpiresAt, targetPlanId, nowSeconds } = input;
  if (period === RESET_PERIOD) return ORDER_TYPE.RESET_TRAFFIC;

  const state = resolveSubscriptionState(currentPlanId, currentExpiresAt, nowSeconds);
  const isUnexpired = currentExpiresAt !== null && currentExpiresAt > nowSeconds;

  // 不再有「升级」：生效中买别的套餐是新购，付款后排队，当前套餐到期再生效，互不折抵。
  if (isUnexpired && targetPlanId === state.planId) return ORDER_TYPE.RENEW;
  return ORDER_TYPE.NEW;
}
