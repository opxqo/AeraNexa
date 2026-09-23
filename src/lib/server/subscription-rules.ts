/**
 * 多套餐排队与流量重置的定价规则（纯函数、零依赖，可被测试直接 import）。
 * 本文件会被 worker 间接引用（Node 剥离类型运行），只能使用可擦除的 TS 语法。
 *
 * 规则：用户同一时刻只有一个生效中的套餐。
 * - 生效中再买同一套餐 → 续费，到期时间叠加；
 * - 生效中买别的套餐 → 付款后排队（订单状态「待生效」），当前套餐到期后按付款顺序依次生效，互不折抵；
 * - 永久（一次性）套餐不会到期，排队永远轮不到，因此不允许再买别的套餐；
 * - 流量用完只能购买流量重置，价格 = 当前套餐月付价 × 后台比例。
 */

const PERIOD_MONTHS: Record<string, number> = {
  month_price: 1,
  quarter_price: 3,
  half_year_price: 6,
  year_price: 12,
  two_year_price: 24,
  three_year_price: 36,
};

/**
 * 套餐的月付价（分）：有月付价直接用；否则取最短的周期价换算成每月（向上取整到分）；
 * 只有一次性价格的套餐用一次性价格。都没有返回 null。
 */
export function monthlyPriceCents(prices: Record<string, number | null | undefined>): number | null {
  const month = prices.month_price;
  if (typeof month === "number" && month >= 0) return month;
  for (const [period, months] of Object.entries(PERIOD_MONTHS)) {
    const price = prices[period];
    if (typeof price === "number" && price >= 0) return Math.ceil(price / months);
  }
  const onetime = prices.onetime_price;
  return typeof onetime === "number" && onetime >= 0 ? onetime : null;
}

/** 流量重置价格（分）= 月付价 × 比例%，四舍五入到分。 */
export function resetTrafficPriceCents(monthlyCents: number, percent: number): number {
  return Math.max(0, Math.round((monthlyCents * percent) / 100));
}

export type SubscriptionSnapshot = {
  /** 用户当前套餐；没有为 null。 */
  planId: number | null;
  /** 到期时间（Unix 秒）；null 表示永久。 */
  expiresAt: number | null;
  now: number;
};

function isActive(user: SubscriptionSnapshot): boolean {
  if (user.planId === null) return false;
  return user.expiresAt === null || user.expiresAt > user.now;
}

/**
 * 已付款订单现在就开通（activate）还是排队（queue）：
 * - 流量重置作用于当前套餐，总是立即生效；
 * - 续费当前生效中的套餐：立即叠加到期时间（即便后面还有排队的套餐，它们会自然顺延）；
 * - 已有排队订单：新订单排到最后，保证按付款顺序生效；
 * - 当前有生效中的其它套餐：排队；
 * - 否则（无套餐或已到期）：立即生效。
 */
export function decideActivation(input: {
  isReset: boolean;
  targetPlanId: number;
  user: SubscriptionSnapshot;
  hasQueued: boolean;
}): "activate" | "queue" {
  if (input.isReset) return "activate";
  const active = isActive(input.user);
  if (active && input.user.planId === input.targetPlanId) return "activate";
  if (input.hasQueued) return "queue";
  return active ? "queue" : "activate";
}

/** 下单前校验；返回错误文案，允许则返回 null。 */
export function purchaseBlockReason(input: { isReset: boolean; targetPlanId: number; user: SubscriptionSnapshot }): string | null {
  const { user } = input;
  if (input.isReset) {
    if (!isActive(user)) return "需要先拥有生效中的订阅才能购买流量重置";
    if (user.planId !== input.targetPlanId) return "流量重置只能用于当前生效中的套餐";
    return null;
  }
  if (user.planId !== null && user.expiresAt === null && user.planId !== input.targetPlanId) {
    return "当前为永久套餐，不会到期，无法再购买其它套餐；流量用完可购买流量重置";
  }
  return null;
}
