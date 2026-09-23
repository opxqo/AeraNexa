import "server-only";

import { randomBytes } from "node:crypto";
import type { Pool, PoolConnection } from "mysql2/promise";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import {
  commissionAvailableAfterDays,
  commissionRatePercent,
  recordCommissionForOrder,
  settleMaturedCommissions,
} from "./commission";
import { getDbPool } from "./db";
import { markPanelClientDirty } from "./node-sync";
import { getPaymentCallbackSecret } from "./payment-credentials";
import { getEpayConfig } from "./payments/epay-config";
import { buildEpaySubmitUrl, epayTypeOf } from "./payments/epay-protocol";
import { PENDING_ORDER_TIMEOUT_MINUTES } from "./payments/order-payment-policy";
import { getNumberSetting } from "./settings";
import { decideActivation, monthlyPriceCents, purchaseBlockReason, resetTrafficPriceCents } from "./subscription-rules";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  tooManyRequests,
  unavailable,
} from "./errors";
import {
  ONETIME_PERIOD,
  ORDER_PERIODS,
  ORDER_STATUS,
  ORDER_STATUS_LABELS,
  ORDER_TYPE,
  ORDER_TYPE_LABELS,
  PERIOD_LABELS,
  PERIOD_MONTHS,
  RESET_PERIOD,
  SETTLED_ORDER_STATUSES,
  addMonths,
  gbToBytes,
  resolveOrderType,
} from "./subscription";

type SqlExecutor = Pool | PoolConnection;

export type ClientPlan = RowDataPacket & {
  id: number; group_id: number | null; transfer_enable: number | string; name: string; speed_limit: number | null;
  is_visible: number; is_renewable: number; sort_order: number; content: string | null;
  month_price: number | string | null; quarter_price: number | string | null; half_year_price: number | string | null;
  year_price: number | string | null; two_year_price: number | string | null; three_year_price: number | string | null;
  onetime_price: number | string | null; reset_price: number | string | null; capacity_limit: number | null;
  created_at: Date; updated_at: Date;
};

export type OrderRow = RowDataPacket & {
  id: number; user_id: number; plan_id: number; payment_method_id: number | null; coupon_id: number | null;
  order_type: number; period: string; trade_no: string;
  total_amount: number | string; handling_amount: number | string; discount_amount: number | string;
  surplus_amount: number | string; refund_amount: number | string; balance_amount: number | string;
  surplus_order_ids: string | null; status: number; commission_amount: number | string;
  fulfillment_source: string | null; fulfilled_by_admin_id: number | null; admin_remark: string | null;
  paid_at: Date | null; cancelled_at: Date | null; completed_at: Date | null;
  created_at: Date; updated_at: Date; plan_name: string; transfer_enable: number | string;
  speed_limit: number | null; is_renewable: number;
};

/**
 * coupons 表没有 used_count 冗余列，已核销次数统一以 coupon_usages 为准，
 * 因此这里不声明该字段，避免误用不存在的列导致 SQL 报错。
 */
type CouponRow = RowDataPacket & {
  id: number; code: string; name: string; discount_type: number; discount_value: number | string;
  max_uses: number | null; max_uses_per_user: number | null; plan_ids: string | null;
  periods: string | null;
};

type UserSubscriptionRow = RowDataPacket & {
  id: number; plan_id: number | null; expired_at: number | string | null;
  transfer_enable: number | string; upload_bytes: number | string; download_bytes: number | string;
  is_active: number;
};

/** 同一用户对同一套餐/周期重复下单的冷静期，避免误触产生大量僵尸订单。 */
const DUPLICATE_ORDER_WINDOW_MINUTES = 15;
/** 单用户同时存在的待支付订单上限。 */
const MAX_PENDING_ORDERS = 5;
/** 单用户同时存在的未关闭工单上限。 */
const MAX_OPEN_TICKETS = 10;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function asNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function unix(value: Date | null | undefined): number | null {
  return value ? Math.floor(new Date(value).getTime() / 1000) : null;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * JSON 列 → 数组。
 *
 * mysql2 会按字段类型把 JSON 列自动反序列化成 JS 值，所以这里通常直接拿到数组。
 * 早先只按字符串处理（`JSON.parse(value)`），而 `JSON.parse(数组)` 会先被强制转成
 * `"a,b"` 再解析失败，于是**恒返回 null**——后果是优惠券的「适用套餐 / 适用周期」
 * 限制从未真正生效（`planIds` 为 null 时校验被整段跳过），节点标签也永远不返回。
 * 现在两种形态都接住。
 */
function jsonList(value: unknown): unknown[] | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function jsonNumberList(value: unknown): number[] | null {
  const list = jsonList(value);
  if (!list) return null;
  const numbers = list.map((item) => Number(item)).filter((item) => Number.isSafeInteger(item) && item > 0);
  return numbers.length ? numbers : null;
}

function normalizePaging(page?: number, pageSize?: number): { page: number; pageSize: number; offset: number } {
  const safePage = Number.isInteger(page) && (page as number) > 0 ? (page as number) : 1;
  const requested = Number.isInteger(pageSize) && (pageSize as number) > 0 ? (pageSize as number) : DEFAULT_PAGE_SIZE;
  const safeSize = Math.min(requested, MAX_PAGE_SIZE);
  return { page: safePage, pageSize: safeSize, offset: (safePage - 1) * safeSize };
}

// ---------------------------------------------------------------------------
// 序列化
// ---------------------------------------------------------------------------

const planPriceColumns = [
  "month_price", "quarter_price", "half_year_price", "year_price",
  "two_year_price", "three_year_price", "onetime_price", "reset_price",
] as const;

export function planPeriodPriceCents(plan: ClientPlan, period: string): number | null {
  if (!(planPriceColumns as readonly string[]).includes(period)) return null;
  const value = plan[period as (typeof planPriceColumns)[number]];
  if (value === null || value === undefined) return null;
  return asNumber(value);
}

function availablePeriods(plan: ClientPlan): string[] {
  return ORDER_PERIODS.filter((period) => {
    if (period === RESET_PERIOD) return false;
    const price = planPeriodPriceCents(plan, period);
    return price !== null && price >= 0;
  });
}

function serializePlan(row: ClientPlan) {
  const base = {
    id: asNumber(row.id),
    group_id: row.group_id === null ? 0 : asNumber(row.group_id),
    transfer_enable: asNumber(row.transfer_enable),
    name: row.name,
    speed_limit: row.speed_limit === null ? null : asNumber(row.speed_limit),
    show: row.is_visible ? 1 : 0,
    sort: asNumber(row.sort_order),
    renew: row.is_renewable ? 1 : 0,
    content: row.content,
    capacity_limit: row.capacity_limit === null ? null : asNumber(row.capacity_limit),
    created_at: unix(row.created_at),
    updated_at: unix(row.updated_at),
  };
  const prices: Record<string, number | null> = {};
  for (const column of planPriceColumns) {
    const value = row[column];
    prices[column] = value === null || value === undefined ? null : asNumber(value);
  }
  return {
    ...base,
    ...prices,
    available_periods: availablePeriods(row),
    reset_price: prices.reset_price,
  };
}

function serializeOrder(row: OrderRow) {
  const total = asNumber(row.total_amount);
  const discount = asNumber(row.discount_amount);
  const surplus = asNumber(row.surplus_amount);
  const status = asNumber(row.status);
  const orderType = asNumber(row.order_type) || ORDER_TYPE.NEW;
  return {
    id: asNumber(row.id),
    user_id: asNumber(row.user_id),
    plan_id: asNumber(row.plan_id),
    payment_id: row.payment_method_id === null ? null : asNumber(row.payment_method_id),
    coupon_id: row.coupon_id === null ? null : asNumber(row.coupon_id),
    type: orderType,
    type_label: ORDER_TYPE_LABELS[orderType] ?? "新购",
    period: row.period,
    period_label: PERIOD_LABELS[row.period] ?? row.period,
    trade_no: row.trade_no,
    // 金额单位统一为「分」：subtotal 为周期原价，total_amount 为应付金额。
    subtotal_amount: total + discount + surplus,
    total_amount: total,
    payable_amount: total,
    handling_amount: asNumber(row.handling_amount),
    discount_amount: discount,
    surplus_amount: surplus,
    refund_amount: asNumber(row.refund_amount),
    balance_amount: asNumber(row.balance_amount),
    status,
    status_label: ORDER_STATUS_LABELS[status] ?? "未知",
    payable: status === ORDER_STATUS.PENDING,
    // 待支付订单的自动关闭时间：发起支付、改单都会刷新 updated_at，从而顺延。
    pay_deadline: status === ORDER_STATUS.PENDING ? (unix(row.updated_at) ?? 0) + PENDING_ORDER_TIMEOUT_MINUTES * 60 : null,
    paid_at: unix(row.paid_at),
    cancelled_at: unix(row.cancelled_at),
    completed_at: unix(row.completed_at),
    created_at: unix(row.created_at),
    updated_at: unix(row.updated_at),
    plan: {
      id: asNumber(row.plan_id),
      name: row.plan_name,
      transfer_enable: asNumber(row.transfer_enable),
      speed_limit: row.speed_limit,
      renew: row.is_renewable ? 1 : 0,
    },
  };
}

export type ClientOrder = ReturnType<typeof serializeOrder>;

// ---------------------------------------------------------------------------
// 套餐
// ---------------------------------------------------------------------------

export async function listPlans() {
  const [rows] = await getDbPool().query<ClientPlan[]>(
    `SELECT * FROM plans WHERE is_visible = 1 ORDER BY sort_order ASC, id ASC`,
  );
  // 过滤掉没有任何可售周期的套餐，避免前台出现无法下单的卡片。
  return rows.filter((row) => availablePeriods(row).length > 0).map(serializePlan);
}

/** 下单用的套餐：流量重置作用于用户当前套餐，即便该套餐已下架也允许；其余只能买上架套餐。 */
async function getPlanForOrder(executor: SqlExecutor, planId: number, period: string): Promise<ClientPlan | null> {
  if (period !== RESET_PERIOD) return getVisiblePlan(executor, planId);
  const [rows] = await executor.execute<ClientPlan[]>(`SELECT * FROM plans WHERE id = ? LIMIT 1`, [planId]);
  return rows[0] ?? null;
}

async function getVisiblePlan(executor: SqlExecutor, planId: number): Promise<ClientPlan | null> {
  const [rows] = await executor.execute<ClientPlan[]>(
    `SELECT * FROM plans WHERE id = ? AND is_visible = 1 LIMIT 1`,
    [planId],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// 优惠券
// ---------------------------------------------------------------------------

type ResolvedCoupon = { id: number; code: string; name: string; type: number; value: number };

/**
 * 校验优惠券。
 *
 * 传 withLock 时对券行加排他锁：并发核销同一张券会在该行上串行化，
 * 因此「统计已用次数 → 判断是否超发」这段读改写是安全的。
 */
async function resolveCoupon(
  executor: SqlExecutor,
  userId: number,
  rawCode: string,
  planId: number,
  period: string | undefined,
  withLock = false,
): Promise<ResolvedCoupon> {
  const normalized = rawCode.trim().toUpperCase();
  if (!normalized) throw badRequest("请输入优惠码");

  const [rows] = await executor.execute<CouponRow[]>(
    `SELECT * FROM coupons
      WHERE code = ? AND is_active = 1
        AND (starts_at IS NULL OR starts_at <= CURRENT_TIMESTAMP)
        AND (ends_at IS NULL OR ends_at >= CURRENT_TIMESTAMP)
      LIMIT 1${withLock ? " FOR UPDATE" : ""}`,
    [normalized],
  );
  const coupon = rows[0];
  if (!coupon) throw notFound("优惠券无效或已过期");

  // 已核销次数直接以 coupon_usages 为准，避免冗余计数与真实记录漂移。
  const [globalUsageRows] = await executor.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM coupon_usages WHERE coupon_id = ?`,
    [coupon.id],
  );
  if (coupon.max_uses !== null && asNumber(globalUsageRows[0]?.total) >= asNumber(coupon.max_uses)) {
    throw conflict("优惠券已被领完");
  }

  const planIds = jsonNumberList(coupon.plan_ids);
  if (planIds && !planIds.includes(planId)) throw badRequest("该优惠券不适用于此套餐");

  const periods = jsonList(coupon.periods);
  if (period && periods && !periods.map(String).includes(period)) {
    throw badRequest("该优惠券不适用于所选付款周期");
  }

  const [usageRows] = await executor.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM coupon_usages WHERE coupon_id = ? AND user_id = ?`,
    [coupon.id, userId],
  );
  if (coupon.max_uses_per_user !== null && asNumber(usageRows[0]?.total) >= asNumber(coupon.max_uses_per_user)) {
    throw conflict("该优惠券已达到您的使用次数上限");
  }

  return {
    id: coupon.id,
    code: coupon.code,
    name: coupon.name,
    type: coupon.discount_type === 2 ? 2 : 1,
    // type 1 = 固定金额（分），type 2 = 百分比整数（与 V2Board 的 value/100 一致）
    value: coupon.discount_type === 2 ? Math.min(100, asNumber(coupon.discount_value)) : asNumber(coupon.discount_value),
  };
}

function computeDiscountCents(coupon: ResolvedCoupon | null, subtotalCents: number): number {
  if (!coupon) return 0;
  const raw = coupon.type === 2 ? Math.floor((subtotalCents * coupon.value) / 100) : coupon.value;
  return Math.max(0, Math.min(subtotalCents, raw));
}

export async function verifyCoupon(userId: number, code: string, planId: number, period?: string) {
  const plan = await getVisiblePlan(getDbPool(), planId);
  if (!plan) throw notFound("套餐不存在或暂未开放购买");
  const price = planPeriodPriceCents(plan, period ?? "month_price");
  if (price === null) throw badRequest("该套餐暂不支持所选付款周期");
  const coupon = await resolveCoupon(getDbPool(), userId, code, planId, period);
  const discount = computeDiscountCents(coupon, price);
  return {
    id: coupon.id,
    code: coupon.code,
    name: coupon.name,
    type: coupon.type,
    value: coupon.value,
    /** 实际可抵扣金额（分），前端应直接展示此值。 */
    discount_amount: discount,
    subtotal_amount: price,
    total_amount: Math.max(0, price - discount),
  };
}

// ---------------------------------------------------------------------------
// 订单
// ---------------------------------------------------------------------------

function newTradeNo(): string {
  return `ANX${Date.now().toString(36).toUpperCase()}${randomBytes(5).toString("hex").toUpperCase()}`;
}

async function getUserForUpdate(connection: PoolConnection, userId: number): Promise<UserSubscriptionRow> {
  const [rows] = await connection.execute<UserSubscriptionRow[]>(
    `SELECT id, plan_id, expired_at, transfer_enable, upload_bytes, download_bytes, is_active
       FROM users WHERE id = ? FOR UPDATE`,
    [userId],
  );
  const user = rows[0];
  if (!user) throw notFound("用户不存在");
  if (!user.is_active) throw forbidden("账户已被停用，无法下单");
  return user;
}

export type CreateOrderInput = { planId: number; period: string; couponCode?: string };

type OrderPricing = {
  subtotal: number;
  orderType: number;
  coupon: ResolvedCoupon | null;
  discount: number;
  surplus: number;
  surplusOrderIds: number[];
  payable: number;
  refund: number;
};

/**
 * 计算一笔订单的完整价格链：
 * 周期原价 → 优惠券抵扣 → 升级折抵 → 应付金额与溢出退款。
 *
 * createOrder（用户下单）与 updatePendingOrder（后台改单）共用此函数，
 * 保证「下单时算出的钱」和「后台改单后算出的钱」永远同一套口径，
 * 不会出现后台改单绕过了续费限制、折抵规则之类的偏差。
 */
async function computeOrderPricing(
  connection: PoolConnection,
  user: UserSubscriptionRow,
  plan: ClientPlan,
  period: string,
  couponCode: string,
): Promise<OrderPricing> {
  const now = nowSeconds();
  const currentPlanId = user.plan_id === null ? null : asNumber(user.plan_id);
  const currentExpiresAt = user.expired_at === null ? null : asNumber(user.expired_at);
  const isReset = period === RESET_PERIOD;

  const blocked = purchaseBlockReason({
    isReset,
    targetPlanId: asNumber(plan.id),
    user: { planId: currentPlanId, expiresAt: currentExpiresAt, now },
  });
  if (blocked) throw badRequest(blocked);

  const subtotal = isReset ? await resetTrafficPrice(plan) : planPeriodPriceCents(plan, period);
  if (subtotal === null) throw badRequest("该套餐暂不支持所选付款周期");

  const orderType = resolveOrderType({
    period,
    currentPlanId,
    currentExpiresAt,
    targetPlanId: asNumber(plan.id),
    nowSeconds: now,
  });

  if (orderType === ORDER_TYPE.RENEW && !plan.is_renewable) {
    throw badRequest("该套餐已停止续费，请选择其他套餐");
  }

  const coupon = couponCode.trim()
    ? await resolveCoupon(connection, asNumber(user.id), couponCode, asNumber(plan.id), period, true)
    : null;
  const discount = computeDiscountCents(coupon, subtotal);

  // 多套餐改为排队生效，不再折抵旧套餐剩余价值；surplus / refund 字段仅保留给历史升级单。
  return {
    subtotal,
    orderType,
    coupon,
    discount,
    surplus: 0,
    surplusOrderIds: [],
    payable: Math.max(0, subtotal - discount),
    refund: 0,
  };
}

/** 流量重置价（分）= 套餐月付价 × 后台「流量重置价格比例」。 */
async function resetTrafficPrice(plan: ClientPlan): Promise<number | null> {
  const prices: Record<string, number | null> = {};
  for (const column of planPriceColumns) prices[column] = planPeriodPriceCents(plan, column);
  const monthly = monthlyPriceCents(prices);
  if (monthly === null) return null;
  return resetTrafficPriceCents(monthly, await getNumberSetting("order.reset_traffic_percent"));
}

/** 用户当前套餐的流量重置报价，供仪表盘「重置流量」确认弹窗展示。 */
export async function getResetTrafficQuote(userId: number) {
  const [users] = await getDbPool().execute<RowDataPacket[]>(
    "SELECT plan_id, expired_at FROM users WHERE id = ? LIMIT 1",
    [userId],
  );
  const user = users[0];
  if (!user) throw notFound("用户不存在");
  const planId = user.plan_id === null ? null : asNumber(user.plan_id);
  const blocked = purchaseBlockReason({
    isReset: true,
    targetPlanId: planId ?? 0,
    user: { planId, expiresAt: user.expired_at === null ? null : asNumber(user.expired_at), now: nowSeconds() },
  });
  if (blocked || planId === null) throw badRequest(blocked ?? "需要先拥有生效中的订阅才能购买流量重置");
  const [plans] = await getDbPool().execute<ClientPlan[]>("SELECT * FROM plans WHERE id = ? LIMIT 1", [planId]);
  const plan = plans[0];
  if (!plan) throw notFound("当前套餐不存在");
  const price = await resetTrafficPrice(plan);
  if (price === null) throw badRequest("当前套餐未设置价格，无法购买流量重置");
  return {
    plan_id: planId,
    plan_name: String(plan.name),
    period: RESET_PERIOD,
    price,
    percent: await getNumberSetting("order.reset_traffic_percent"),
  };
}

/** 已付款、排队等待生效的订单（按付款顺序），供仪表盘展示。 */
export async function listQueuedOrders(userId: number) {
  const [rows] = await getDbPool().execute<RowDataPacket[]>(
    `SELECT o.trade_no, o.period, o.paid_at, p.name AS plan_name
       FROM orders o INNER JOIN plans p ON p.id = o.plan_id
      WHERE o.user_id = ? AND o.status = ?
      ORDER BY o.paid_at ASC, o.id ASC`,
    [userId, ORDER_STATUS.PROVISIONING],
  );
  return rows.map((row) => ({
    trade_no: String(row.trade_no),
    plan_name: String(row.plan_name),
    period: String(row.period),
    period_label: PERIOD_LABELS[String(row.period)] ?? String(row.period),
    paid_at: unix(row.paid_at),
  }));
}

export async function createOrder(userId: number, input: CreateOrderInput) {
  if (!Number.isInteger(input.planId) || input.planId < 1) throw badRequest("套餐不存在或暂未开放购买");
  if (!ORDER_PERIODS.includes(input.period)) throw badRequest("付款周期不正确");

  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();

    const user = await getUserForUpdate(connection, userId);
    const plan = await getPlanForOrder(connection, input.planId, input.period);
    if (!plan) throw notFound("套餐不存在或暂未开放购买");

    const [pendingRows] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM orders WHERE user_id = ? AND status = ?`,
      [userId, ORDER_STATUS.PENDING],
    );
    if (asNumber(pendingRows[0]?.total) >= MAX_PENDING_ORDERS) {
      throw conflict(`待支付订单已达 ${MAX_PENDING_ORDERS} 笔，请先完成或取消后再下单`);
    }

    const [duplicates] = await connection.execute<RowDataPacket[]>(
      `SELECT trade_no FROM orders
        WHERE user_id = ? AND plan_id = ? AND period = ? AND status = ?
          AND created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? MINUTE)
        ORDER BY id DESC LIMIT 1`,
      [userId, input.planId, input.period, ORDER_STATUS.PENDING, DUPLICATE_ORDER_WINDOW_MINUTES],
    );
    if (duplicates[0]) {
      throw conflict(`您在 ${DUPLICATE_ORDER_WINDOW_MINUTES} 分钟内已创建过相同订单（${String(duplicates[0].trade_no)}），请先处理该订单`);
    }

    const pricing = await computeOrderPricing(connection, user, plan, input.period, input.couponCode ?? "");
    const tradeNo = newTradeNo();

    const [created] = await connection.execute<ResultSetHeader>(
      `INSERT INTO orders
        (user_id, plan_id, coupon_id, order_type, period, trade_no, total_amount,
         discount_amount, surplus_amount, refund_amount, surplus_order_ids, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId, input.planId, pricing.coupon?.id ?? null, pricing.orderType, input.period, tradeNo, pricing.payable,
        pricing.discount, pricing.surplus, pricing.refund,
        pricing.surplusOrderIds.length ? JSON.stringify(pricing.surplusOrderIds) : null,
        ORDER_STATUS.PENDING,
      ],
    );

    if (pricing.coupon) {
      // 只写 coupon_usages 作为核销事实，不做冗余计数，避免两处数据漂移。
      await connection.execute(
        `INSERT INTO coupon_usages (coupon_id, user_id, order_id, discount_amount) VALUES (?, ?, ?, ?)`,
        [pricing.coupon.id, userId, created.insertId, pricing.discount],
      );
    }

    await connection.commit();
    return tradeNo;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export type UpdatePendingOrderInput = { planId: number; period: string; couponCode: string };

/**
 * 后台修改待支付订单：改套餐 / 周期 / 优惠券，金额按同一套价格链重算。
 *
 * 只允许改待支付订单——已支付订单的金额是对账依据，改动会破坏账实相符。
 * 改单会释放原优惠券占用并按新参数重新核销，避免券被两笔订单同时占住。
 */
export async function updatePendingOrder(orderId: number, input: UpdatePendingOrderInput) {
  if (!Number.isInteger(input.planId) || input.planId < 1) throw badRequest("套餐不存在或暂未开放购买");
  if (!ORDER_PERIODS.includes(input.period)) throw badRequest("付款周期不正确");

  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();

    const [orderRows] = await connection.execute<OrderRow[]>(
      `SELECT * FROM orders WHERE id = ? LIMIT 1 FOR UPDATE`,
      [orderId],
    );
    const order = orderRows[0];
    if (!order) throw notFound("订单不存在");
    if (asNumber(order.status) !== ORDER_STATUS.PENDING) {
      throw conflict("只有待支付订单可以修改，已支付订单的金额是对账依据");
    }

    const userId = asNumber(order.user_id);
    const user = await getUserForUpdate(connection, userId);
    const plan = await getPlanForOrder(connection, input.planId, input.period);
    if (!plan) throw notFound("套餐不存在或暂未开放购买");

    const pricing = await computeOrderPricing(connection, user, plan, input.period, input.couponCode);

    // 先释放原券占用，再按新参数重新核销，避免同一笔订单重复占券。
    if (order.coupon_id !== null) {
      await connection.execute(`DELETE FROM coupon_usages WHERE order_id = ?`, [orderId]);
    }

    await connection.execute(
      `UPDATE orders SET plan_id = ?, period = ?, coupon_id = ?, order_type = ?, total_amount = ?,
         discount_amount = ?, surplus_amount = ?, refund_amount = ?, surplus_order_ids = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = ?`,
      [
        input.planId, input.period, pricing.coupon?.id ?? null, pricing.orderType, pricing.payable,
        pricing.discount, pricing.surplus, pricing.refund,
        pricing.surplusOrderIds.length ? JSON.stringify(pricing.surplusOrderIds) : null,
        orderId, ORDER_STATUS.PENDING,
      ],
    );

    if (pricing.coupon) {
      await connection.execute(
        `INSERT INTO coupon_usages (coupon_id, user_id, order_id, discount_amount) VALUES (?, ?, ?, ?)`,
        [pricing.coupon.id, userId, orderId, pricing.discount],
      );
    }

    await connection.commit();
    return { orderId, payable: pricing.payable, discount: pricing.discount, surplus: pricing.surplus };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** 后台写入订单内部备注（仅后台可见，不进入用户端接口）。 */
export async function updateOrderRemark(orderId: number, remark: string) {
  const trimmed = remark.trim();
  if (trimmed.length > 500) throw badRequest("备注不能超过 500 字");

  const [result] = await getDbPool().execute<ResultSetHeader>(
    `UPDATE orders SET admin_remark = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [trimmed || null, orderId],
  );
  if (result.affectedRows !== 1) throw notFound("订单不存在");
  return true;
}

const orderSelect = `
  SELECT o.*, p.name AS plan_name, p.transfer_enable, p.speed_limit, p.is_renewable
  FROM orders o INNER JOIN plans p ON p.id = o.plan_id`;

export async function getOrder(executor: SqlExecutor, userId: number, tradeNo: string, withLock = false): Promise<OrderRow | null> {
  const [rows] = await executor.execute<OrderRow[]>(
    `${orderSelect} WHERE o.user_id = ? AND o.trade_no = ? LIMIT 1${withLock ? " FOR UPDATE" : ""}`,
    [userId, tradeNo],
  );
  return rows[0] ?? null;
}

export async function listOrders(userId: number, options: { status?: number; page?: number; pageSize?: number } = {}) {
  const { page, pageSize, offset } = normalizePaging(options.page, options.pageSize);
  const conditions = ["o.user_id = ?"];
  const values: Array<number> = [userId];
  if (options.status !== undefined) {
    if (![0, 1, 2, 3, 4, 5].includes(options.status)) throw badRequest("订单状态不正确");
    conditions.push("o.status = ?");
    values.push(options.status);
  }
  const where = conditions.join(" AND ");

  const [rows] = await getDbPool().execute<OrderRow[]>(
    `${orderSelect} WHERE ${where} ORDER BY o.created_at DESC, o.id DESC LIMIT ${pageSize} OFFSET ${offset}`,
    values,
  );
  const [countRows] = await getDbPool().execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM orders o WHERE ${where}`,
    values,
  );
  const total = asNumber(countRows[0]?.total);
  return {
    items: rows.map(serializeOrder),
    total,
    page,
    pageSize,
    hasMore: offset + rows.length < total,
  };
}

export async function getOrderDetail(userId: number, tradeNo: string) {
  const order = await getOrder(getDbPool(), userId, tradeNo);
  if (!order) throw notFound("订单不存在");
  return serializeOrder(order);
}

export async function getOrderStatus(userId: number, tradeNo: string) {
  const order = await getOrder(getDbPool(), userId, tradeNo);
  if (!order) throw notFound("订单不存在");
  return { status: asNumber(order.status), status_label: ORDER_STATUS_LABELS[asNumber(order.status)] ?? "未知" };
}

export async function cancelOrder(userId: number, tradeNo: string) {
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const order = await getOrder(connection, userId, tradeNo, true);
    if (!order) throw notFound("订单不存在");
    if (asNumber(order.status) === ORDER_STATUS.CANCELLED) {
      await connection.commit();
      return true;
    }
    if (asNumber(order.status) === ORDER_STATUS.COMPLETED) throw conflict("订单已支付完成，无法取消");
    if (asNumber(order.status) !== ORDER_STATUS.PENDING) throw conflict("该订单当前不可取消");

    const [updated] = await connection.execute<ResultSetHeader>(
      `UPDATE orders SET status = ?, cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = ?`,
      [ORDER_STATUS.CANCELLED, order.id, ORDER_STATUS.PENDING],
    );
    if (updated.affectedRows !== 1) throw conflict("该订单当前不可取消");
    await closePendingTransactions(connection, asNumber(order.id));

    // 取消后释放优惠券占用，避免用户额度被僵尸订单吃掉。
    // 核销事实只存在 coupon_usages，删除即完成释放。
    if (order.coupon_id !== null) {
      await connection.execute(`DELETE FROM coupon_usages WHERE order_id = ?`, [order.id]);
    }

    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// ---------------------------------------------------------------------------
// 支付（当前仅模拟渠道；对外契约与真实支付保持一致，便于后续替换）
// ---------------------------------------------------------------------------

async function ensureMockPaymentMethod(executor: SqlExecutor): Promise<number> {
  const [existing] = await executor.execute<RowDataPacket[]>(
    `SELECT id FROM payment_methods WHERE provider = 'mock' ORDER BY id ASC LIMIT 1`,
  );
  if (existing[0]) return asNumber(existing[0].id);

  await executor.execute(
    `INSERT INTO payment_methods (uuid, provider, name, config, is_enabled, sort_order)
     VALUES (?, 'mock', '模拟支付', JSON_OBJECT('mode', 'local'), 1, -100)`,
    [randomBytes(16).toString("hex")],
  );
  const [rows] = await executor.execute<RowDataPacket[]>(
    `SELECT id FROM payment_methods WHERE provider = 'mock' ORDER BY id ASC LIMIT 1`,
  );
  if (!rows[0]) throw conflict("无法初始化模拟支付渠道");
  return asNumber(rows[0].id);
}

/** 余额是系统内置钱包渠道：始终零手续费，不能被后台改造成外部网关。 */
async function ensureBalancePaymentMethod(executor: SqlExecutor): Promise<number> {
  const [existing] = await executor.execute<RowDataPacket[]>(
    `SELECT id FROM payment_methods WHERE provider = 'balance' ORDER BY id ASC LIMIT 1`,
  );
  if (existing[0]) {
    const id = asNumber(existing[0].id);
    await executor.execute(
      `UPDATE payment_methods SET name = '余额支付', handling_fee_fixed = 0, handling_fee_percent = 0,
         is_enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id],
    );
    return id;
  }
  await executor.execute(
    `INSERT INTO payment_methods (uuid, provider, name, config, handling_fee_fixed, handling_fee_percent, is_enabled, sort_order)
     VALUES (?, 'balance', '余额支付', JSON_OBJECT('mode', 'wallet'), 0, 0, 1, -110)`,
    [randomBytes(16).toString("hex")],
  );
  const [rows] = await executor.execute<RowDataPacket[]>(
    `SELECT id FROM payment_methods WHERE provider = 'balance' ORDER BY id ASC LIMIT 1`,
  );
  if (!rows[0]) throw conflict("无法初始化余额支付渠道");
  return asNumber(rows[0].id);
}

export async function ensureSystemPaymentMethods() {
  const pool = getDbPool();
  await Promise.all([ensureMockPaymentMethod(pool), ensureBalancePaymentMethod(pool)]);
}

export async function listPaymentMethods() {
  const pool = getDbPool();
  await ensureSystemPaymentMethods();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, provider, name, icon, handling_fee_fixed, handling_fee_percent
       FROM payment_methods
      WHERE is_enabled = 1
      ORDER BY sort_order ASC, id ASC`,
  );
  return rows.filter((row) => isCheckoutProvider(String(row.provider))).map((row) => ({
    id: asNumber(row.id),
    name: String(row.name),
    payment: String(row.provider),
    icon: row.icon ? String(row.icon) : null,
    handling_fee_fixed: asNumber(row.handling_fee_fixed),
    handling_fee_percent: asNumber(row.handling_fee_percent),
  }));
}

/** 已接入收银台的渠道；后台建了但未接入的渠道不展示给用户。 */
function isCheckoutProvider(provider: string): boolean {
  return provider === "balance" || provider === "mock" || epayTypeOf(provider) !== null;
}

function computeHandlingFeeCents(baseCents: number, fixedCents: number, percent: number): number {
  return Math.max(0, Math.round(fixedCents + (baseCents * percent) / 100));
}

/**
 * 发起支付。返回结构对齐真实支付网关：
 * type 0 = 二维码/本地收银台，1 = 跳转链接；data 为收银台地址。
 * 接入真实渠道时只需替换 provider 分支，调用方无需改动。
 */
export async function checkoutOrder(userId: number, tradeNo: string, methodId: number) {
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();

    const order = await getOrder(connection, userId, tradeNo, true);
    if (!order) throw notFound("订单不存在");

    const [methods] = await connection.execute<RowDataPacket[]>(
      `SELECT id, provider, name, handling_fee_fixed, handling_fee_percent, notify_domain
         FROM payment_methods WHERE id = ? AND is_enabled = 1 LIMIT 1`,
      [methodId],
    );
    const method = methods[0];
    if (!method) throw notFound("支付方式不可用");

    const provider = String(method.provider);
    if (asNumber(order.status) !== ORDER_STATUS.PENDING) {
      // 余额支付在同一事务里已经完成；若浏览器在响应丢失后重放请求，安全返回原结果。
      if (asNumber(order.status) === ORDER_STATUS.COMPLETED && provider === "balance" && asNumber(order.payment_method_id) === methodId) {
        const [completed] = await connection.execute<RowDataPacket[]>(
          `SELECT id, amount FROM payment_transactions
            WHERE order_id = ? AND payment_method_id = ? AND status = 'completed'
            ORDER BY id DESC LIMIT 1`,
          [order.id, methodId],
        );
        if (completed[0]) {
          await connection.commit();
          return { type: 0 as const, data: "balance://paid", provider, transaction_id: asNumber(completed[0].id), amount: asNumber(completed[0].amount), completed: true };
        }
      }
      throw conflict("该订单当前不可支付");
    }

    const baseAmount = asNumber(order.total_amount);
    const handlingFee = computeHandlingFeeCents(
      baseAmount,
      asNumber(method.handling_fee_fixed),
      asNumber(method.handling_fee_percent),
    );
    const amount = baseAmount + handlingFee;
    if (provider === "balance") {
      const [users] = await connection.execute<RowDataPacket[]>(
        "SELECT balance, is_active FROM users WHERE id = ? LIMIT 1 FOR UPDATE",
        [userId],
      );
      const user = users[0];
      if (!user) throw notFound("用户不存在");
      if (!user.is_active) throw forbidden("账户已被停用，无法支付");
      const balance = asNumber(user.balance);
      if (balance < baseAmount) throw conflict(`余额不足，当前可用余额为 ${balance} 分`);

      const providerTradeNo = `BAL${randomBytes(10).toString("hex").toUpperCase()}`;
      const [created] = await connection.execute<ResultSetHeader>(
        `INSERT INTO payment_transactions
          (order_id, payment_method_id, provider_trade_no, amount, checkout_type, checkout_data, request_payload, status)
         VALUES (?, ?, ?, ?, 0, 'balance://paid', JSON_OBJECT('provider', 'balance'), 'pending')`,
        [order.id, methodId, providerTradeNo, baseAmount],
      );
      const transactionId = Number(created.insertId);
      await connection.execute(
        `UPDATE orders SET payment_method_id = ?, handling_amount = 0, balance_amount = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = ?`,
        [methodId, baseAmount, order.id, ORDER_STATUS.PENDING],
      );
      await settleOrder(connection, order, userId, "wallet", null, providerTradeNo);
      const nextBalance = balance - baseAmount;
      await connection.execute("UPDATE users SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [nextBalance, userId]);
      if (baseAmount > 0) {
        await connection.execute(
          `INSERT INTO wallet_transactions
            (user_id, wallet_type, transaction_type, amount, balance_after, reference_type, reference_id, description)
           VALUES (?, 'balance', 'order_payment', ?, ?, 'order', ?, '余额支付订单')`,
          [userId, -baseAmount, nextBalance, order.id],
        );
      }
      await connection.execute(
        `UPDATE payment_transactions SET status = 'completed', paid_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [transactionId],
      );
      await connection.execute(
        `INSERT INTO payment_events
          (order_id, transaction_id, provider, provider_event_id, event_type, signature_valid, payload, processing_status, processed_at)
         VALUES (?, ?, 'balance', ?, 'payment.succeeded', 1, JSON_OBJECT('trade_no', ?, 'source', 'wallet'), 'processed', CURRENT_TIMESTAMP)`,
        [order.id, transactionId, `balance-${transactionId}`, tradeNo],
      );
      await connection.commit();
      return { type: 0 as const, data: "balance://paid", provider, transaction_id: transactionId, amount: baseAmount, completed: true };
    }

    const epayType = epayTypeOf(provider);
    if (epayType) {
      const notifyBase = method.notify_domain ? String(method.notify_domain).replace(/\/+$/, "") : "";
      if (!notifyBase) throw unavailable(`支付渠道「${String(method.name)}」未配置回调域名`);
      const key = await getPaymentCallbackSecret(methodId, provider);
      if (!key) throw unavailable(`支付渠道「${String(method.name)}」未配置商户密钥`);
      const { gatewayUrl, pid } = await getEpayConfig();
      // 易支付拒绝重复的商户单号且收银台会过期，所以每次发起都新建交易；
      // 旧交易保持 pending，用户若仍在旧收银台付了款，回调照样能按交易号入账。
      const providerTradeNo = `EP${randomBytes(10).toString("hex").toUpperCase()}`;
      const payUrl = buildEpaySubmitUrl({
        gatewayUrl,
        pid,
        key,
        type: epayType,
        outTradeNo: providerTradeNo,
        amountCents: amount,
        name: `订单 ${tradeNo}`,
        notifyUrl: `${notifyBase}/api/payments/epay/notify`,
        returnUrl: `${notifyBase}/api/payments/epay/return`,
      });
      const [created] = await connection.execute<ResultSetHeader>(
        `INSERT INTO payment_transactions
          (order_id, payment_method_id, provider_trade_no, amount, checkout_type, checkout_data, request_payload, status)
         VALUES (?, ?, ?, ?, 1, ?, JSON_OBJECT('provider', ?, 'type', ?), 'pending')`,
        [order.id, methodId, providerTradeNo, amount, payUrl, provider, epayType],
      );
      await connection.execute(
        `UPDATE orders SET payment_method_id = ?, handling_amount = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = ?`,
        [methodId, handlingFee, order.id, ORDER_STATUS.PENDING],
      );
      await connection.commit();
      return { type: 1 as const, data: payUrl, provider, transaction_id: Number(created.insertId), amount };
    }

    if (provider !== "mock") {
      throw badRequest(`支付渠道「${String(method.name)}」尚未接入，请选择其它支付方式`);
    }

    // 复用同一渠道下未完成的交易，保证重复点击收银台不会产生多条流水。
    const [transactions] = await connection.execute<RowDataPacket[]>(
      `SELECT id, provider_trade_no FROM payment_transactions
        WHERE order_id = ? AND payment_method_id = ? AND status = 'pending'
        ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [order.id, methodId],
    );

    let transactionId = asNumber(transactions[0]?.id);
    if (!transactionId) {
      const providerTradeNo = `MOCK${randomBytes(10).toString("hex").toUpperCase()}`;
      const [created] = await connection.execute<ResultSetHeader>(
        `INSERT INTO payment_transactions
          (order_id, payment_method_id, provider_trade_no, amount, checkout_type, checkout_data, request_payload, status)
         VALUES (?, ?, ?, ?, 0, ?, JSON_OBJECT('provider', 'mock'), 'pending')`,
        [order.id, methodId, providerTradeNo, amount, tradeNo],
      );
      transactionId = Number(created.insertId);
    } else {
      await connection.execute(
        `UPDATE payment_transactions SET amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [amount, transactionId],
      );
    }

    await connection.execute(
      `UPDATE orders SET payment_method_id = ?, handling_amount = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = ?`,
      [methodId, handlingFee, order.id, ORDER_STATUS.PENDING],
    );

    await connection.commit();
    return {
      type: 0 as const,
      data: `mock://checkout/${encodeURIComponent(tradeNo)}`,
      provider,
      transaction_id: transactionId,
      amount,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * 履约：按订单类型写入用户订阅。
 * 与 V2Board OrderService::open 的语义保持一致：
 * - 流量重置：仅清零已用流量；
 * - 一次性：额度覆盖、到期时间置空（永久）；
 * - 周期：额度覆盖为套餐额度，到期时间从当前到期日叠加（升级则从当下重新计算）；
 *   仅「新购」或「原为永久套餐」时清零已用流量。
 */
async function fulfillOrder(connection: PoolConnection, order: OrderRow, userId: number): Promise<void> {
  const user = await getUserForUpdate(connection, userId);
  const period = String(order.period);
  const planId = asNumber(order.plan_id);
  const quotaBytes = gbToBytes(asNumber(order.transfer_enable));

  if (period === RESET_PERIOD) {
    await connection.execute(
      `UPDATE users SET upload_bytes = 0, download_bytes = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [userId],
    );
    return;
  }

  if (period === ONETIME_PERIOD) {
    await connection.execute(
      `UPDATE users SET plan_id = ?, transfer_enable = ?, upload_bytes = 0, download_bytes = 0,
        expired_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [planId, quotaBytes, userId],
    );
    return;
  }

  const months = PERIOD_MONTHS[period];
  if (!months) throw badRequest(`不支持的付款周期：${period}`);

  const now = nowSeconds();
  const orderType = asNumber(order.order_type) || ORDER_TYPE.NEW;
  const currentExpiresAt = user.expired_at === null ? null : asNumber(user.expired_at);
  const wasPermanent = currentExpiresAt === null;

  const base = orderType === ORDER_TYPE.UPGRADE
    ? now
    : Math.max(currentExpiresAt ?? now, now);
  const expiresAt = addMonths(base, months);
  const resetUsage = orderType === ORDER_TYPE.NEW || wasPermanent;

  await connection.execute(
    `UPDATE users SET plan_id = ?, transfer_enable = ?, upload_bytes = ?, download_bytes = ?,
      expired_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [
      planId,
      quotaBytes,
      resetUsage ? 0 : asNumber(user.upload_bytes),
      resetUsage ? 0 : asNumber(user.download_bytes),
      expiresAt,
      userId,
    ],
  );
}

/**
 * 关闭订单下所有未完成的支付流水（订单入账、取消、超时关闭时调用）。
 * 关闭只表示本站不再等待它；渠道若之后仍确认收款，回调会按迟到付款处理，不会丢钱。
 */
export async function closePendingTransactions(connection: PoolConnection, orderId: number): Promise<void> {
  await connection.execute(
    `UPDATE payment_transactions SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE order_id = ? AND status = 'pending'`,
    [orderId],
  );
}

/**
 * 履约来源。
 * gateway = 支付网关回调；admin = 后台人工补单。
 * 两者必须可区分，否则对账时无法判断一笔「已完成」是否真的收到过钱。
 */
export type FulfillmentSource = "gateway" | "admin" | "wallet";

/**
 * 履约核心：把一笔「已确认收款」的待支付订单推进到已完成。
 *
 * 调用方必须已锁定订单行（FOR UPDATE）并处于同一事务中。
 * 网关回调与后台补单共用此函数，保证折抵标记、订阅开通、溢出退款三条副作用
 * 在任何来源下完全一致，避免两条路径各写一份实现后逐渐漂移。
 */
export async function settleOrder(
  connection: PoolConnection,
  order: OrderRow,
  userId: number,
  source: FulfillmentSource,
  adminId: number | null,
  providerTradeNo: string | null,
): Promise<void> {
  // 先锁用户行再判断：生效中买别的套餐要排队，等当前套餐到期后按付款顺序生效。
  const user = await getUserForUpdate(connection, userId);
  const [queued] = await connection.execute<RowDataPacket[]>(
    "SELECT 1 FROM orders WHERE user_id = ? AND status = ? AND id <> ? LIMIT 1",
    [userId, ORDER_STATUS.PROVISIONING, order.id],
  );
  const activation = decideActivation({
    isReset: String(order.period) === RESET_PERIOD,
    targetPlanId: asNumber(order.plan_id),
    user: {
      planId: user.plan_id === null ? null : asNumber(user.plan_id),
      expiresAt: user.expired_at === null ? null : asNumber(user.expired_at),
      now: nowSeconds(),
    },
    hasQueued: queued.length > 0,
  });
  const nextStatus = activation === "queue" ? ORDER_STATUS.PROVISIONING : ORDER_STATUS.COMPLETED;

  // 条件 UPDATE 兼作并发闸门：只有把订单从「待支付」成功推进的那一次才继续履约。
  const [claimed] = await connection.execute<ResultSetHeader>(
    `UPDATE orders SET status = ?, paid_at = CURRENT_TIMESTAMP, completed_at = IF(? = ?, CURRENT_TIMESTAMP, NULL),
       fulfillment_source = ?, fulfilled_by_admin_id = ?, provider_trade_no = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = ?`,
    [nextStatus, nextStatus, ORDER_STATUS.COMPLETED, source, adminId, providerTradeNo, order.id, ORDER_STATUS.PENDING],
  );
  if (claimed.affectedRows !== 1) throw conflict("订单已被处理，请刷新后查看");
  // 同一订单可能发起过多次支付，入账后其余未完成的流水一并关闭；调用方随后把本次流水标记为 completed。
  await closePendingTransactions(connection, asNumber(order.id));

  // 升级时把被折抵的历史订单标记为「已折抵」。
  const surplusOrderIds = jsonNumberList(order.surplus_order_ids);
  if (surplusOrderIds?.length) {
    const placeholders = surplusOrderIds.map(() => "?").join(",");
    await connection.execute(
      `UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id IN (${placeholders}) AND status = ?`,
      [ORDER_STATUS.OFFSET, ...surplusOrderIds, ORDER_STATUS.COMPLETED],
    );
  }

  if (activation === "activate") {
    await fulfillOrder(connection, order, userId);
    // 开通与「要求同步到 3x-ui」同事务提交（outbox），worker 随后下发客户端。
    await markPanelClientDirty(connection, userId);
  } else {
    // 排队的订单：当前套餐若恰好已到期（例如有更早的排队单还没轮到），立即推进队首。
    await activateNextQueuedOrder(connection, userId);
  }

  // 给邀请人记佣金。与履约同一事务：订单完成但佣金没记、或佣金记了但订单没成，都会对不上账。
  // 网关回调与后台补单共用此函数，因此两条来源的返佣行为一致。
  await recordCommissionForOrder(connection, asNumber(order.id), userId, asNumber(order.total_amount));

  // 折抵后溢出的金额退回余额，并留流水。
  const refund = asNumber(order.refund_amount);
  if (refund > 0) {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT balance FROM users WHERE id = ? FOR UPDATE`,
      [userId],
    );
    const nextBalance = asNumber(rows[0]?.balance) + refund;
    await connection.execute(
      `UPDATE users SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [nextBalance, userId],
    );
    await connection.execute(
      `INSERT INTO wallet_transactions
        (user_id, wallet_type, transaction_type, amount, balance_after, reference_type, reference_id, description)
       VALUES (?, 'balance', 'order_surplus_refund', ?, ?, 'order', ?, '套餐升级折抵溢出退款')`,
      [userId, refund, nextBalance, order.id],
    );
  }
}

/**
 * 当前套餐已到期（或没有套餐）时，开通最早付款的一笔待生效订单。
 * 调用方必须在事务中；返回是否开通了订单。按新购语义开通：流量清零，到期时间从现在起算。
 */
async function activateNextQueuedOrder(connection: PoolConnection, userId: number): Promise<boolean> {
  const user = await getUserForUpdate(connection, userId);
  const expiresAt = user.expired_at === null ? null : asNumber(user.expired_at);
  // 永久套餐不会到期；有生效中的套餐时继续排队。
  if (user.plan_id !== null && (expiresAt === null || expiresAt > nowSeconds())) return false;

  const [rows] = await connection.execute<OrderRow[]>(
    `${orderSelect} WHERE o.user_id = ? AND o.status = ? ORDER BY o.paid_at ASC, o.id ASC LIMIT 1 FOR UPDATE`,
    [userId, ORDER_STATUS.PROVISIONING],
  );
  const next = rows[0];
  if (!next) return false;

  const [updated] = await connection.execute<ResultSetHeader>(
    `UPDATE orders SET status = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = ?`,
    [ORDER_STATUS.COMPLETED, next.id, ORDER_STATUS.PROVISIONING],
  );
  if (updated.affectedRows !== 1) return false;
  // 排队单下单时可能被判为「续费」（当时同套餐仍生效），轮到它时上一段已到期，统一按新购开通。
  await fulfillOrder(connection, { ...next, order_type: ORDER_TYPE.NEW } as OrderRow, userId);
  await markPanelClientDirty(connection, userId);
  return true;
}

/**
 * worker 定时任务：为当前套餐已到期、且有待生效订单的用户开通下一个套餐。
 * 每个用户单独一个事务，一轮最多处理 100 个用户，剩下的下一轮继续。
 */
export async function activateQueuedSubscriptions(): Promise<number> {
  const [rows] = await getDbPool().query<RowDataPacket[]>(
    `SELECT DISTINCT o.user_id FROM orders o INNER JOIN users u ON u.id = o.user_id
      WHERE o.status = ? AND (u.plan_id IS NULL OR (u.expired_at IS NOT NULL AND u.expired_at <= UNIX_TIMESTAMP()))
      LIMIT 100`,
    [ORDER_STATUS.PROVISIONING],
  );
  let activated = 0;
  for (const row of rows) {
    const connection = await getDbPool().getConnection();
    try {
      await connection.beginTransaction();
      if (await activateNextQueuedOrder(connection, asNumber(row.user_id))) activated += 1;
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      console.error("[queued-subscription] 开通失败", row.user_id, error);
    } finally {
      connection.release();
    }
  }
  return activated;
}

/**
 * 模拟支付确认。真实渠道接入后，此函数应改为由支付回调触发，
 * 入参从 (userId, tradeNo, transactionId) 换成 (provider, providerTradeNo, payload)。
 */
export async function confirmMockPayment(userId: number, tradeNo: string, transactionId: number) {
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();

    // 锁定订单行，避免并发回调重复履约（重复加时/重复发佣金）。
    const order = await getOrder(connection, userId, tradeNo, true);
    if (!order) throw notFound("订单不存在");

    const status = asNumber(order.status);
    if (status === ORDER_STATUS.COMPLETED || status === ORDER_STATUS.OFFSET) {
      await connection.commit();
      return serializeOrder(order);
    }
    if (status !== ORDER_STATUS.PENDING) throw conflict("该订单当前不能确认支付");

    const [transactions] = await connection.execute<RowDataPacket[]>(
      `SELECT pt.id, pt.provider_trade_no, pm.provider
         FROM payment_transactions pt
         INNER JOIN payment_methods pm ON pm.id = pt.payment_method_id
        WHERE pt.id = ? AND pt.order_id = ? AND pt.status = 'pending'
        LIMIT 1 FOR UPDATE`,
      [transactionId, order.id],
    );
    const transaction = transactions[0];
    if (!transaction || String(transaction.provider) !== "mock") {
      throw notFound("模拟支付交易不存在或已处理");
    }

    await settleOrder(connection, order, userId, "gateway", null, String(transaction.provider_trade_no));

    await connection.execute(
      `UPDATE payment_transactions SET status = 'completed', paid_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [transactionId],
    );
    await connection.execute(
      `INSERT INTO payment_events
        (order_id, transaction_id, provider, provider_event_id, event_type, signature_valid, payload, processing_status, processed_at)
       VALUES (?, ?, 'mock', ?, 'payment.succeeded', 1, JSON_OBJECT('trade_no', ?, 'source', 'customer-panel'), 'processed', CURRENT_TIMESTAMP)`,
      [order.id, transactionId, `mock-${transactionId}`, tradeNo],
    );

    await connection.commit();

    const completed = await getOrder(getDbPool(), userId, tradeNo);
    if (!completed) throw notFound("订单完成后读取失败");
    return serializeOrder(completed);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * 后台人工补单：把待支付订单直接推进为已完成。
 *
 * 适用于线下转账、回调丢失等网关覆盖不到的场景——此前这类订单在后台无任何出路，
 * 只能等用户重下。补单与网关回调的区别必须留痕，否则对账无法区分：
 * 订单写入 fulfillment_source='admin'、操作管理员、补单原因，调用方再补审计日志。
 */
export async function fulfillOrderByAdmin(orderId: number, adminId: number, reason: string) {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw badRequest("请填写补单原因");
  if (trimmedReason.length > 500) throw badRequest("补单原因不能超过 500 字");

  const connection = await getDbPool().getConnection();
  let userId = 0;
  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute<OrderRow[]>(
      `${orderSelect} WHERE o.id = ? LIMIT 1 FOR UPDATE`,
      [orderId],
    );
    const order = rows[0];
    if (!order) throw notFound("订单不存在");

    const status = asNumber(order.status);
    if (status === ORDER_STATUS.COMPLETED || status === ORDER_STATUS.OFFSET) {
      throw conflict("该订单已完成履约，无需重复补单");
    }
    if (status !== ORDER_STATUS.PENDING) {
      throw conflict("只有待支付订单可以补单；已取消订单请先恢复为待支付");
    }

    userId = asNumber(order.user_id);

    // 原因先落库，保证即使后续履约失败也能从订单上看到这次操作的意图。
    await connection.execute(
      `UPDATE orders SET admin_remark = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [trimmedReason, orderId],
    );

    await settleOrder(connection, order, userId, "admin", adminId, null);

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const [done] = await getDbPool().execute<OrderRow[]>(`${orderSelect} WHERE o.id = ? LIMIT 1`, [orderId]);
  return done[0] ? serializeOrder(done[0]) : null;
}

// ---------------------------------------------------------------------------
// 节点 / 公告 / 知识库
// ---------------------------------------------------------------------------

export async function listNodes() {
  const [rows] = await getDbPool().query<RowDataPacket[]>(
    `SELECT id, name, protocol, host, port, server_port, rate, tags, is_visible, is_online, sort_order, last_check_at
       FROM nodes WHERE is_visible = 1 ORDER BY sort_order ASC, id ASC`,
  );
  return rows.map((row) => ({
    id: asNumber(row.id),
    group_id: [],
    name: String(row.name),
    host: String(row.host),
    port: asNumber(row.port),
    server_port: row.server_port === null ? asNumber(row.port) : asNumber(row.server_port),
    tags: jsonList(row.tags) as string[] | null,
    rate: asNumber(row.rate),
    type: String(row.protocol),
    show: row.is_visible ? 1 : 0,
    is_online: row.is_online ? 1 : 0,
    sort: asNumber(row.sort_order),
    last_check_at: unix(row.last_check_at as Date | null),
  }));
}

export async function listNotices() {
  const [rows] = await getDbPool().query<RowDataPacket[]>(
    `SELECT id, title, content, image_url, created_at, updated_at
       FROM notices
      WHERE is_visible = 1 AND (published_at IS NULL OR published_at <= CURRENT_TIMESTAMP)
      ORDER BY COALESCE(published_at, created_at) DESC, id DESC LIMIT 20`,
  );
  return rows.map((row) => ({
    id: asNumber(row.id),
    title: String(row.title),
    content: String(row.content),
    img_url: row.image_url ? String(row.image_url) : null,
    created_at: unix(row.created_at as Date),
    updated_at: unix(row.updated_at as Date),
  }));
}

export async function listKnowledge(category?: string) {
  const params: string[] = [];
  let where = "is_visible = 1";
  if (category) {
    where += " AND category = ?";
    params.push(category);
  }
  const [rows] = await getDbPool().execute<RowDataPacket[]>(
    `SELECT id, category, title, body, updated_at FROM knowledge_articles
      WHERE ${where} ORDER BY category ASC, sort_order ASC, id ASC`,
    params,
  );
  return rows.map((row) => ({
    id: asNumber(row.id),
    category: String(row.category),
    title: String(row.title),
    body: String(row.body),
    updated_at: unix(row.updated_at as Date),
  }));
}

export async function listKnowledgeCategories() {
  const [rows] = await getDbPool().query<RowDataPacket[]>(
    `SELECT DISTINCT category FROM knowledge_articles WHERE is_visible = 1 ORDER BY category ASC`,
  );
  return rows.map((row) => ({ category: String(row.category), list: [] }));
}

// ---------------------------------------------------------------------------
// 工单
// ---------------------------------------------------------------------------

export async function listTickets(userId: number) {
  const [rows] = await getDbPool().execute<RowDataPacket[]>(
    `SELECT id, user_id, subject, level, status, reply_status, created_at, updated_at
       FROM tickets WHERE user_id = ? ORDER BY updated_at DESC, id DESC`,
    [userId],
  );
  return rows.map((row) => ({
    id: asNumber(row.id),
    user_id: asNumber(row.user_id),
    subject: String(row.subject),
    level: asNumber(row.level),
    status: asNumber(row.status),
    reply_status: asNumber(row.reply_status),
    created_at: unix(row.created_at as Date),
    updated_at: unix(row.updated_at as Date),
  }));
}

export async function getTicket(userId: number, ticketId: number) {
  const pool = getDbPool();
  const [tickets] = await pool.execute<RowDataPacket[]>(
    `SELECT id, user_id, subject, level, status, reply_status, created_at, updated_at
       FROM tickets WHERE id = ? AND user_id = ? LIMIT 1`,
    [ticketId, userId],
  );
  const ticket = tickets[0];
  if (!ticket) throw notFound("工单不存在");

  const [messages] = await pool.execute<RowDataPacket[]>(
    `SELECT id, user_id, ticket_id, message, sender_role, created_at, updated_at
       FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC, id ASC`,
    [ticketId],
  );

  // 客服回复以 sender_role = 'staff' 标记，不能靠 user_id 推断，否则管理员回复会被误判为本人消息。
  const [staffRows] = await pool.execute<RowDataPacket[]>(
    `SELECT DISTINCT user_id FROM ticket_messages
      WHERE ticket_id = ? AND sender_role = 'staff' AND user_id IS NOT NULL`,
    [ticketId],
  );
  const staffIds = new Set(staffRows.map((row) => asNumber(row.user_id)));

  return {
    id: asNumber(ticket.id),
    user_id: asNumber(ticket.user_id),
    subject: String(ticket.subject),
    level: asNumber(ticket.level),
    status: asNumber(ticket.status),
    reply_status: asNumber(ticket.reply_status),
    created_at: unix(ticket.created_at as Date),
    updated_at: unix(ticket.updated_at as Date),
    message: messages.map((row) => {
      const senderRole = String(row.sender_role);
      const senderId = row.user_id === null ? null : asNumber(row.user_id);
      return {
        id: asNumber(row.id),
        user_id: senderId ?? 0,
        ticket_id: asNumber(row.ticket_id),
        message: String(row.message),
        sender_role: senderRole,
        is_me: senderRole !== "staff" && senderId === userId,
        created_at: unix(row.created_at as Date),
        updated_at: unix(row.updated_at as Date),
      };
    }),
    staff_ids: [...staffIds],
  };
}

export async function createTicket(userId: number, input: { subject: string; level: number; message: string }) {
  const subject = input.subject.trim().slice(0, 255);
  const message = input.message.trim().slice(0, 10000);
  if (!subject) throw badRequest("请填写工单主题");
  if (!message) throw badRequest("请填写工单内容");
  if (![0, 1, 2].includes(input.level)) throw badRequest("工单优先级不正确");

  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();

    const [openRows] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM tickets WHERE user_id = ? AND status = 0 FOR UPDATE`,
      [userId],
    );
    if (asNumber(openRows[0]?.total) >= MAX_OPEN_TICKETS) {
      throw tooManyRequests(`您有 ${MAX_OPEN_TICKETS} 个未关闭的工单，请先等待处理或关闭后再提交`);
    }

    const [created] = await connection.execute<ResultSetHeader>(
      `INSERT INTO tickets (user_id, subject, level, status, reply_status) VALUES (?, ?, ?, 0, 0)`,
      [userId, subject, input.level],
    );
    await connection.execute(
      `INSERT INTO ticket_messages (ticket_id, user_id, sender_role, message) VALUES (?, ?, 'user', ?)`,
      [created.insertId, userId, message],
    );

    await connection.commit();
    return Number(created.insertId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function replyTicket(userId: number, ticketId: number, message: string) {
  const content = message.trim().slice(0, 10000);
  if (!content) throw badRequest("回复内容不能为空");

  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();

    const [tickets] = await connection.execute<RowDataPacket[]>(
      `SELECT id, status FROM tickets WHERE id = ? AND user_id = ? LIMIT 1 FOR UPDATE`,
      [ticketId, userId],
    );
    const ticket = tickets[0];
    if (!ticket) throw notFound("工单不存在");
    if (asNumber(ticket.status) !== 0) throw conflict("工单已关闭，请新建工单继续沟通");

    await connection.execute(
      `INSERT INTO ticket_messages (ticket_id, user_id, sender_role, message) VALUES (?, ?, 'user', ?)`,
      [ticketId, userId, content],
    );
    // 用户回复后回到「待回复」，并把工单置为处理中。
    await connection.execute(
      `UPDATE tickets SET reply_status = 0, status = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [ticketId],
    );

    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function closeTicket(userId: number, ticketId: number) {
  const [result] = await getDbPool().execute<ResultSetHeader>(
    `UPDATE tickets SET status = 1, closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND status = 0`,
    [ticketId, userId],
  );
  if (result.affectedRows !== 1) {
    const [rows] = await getDbPool().execute<RowDataPacket[]>(
      `SELECT status FROM tickets WHERE id = ? AND user_id = ? LIMIT 1`,
      [ticketId, userId],
    );
    if (!rows[0]) throw notFound("工单不存在");
    throw conflict("工单已关闭");
  }
  return true;
}

// ---------------------------------------------------------------------------
// 邀请 / 佣金
// ---------------------------------------------------------------------------

export async function getInvites(userId: number) {
  // 先把到期的佣金结算掉，否则「待结算」永远挂着、划转时余额还是 0。
  await settleMaturedCommissions(userId);

  const pool = getDbPool();
  const [codesResult, referralsResult, commissionsResult, transferredResult, pendingResult, userResult, referralItemsResult, commissionRate, availableAfterDays] = await Promise.all([
    pool.execute<RowDataPacket[]>(
      `SELECT id, user_id, code, status, page_views, max_uses, used_count, expires_at, created_at, updated_at
         FROM invite_codes WHERE user_id = ? ORDER BY id DESC`,
      [userId],
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM user_referrals WHERE inviter_user_id = ?`,
      [userId],
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(commission_amount), 0) AS total FROM commission_logs
        WHERE inviter_user_id = ? AND status <> 'invalid'`,
      [userId],
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM wallet_transactions
        WHERE user_id = ? AND wallet_type = 'commission' AND transaction_type = 'transfer'`,
      [userId],
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(commission_amount), 0) AS total FROM commission_logs
        WHERE inviter_user_id = ? AND status = 'pending'`,
      [userId],
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT commission_balance FROM users WHERE id = ? LIMIT 1`,
      [userId],
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT r.id, r.invited_user_id, r.created_at, u.email, u.is_active, c.code AS invite_code,
              COALESCE(o.completed_orders, 0) AS completed_orders,
              COALESCE(o.paid_amount, 0) AS paid_amount,
              COALESCE(cl.commission_amount, 0) AS commission_amount
         FROM user_referrals r
         JOIN users u ON u.id = r.invited_user_id
         LEFT JOIN invite_codes c ON c.id = r.invite_code_id
         LEFT JOIN (
           SELECT user_id,
                  COUNT(*) AS completed_orders,
                  COALESCE(SUM(GREATEST(total_amount - refund_amount, 0)), 0) AS paid_amount
             FROM orders
            WHERE status IN (3, 4)
            GROUP BY user_id
         ) o ON o.user_id = r.invited_user_id
         LEFT JOIN (
           SELECT invited_user_id, COALESCE(SUM(commission_amount), 0) AS commission_amount
             FROM commission_logs
            WHERE status <> 'invalid'
            GROUP BY invited_user_id
         ) cl ON cl.invited_user_id = r.invited_user_id
        WHERE r.inviter_user_id = ?
        ORDER BY r.id DESC
        LIMIT 500`,
      [userId],
    ),
    commissionRatePercent(),
    commissionAvailableAfterDays(),
  ]);

  return {
    codes: codesResult[0].map((row) => {
      const expiresAt = unix(row.expires_at as Date | null);
      return {
        id: asNumber(row.id),
        user_id: asNumber(row.user_id),
        code: String(row.code),
        status: asNumber(row.status),
        pv: asNumber(row.page_views),
        max_uses: row.max_uses === null ? null : asNumber(row.max_uses),
        used_count: asNumber(row.used_count),
        expires_at: expiresAt,
        // 过期判定放在服务端，避免前端渲染时调用 Date.now()（不纯函数）而产生水合差异。
        expired: expiresAt !== null && expiresAt * 1000 < Date.now(),
        created_at: unix(row.created_at as Date),
        updated_at: unix(row.updated_at as Date),
      };
    }),
    // [邀请人数, 累计佣金（分）, 已划转（分）, 待结算（分）]
    stat: [
      asNumber(referralsResult[0][0]?.total),
      asNumber(commissionsResult[0][0]?.total),
      Math.abs(asNumber(transferredResult[0][0]?.total)),
      asNumber(pendingResult[0][0]?.total),
    ],
    available_commission: asNumber(userResult[0][0]?.commission_balance),
    commission_rate: commissionRate,
    available_after_days: availableAfterDays,
    referrals: referralItemsResult[0].map((row) => ({
      id: asNumber(row.id),
      user_id: asNumber(row.invited_user_id),
      email: String(row.email),
      is_active: Boolean(row.is_active),
      invite_code: row.invite_code === null ? null : String(row.invite_code),
      completed_orders: asNumber(row.completed_orders),
      paid_amount: asNumber(row.paid_amount),
      commission_amount: asNumber(row.commission_amount),
      created_at: unix(row.created_at as Date),
    })),
  };
}

/**
 * 邀请/佣金明细。对应前台「邀请返佣」页面的流水表格。
 * 只读取当前用户作为邀请人的记录，避免越权查看他人佣金。
 */
export async function getInviteDetails(userId: number, limit = 100) {
  const safeLimit = Math.min(Math.max(Number.isInteger(limit) ? limit : 100, 1), 500);
  const [rows] = await getDbPool().execute<RowDataPacket[]>(
    `SELECT c.id, c.inviter_user_id, c.order_amount, c.commission_amount, c.status, c.created_at,
            u.email AS invitee_email
       FROM commission_logs c
       LEFT JOIN users u ON u.id = c.invited_user_id
      WHERE c.inviter_user_id = ? AND c.status <> 'invalid'
      ORDER BY c.id DESC
      LIMIT ${safeLimit}`,
    [userId],
  );

  return rows.map((row) => ({
    id: asNumber(row.id),
    user_id: asNumber(row.inviter_user_id),
    order_amount: asNumber(row.order_amount),
    get_amount: asNumber(row.commission_amount),
    status: String(row.status ?? "pending"),
    invitee_email: row.invitee_email === null ? null : String(row.invitee_email),
    created_at: unix(row.created_at as Date),
  }));
}

/**
 * 生成邀请码，返回新码本身。
 *
 * 早先这里 `return true`——库里已经写进去了、列表刷新也能看到，所以门户「能用」，
 * 但调用方拿不到刚生成的码，只能再多查一次 invites 才知道是哪条。
 * 返回码本身后调用方可直接使用（例如立刻拼推广链接），不必再回查。
 */
export async function createInviteCode(
  userId: number,
  options: { maxUses?: number | null; expiresInDays?: number | null } = {},
): Promise<string> {
  const maxUses = options.maxUses ?? null;
  const expiresInDays = options.expiresInDays ?? null;
  if (maxUses !== null && (!Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > 10000)) {
    throw badRequest("邀请码使用次数需为 1 至 10000");
  }
  if (expiresInDays !== null && (!Number.isSafeInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365)) {
    throw badRequest("邀请码有效期需为 1 至 365 天");
  }

  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM invite_codes
        WHERE user_id = ? AND status = 0
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
          AND (max_uses IS NULL OR used_count < max_uses)
        FOR UPDATE`,
      [userId],
    );
    if (asNumber(rows[0]?.total) >= 5) {
      throw conflict("最多同时保留 5 个可用的邀请码，请先停用不用的邀请码");
    }
    const code = randomBytes(16).toString("hex");
    const expiresAt = expiresInDays === null ? null : new Date(Date.now() + expiresInDays * 86400000);
    await connection.execute(
      `INSERT INTO invite_codes (user_id, code, max_uses, expires_at) VALUES (?, ?, ?, ?)`,
      [userId, code, maxUses, expiresAt],
    );
    await connection.commit();
    return code;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function updateInviteCodeStatus(userId: number, inviteId: number, status: 0 | 1): Promise<boolean> {
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, status, max_uses, used_count, expires_at
         FROM invite_codes WHERE id = ? AND user_id = ? LIMIT 1 FOR UPDATE`,
      [inviteId, userId],
    );
    const invite = rows[0];
    if (!invite) throw notFound("邀请码不存在");

    if (status === 0) {
      if (invite.expires_at && new Date(invite.expires_at as Date).getTime() <= Date.now()) {
        throw conflict("已过期的邀请码不能重新启用");
      }
      if (invite.max_uses !== null && asNumber(invite.used_count) >= asNumber(invite.max_uses)) {
        throw conflict("已达到使用上限的邀请码不能重新启用");
      }
      const [activeRows] = await connection.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM invite_codes
          WHERE user_id = ? AND id <> ? AND status = 0
            AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
            AND (max_uses IS NULL OR used_count < max_uses)
          FOR UPDATE`,
        [userId, inviteId],
      );
      if (asNumber(activeRows[0]?.total) >= 5) {
        throw conflict("最多同时保留 5 个可用的邀请码，请先停用不用的邀请码");
      }
    }

    await connection.execute(
      `UPDATE invite_codes SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`,
      [status, inviteId, userId],
    );
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function inspectInviteCode(code: string, recordVisit = false) {
  const normalized = code.trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(normalized)) {
    return { valid: false, code: "", message: "邀请链接无效或已失效" };
  }

  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, code, status, max_uses, used_count, expires_at
         FROM invite_codes WHERE code = ? LIMIT 1 FOR UPDATE`,
      [normalized],
    );
    const invite = rows[0];
    const valid = Boolean(
      invite
      && asNumber(invite.status) === 0
      && (!invite.expires_at || new Date(invite.expires_at as Date).getTime() > Date.now())
      && (invite.max_uses === null || asNumber(invite.used_count) < asNumber(invite.max_uses)),
    );
    if (valid && recordVisit) {
      await connection.execute(
        `UPDATE invite_codes SET page_views = page_views + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [invite.id],
      );
    }
    await connection.commit();
    return valid
      ? { valid: true, code: String(invite.code), message: "邀请码有效" }
      : { valid: false, code: "", message: "邀请链接无效或已失效" };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function transferCommission(userId: number, amount: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw badRequest("划转金额不正确");

  // 先结算到期佣金：不结算的话 commission_balance 恒为 0，划转必然报「佣金余额不足」。
  await settleMaturedCommissions(userId);

  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [users] = await connection.execute<RowDataPacket[]>(
      `SELECT balance, commission_balance FROM users WHERE id = ? FOR UPDATE`,
      [userId],
    );
    const user = users[0];
    if (!user) throw notFound("用户不存在");

    const commissionBalance = asNumber(user.commission_balance);
    if (commissionBalance < amount) throw badRequest("佣金余额不足");

    const nextBalance = asNumber(user.balance) + amount;
    const nextCommission = commissionBalance - amount;

    await connection.execute(
      `UPDATE users SET balance = ?, commission_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [nextBalance, nextCommission, userId],
    );
    await connection.execute(
      `INSERT INTO wallet_transactions (user_id, wallet_type, transaction_type, amount, balance_after, description)
       VALUES (?, 'commission', 'transfer', ?, ?, '佣金划转至余额')`,
      [userId, -amount, nextCommission],
    );
    await connection.execute(
      `INSERT INTO wallet_transactions (user_id, wallet_type, transaction_type, amount, balance_after, description)
       VALUES (?, 'balance', 'commission_transfer', ?, ?, '佣金划转入账')`,
      [userId, amount, nextBalance],
    );

    await connection.commit();
    return { balance: nextBalance, commission_balance: nextCommission };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// ---------------------------------------------------------------------------
// 流量 / 统计
// ---------------------------------------------------------------------------

export async function listTraffic(userId: number, days = 30) {
  const safeDays = Number.isInteger(days) && days > 0 && days <= 365 ? days : 30;
  const [rows] = await getDbPool().execute<RowDataPacket[]>(
    `SELECT record_at, COALESCE(SUM(upload_bytes), 0) AS u, COALESCE(SUM(download_bytes), 0) AS d
       FROM user_traffic_records WHERE user_id = ?
      GROUP BY record_at ORDER BY record_at DESC LIMIT ${safeDays}`,
    [userId],
  );
  return rows.map((row) => ({
    record_at: unix(row.record_at as Date) ?? 0,
    u: asNumber(row.u),
    d: asNumber(row.d),
  }));
}

export async function getUserStats(userId: number) {
  const pool = getDbPool();
  const [orders, tickets, referrals] = await Promise.all([
    pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM orders WHERE user_id = ? AND status = ?`,
      [userId, ORDER_STATUS.PENDING],
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM tickets WHERE user_id = ? AND status = 0`,
      [userId],
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM user_referrals WHERE inviter_user_id = ?`,
      [userId],
    ),
  ]);
  return {
    unpaid_orders: asNumber(orders[0][0]?.total),
    open_tickets: asNumber(tickets[0][0]?.total),
    referrals: asNumber(referrals[0][0]?.total),
  };
}

/** 后台/统计口径：已实际收款的订单状态集合。 */
export { SETTLED_ORDER_STATUSES };
