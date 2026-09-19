import "server-only";

import { randomBytes } from "node:crypto";
import type { Pool, PoolConnection } from "mysql2/promise";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getDbPool } from "./db";

type SqlExecutor = Pool | PoolConnection;

export type ClientPlan = RowDataPacket & {
  id: number; group_id: number | null; transfer_enable: number | string; name: string; speed_limit: number | null;
  is_visible: number; is_renewable: number; sort_order: number; content: string | null;
  month_price: number | string | null; quarter_price: number | string | null; half_year_price: number | string | null;
  year_price: number | string | null; two_year_price: number | string | null; three_year_price: number | string | null;
  onetime_price: number | string | null; reset_price: number | string | null; created_at: Date; updated_at: Date;
};

type OrderRow = RowDataPacket & {
  id: number; user_id: number; plan_id: number; payment_method_id: number | null; period: string; trade_no: string;
  total_amount: number | string; handling_amount: number | string; discount_amount: number | string; status: number;
  paid_at: Date | null; created_at: Date; updated_at: Date; plan_name: string; transfer_enable: number | string;
  speed_limit: number | null; is_renewable: number;
};

type CouponRow = RowDataPacket & { id: number; code: string; name: string; discount_type: number; discount_value: number | string; max_uses: number | null; max_uses_per_user: number | null; plan_ids: string | null; periods: string | null; used_count: number; };

const periodDays: Record<string, number> = {
  month_price: 31, quarter_price: 92, half_year_price: 183, year_price: 366, two_year_price: 731, three_year_price: 1096,
};
const orderPeriods = new Set([...Object.keys(periodDays), "onetime_price", "reset_price"]);
const orderPriceColumn: Record<string, keyof ClientPlan> = {
  month_price: "month_price", quarter_price: "quarter_price", half_year_price: "half_year_price", year_price: "year_price",
  two_year_price: "two_year_price", three_year_price: "three_year_price", onetime_price: "onetime_price", reset_price: "reset_price",
};

function asNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function unix(value: Date | null | undefined): number | null {
  return value ? Math.floor(new Date(value).getTime() / 1000) : null;
}

function jsonList(value: string | null): number[] | string[] | null {
  if (!value) return null;
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed : null; } catch { return null; }
}

function serializePlan(row: ClientPlan) {
  return {
    id: asNumber(row.id), group_id: row.group_id === null ? 0 : asNumber(row.group_id), transfer_enable: asNumber(row.transfer_enable),
    name: row.name, speed_limit: row.speed_limit === null ? null : asNumber(row.speed_limit), show: row.is_visible ? 1 : 0,
    sort: asNumber(row.sort_order), renew: row.is_renewable ? 1 : 0, content: row.content,
    month_price: row.month_price === null ? null : asNumber(row.month_price), quarter_price: row.quarter_price === null ? null : asNumber(row.quarter_price),
    half_year_price: row.half_year_price === null ? null : asNumber(row.half_year_price), year_price: row.year_price === null ? null : asNumber(row.year_price),
    two_year_price: row.two_year_price === null ? null : asNumber(row.two_year_price), three_year_price: row.three_year_price === null ? null : asNumber(row.three_year_price),
    onetime_price: row.onetime_price === null ? null : asNumber(row.onetime_price), reset_price: row.reset_price === null ? null : asNumber(row.reset_price),
    created_at: unix(row.created_at), updated_at: unix(row.updated_at),
  };
}

function serializeOrder(row: OrderRow) {
  return {
    id: asNumber(row.id), user_id: asNumber(row.user_id), plan_id: asNumber(row.plan_id), payment_id: row.payment_method_id === null ? null : asNumber(row.payment_method_id),
    type: 1, period: row.period, trade_no: row.trade_no, total_amount: asNumber(row.total_amount), handling_amount: asNumber(row.handling_amount),
    discount_amount: asNumber(row.discount_amount), status: asNumber(row.status), paid_at: unix(row.paid_at), created_at: unix(row.created_at), updated_at: unix(row.updated_at),
    plan: { id: asNumber(row.plan_id), name: row.plan_name, transfer_enable: asNumber(row.transfer_enable), speed_limit: row.speed_limit, renew: row.is_renewable ? 1 : 0 },
  };
}

async function getVisiblePlan(executor: SqlExecutor, planId: number): Promise<ClientPlan | null> {
  const [rows] = await executor.execute<ClientPlan[]>(`SELECT * FROM plans WHERE id = ? AND is_visible = 1 LIMIT 1`, [planId]);
  return rows[0] ?? null;
}

async function getOrder(executor: SqlExecutor, userId: number, tradeNo: string): Promise<OrderRow | null> {
  const [rows] = await executor.execute<OrderRow[]>(`
    SELECT o.*, p.name AS plan_name, p.transfer_enable, p.speed_limit, p.is_renewable
    FROM orders o INNER JOIN plans p ON p.id = o.plan_id
    WHERE o.user_id = ? AND o.trade_no = ? LIMIT 1`, [userId, tradeNo]);
  return rows[0] ?? null;
}

function newTradeNo(): string {
  return `ANX${Date.now().toString(36).toUpperCase()}${randomBytes(5).toString("hex").toUpperCase()}`;
}

export async function listPlans() {
  const [rows] = await getDbPool().query<ClientPlan[]>(`SELECT * FROM plans WHERE is_visible = 1 ORDER BY sort_order ASC, id ASC`);
  return rows.map(serializePlan);
}

async function verifyCouponWithExecutor(executor: SqlExecutor, userId: number, code: string, planId: number, period?: string) {
  const normalized = code.trim().toUpperCase();
  if (!normalized) throw new Error("请输入优惠码");
  const [rows] = await executor.execute<CouponRow[]>(`
    SELECT * FROM coupons WHERE code = ? AND is_active = 1 AND (starts_at IS NULL OR starts_at <= CURRENT_TIMESTAMP) AND (ends_at IS NULL OR ends_at >= CURRENT_TIMESTAMP) LIMIT 1`, [normalized]);
  const coupon = rows[0];
  if (!coupon || (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses)) throw new Error("优惠券无效或已用完");
  const planIds = jsonList(coupon.plan_ids) as number[] | null;
  const periods = jsonList(coupon.periods) as string[] | null;
  if (planIds && !planIds.map(Number).includes(planId)) throw new Error("该优惠券不适用于此套餐");
  if (period && periods && !periods.includes(period)) throw new Error("该优惠券不适用于此周期");
  const [usageRows] = await executor.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM coupon_usages WHERE coupon_id = ? AND user_id = ?`, [coupon.id, userId]);
  if (coupon.max_uses_per_user !== null && asNumber(usageRows[0]?.total) >= coupon.max_uses_per_user) throw new Error("该优惠券已达到您的使用次数上限");
  return { id: coupon.id, code: coupon.code, name: coupon.name, type: coupon.discount_type === 2 ? 2 : 1, value: asNumber(coupon.discount_value) };
}

export async function verifyCoupon(userId: number, code: string, planId: number, period?: string) {
  return verifyCouponWithExecutor(getDbPool(), userId, code, planId, period);
}

export async function createOrder(userId: number, input: { planId: number; period: string; couponCode?: string }) {
  if (!Number.isInteger(input.planId) || !orderPeriods.has(input.period)) throw new Error("套餐或付款周期不正确");
  const pool = getDbPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const plan = await getVisiblePlan(connection, input.planId);
    if (!plan) throw new Error("套餐不存在或暂未开放购买");
    const price = plan[orderPriceColumn[input.period]];
    if (price === null || price === undefined || asNumber(price) < 0) throw new Error("该套餐暂不支持所选周期");
    let coupon: { id: number; type: number; value: number } | null = null;
    if (input.couponCode) coupon = await verifyCouponWithExecutor(connection, userId, input.couponCode, input.planId, input.period);
    const subtotal = asNumber(price);
    const discount = coupon ? Math.min(subtotal, coupon.type === 2 ? Math.floor(subtotal * coupon.value / 100) : coupon.value) : 0;
    const tradeNo = newTradeNo();
    const [result] = await connection.execute<ResultSetHeader>(`
      INSERT INTO orders (user_id, plan_id, coupon_id, period, trade_no, total_amount, discount_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [userId, input.planId, coupon?.id ?? null, input.period, tradeNo, subtotal - discount, discount]);
    if (coupon) {
      await connection.execute(`INSERT INTO coupon_usages (coupon_id, user_id, order_id, discount_amount) VALUES (?, ?, ?, ?)`, [coupon.id, userId, result.insertId, discount]);
      await connection.execute(`UPDATE coupons SET used_count = used_count + 1 WHERE id = ?`, [coupon.id]);
    }
    await connection.commit();
    return tradeNo;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

export async function listOrders(userId: number, status?: number) {
  const conditions = ["o.user_id = ?"];
  const values: number[] = [userId];
  if (status !== undefined) { conditions.push("o.status = ?"); values.push(status); }
  const [rows] = await getDbPool().execute<OrderRow[]>(`
    SELECT o.*, p.name AS plan_name, p.transfer_enable, p.speed_limit, p.is_renewable
    FROM orders o INNER JOIN plans p ON p.id = o.plan_id WHERE ${conditions.join(" AND ")}
    ORDER BY o.created_at DESC, o.id DESC`, values);
  return rows.map(serializeOrder);
}

export async function getOrderDetail(userId: number, tradeNo: string) {
  const order = await getOrder(getDbPool(), userId, tradeNo);
  if (!order) throw new Error("订单不存在");
  return serializeOrder(order);
}

async function ensureMockPaymentMethod() {
  const pool = getDbPool();
  const [existing] = await pool.execute<RowDataPacket[]>(`SELECT id FROM payment_methods WHERE provider = 'mock' ORDER BY id ASC LIMIT 1`);
  if (existing[0]) return asNumber(existing[0].id);
  try {
    await pool.execute(`INSERT INTO payment_methods (uuid, provider, name, config, is_enabled, sort_order) VALUES (?, 'mock', '模拟支付', JSON_OBJECT('mode', 'local'), 1, -100)`, [randomBytes(16).toString("hex")]);
  } catch { /* another request may have provisioned it */ }
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT id FROM payment_methods WHERE provider = 'mock' ORDER BY id ASC LIMIT 1`);
  if (!rows[0]) throw new Error("无法初始化模拟支付渠道");
  return asNumber(rows[0].id);
}

export async function listPaymentMethods() {
  await ensureMockPaymentMethod();
  const [rows] = await getDbPool().query<RowDataPacket[]>(`SELECT id, provider, name, icon, handling_fee_fixed, handling_fee_percent FROM payment_methods WHERE is_enabled = 1 ORDER BY sort_order ASC, id ASC`);
  return rows.map((row) => ({ id: asNumber(row.id), name: String(row.name), payment: String(row.provider), icon: row.icon ? String(row.icon) : null, handling_fee_fixed: asNumber(row.handling_fee_fixed), handling_fee_percent: asNumber(row.handling_fee_percent) }));
}

export async function checkoutOrder(userId: number, tradeNo: string, methodId: number) {
  const pool = getDbPool();
  const order = await getOrder(pool, userId, tradeNo);
  if (!order) throw new Error("订单不存在");
  if (order.status !== 0) throw new Error("该订单当前不可支付");
  const [methods] = await pool.execute<RowDataPacket[]>(`SELECT id, provider, name, handling_fee_fixed, handling_fee_percent FROM payment_methods WHERE id = ? AND is_enabled = 1 LIMIT 1`, [methodId]);
  const method = methods[0];
  if (!method) throw new Error("支付方式不可用");
  const amount = asNumber(order.total_amount) + asNumber(method.handling_fee_fixed) + Math.round(asNumber(order.total_amount) * asNumber(method.handling_fee_percent) / 100);
  const provider = String(method.provider);
  if (provider !== "mock") throw new Error("该支付方式尚未接入，请选择模拟支付");
  const [transactions] = await pool.execute<RowDataPacket[]>(`SELECT id FROM payment_transactions WHERE order_id = ? AND payment_method_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`, [order.id, methodId]);
  let transactionId = asNumber(transactions[0]?.id);
  if (!transactionId) {
    const providerTradeNo = `MOCK${randomBytes(10).toString("hex").toUpperCase()}`;
    const [created] = await pool.execute<ResultSetHeader>(`INSERT INTO payment_transactions (order_id, payment_method_id, provider_trade_no, amount, checkout_type, checkout_data, request_payload) VALUES (?, ?, ?, ?, 0, ?, JSON_OBJECT('provider', 'mock'))`, [order.id, methodId, providerTradeNo, amount, tradeNo]);
    transactionId = Number(created.insertId);
  }
  await pool.execute(`UPDATE orders SET payment_method_id = ?, handling_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 0`, [methodId, amount - asNumber(order.total_amount), order.id]);
  return { type: 0 as const, data: `mock://checkout/${encodeURIComponent(tradeNo)}`, provider: "mock", transaction_id: transactionId, amount };
}

export async function confirmMockPayment(userId: number, tradeNo: string, transactionId: number) {
  const pool = getDbPool(); const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const order = await getOrder(connection, userId, tradeNo);
    if (!order) throw new Error("订单不存在");
    if (order.status === 3 || order.status === 4) { await connection.commit(); return serializeOrder(order); }
    if (order.status !== 0) throw new Error("该订单当前不能确认支付");
    const [transactions] = await connection.execute<RowDataPacket[]>(`SELECT pt.id, pm.provider FROM payment_transactions pt INNER JOIN payment_methods pm ON pm.id = pt.payment_method_id WHERE pt.id = ? AND pt.order_id = ? AND pt.status = 'pending' LIMIT 1 FOR UPDATE`, [transactionId, order.id]);
    if (!transactions[0] || transactions[0].provider !== "mock") throw new Error("模拟支付交易不存在或已处理");
    const now = new Date();
    const days = periodDays[order.period];
    const [users] = await connection.execute<RowDataPacket[]>(`SELECT expired_at FROM users WHERE id = ? FOR UPDATE`, [userId]);
    const currentExpiry = asNumber(users[0]?.expired_at);
    const start = currentExpiry > Math.floor(now.getTime() / 1000) ? new Date(currentExpiry * 1000) : now;
    const expiresAt = days ? Math.floor((start.getTime() + days * 86400_000) / 1000) : null;
    await connection.execute(`UPDATE payment_transactions SET status = 'completed', paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [transactionId]);
    await connection.execute(`INSERT INTO payment_events (order_id, transaction_id, provider, provider_event_id, event_type, signature_valid, payload, processing_status, processed_at) VALUES (?, ?, 'mock', ?, 'payment.succeeded', 1, JSON_OBJECT('trade_no', ?, 'source', 'customer-panel'), 'processed', CURRENT_TIMESTAMP)`, [order.id, transactionId, `mock-${transactionId}`, tradeNo]);
    await connection.execute(`UPDATE orders SET status = 3, paid_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP, provider_trade_no = (SELECT provider_trade_no FROM payment_transactions WHERE id = ?), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 0`, [transactionId, order.id]);
    await connection.execute(`UPDATE users SET plan_id = ?, transfer_enable = ?, upload_bytes = 0, download_bytes = 0, expired_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [order.plan_id, order.transfer_enable, expiresAt, userId]);
    await connection.commit();
    const completed = await getOrder(pool, userId, tradeNo);
    if (!completed) throw new Error("订单完成后读取失败");
    return serializeOrder(completed);
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

export async function cancelOrder(userId: number, tradeNo: string) {
  const [result] = await getDbPool().execute<ResultSetHeader>(`UPDATE orders SET status = 2, cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND trade_no = ? AND status = 0`, [userId, tradeNo]);
  if (result.affectedRows !== 1) throw new Error("订单不存在或当前不可取消");
  return true;
}

export async function getOrderStatus(userId: number, tradeNo: string) {
  const order = await getOrder(getDbPool(), userId, tradeNo);
  if (!order) throw new Error("订单不存在");
  return asNumber(order.status);
}

export async function listNodes() {
  const [rows] = await getDbPool().query<RowDataPacket[]>(`SELECT id, name, protocol, host, port, server_port, rate, tags, is_visible, is_online, sort_order, last_check_at FROM nodes WHERE is_visible = 1 ORDER BY sort_order ASC, id ASC`);
  return rows.map((row) => ({ id: asNumber(row.id), group_id: [], name: String(row.name), host: String(row.host), port: asNumber(row.port), server_port: row.server_port === null ? asNumber(row.port) : asNumber(row.server_port), tags: jsonList(row.tags ? String(row.tags) : null) as string[] | null, rate: asNumber(row.rate), type: String(row.protocol), show: row.is_visible ? 1 : 0, is_online: row.is_online ? 1 : 0, sort: asNumber(row.sort_order), last_check_at: unix(row.last_check_at as Date | null) }));
}

export async function listNotices() {
  const [rows] = await getDbPool().query<RowDataPacket[]>(`SELECT id, title, content, image_url, created_at, updated_at FROM notices WHERE is_visible = 1 AND (published_at IS NULL OR published_at <= CURRENT_TIMESTAMP) ORDER BY COALESCE(published_at, created_at) DESC, id DESC LIMIT 20`);
  return rows.map((row) => ({ id: asNumber(row.id), title: String(row.title), content: String(row.content), img_url: row.image_url ? String(row.image_url) : null, created_at: unix(row.created_at as Date), updated_at: unix(row.updated_at as Date) }));
}

export async function listKnowledge(category?: string) {
  const params: string[] = [];
  let where = "is_visible = 1";
  if (category) { where += " AND category = ?"; params.push(category); }
  const [rows] = await getDbPool().execute<RowDataPacket[]>(`SELECT id, category, title, body, updated_at FROM knowledge_articles WHERE ${where} ORDER BY category ASC, sort_order ASC, id ASC`, params);
  return rows.map((row) => ({ id: asNumber(row.id), category: String(row.category), title: String(row.title), body: String(row.body), updated_at: unix(row.updated_at as Date) }));
}

export async function listKnowledgeCategories() {
  const [rows] = await getDbPool().query<RowDataPacket[]>(`SELECT DISTINCT category FROM knowledge_articles WHERE is_visible = 1 ORDER BY category ASC`);
  return rows.map((row) => ({ category: String(row.category), list: [] }));
}

export async function listTickets(userId: number) {
  const [rows] = await getDbPool().execute<RowDataPacket[]>(`SELECT id, user_id, subject, level, status, reply_status, created_at, updated_at FROM tickets WHERE user_id = ? ORDER BY updated_at DESC, id DESC`, [userId]);
  return rows.map((row) => ({ id: asNumber(row.id), user_id: asNumber(row.user_id), subject: String(row.subject), level: asNumber(row.level), status: asNumber(row.status), reply_status: asNumber(row.reply_status), created_at: unix(row.created_at as Date), updated_at: unix(row.updated_at as Date) }));
}

export async function getTicket(userId: number, ticketId: number) {
  const [tickets] = await getDbPool().execute<RowDataPacket[]>(`SELECT id, user_id, subject, level, status, reply_status, created_at, updated_at FROM tickets WHERE id = ? AND user_id = ? LIMIT 1`, [ticketId, userId]);
  const ticket = tickets[0]; if (!ticket) throw new Error("工单不存在");
  const [messages] = await getDbPool().execute<RowDataPacket[]>(`SELECT id, user_id, ticket_id, message, sender_role, created_at, updated_at FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC, id ASC`, [ticketId]);
  return { id: asNumber(ticket.id), user_id: asNumber(ticket.user_id), subject: String(ticket.subject), level: asNumber(ticket.level), status: asNumber(ticket.status), reply_status: asNumber(ticket.reply_status), created_at: unix(ticket.created_at as Date), updated_at: unix(ticket.updated_at as Date), message: messages.map((row) => ({ id: asNumber(row.id), user_id: row.user_id === null ? 0 : asNumber(row.user_id), ticket_id: asNumber(row.ticket_id), message: String(row.message), created_at: unix(row.created_at as Date), updated_at: unix(row.updated_at as Date), is_me: String(row.sender_role) === "user" })) };
}

export async function createTicket(userId: number, input: { subject: string; level: number; message: string }) {
  const subject = input.subject.trim().slice(0, 255); const message = input.message.trim();
  if (!subject || !message || ![0, 1, 2].includes(input.level)) throw new Error("请填写完整的工单信息");
  const connection = await getDbPool().getConnection();
  try { await connection.beginTransaction(); const [result] = await connection.execute<ResultSetHeader>(`INSERT INTO tickets (user_id, subject, level) VALUES (?, ?, ?)`, [userId, subject, input.level]); await connection.execute(`INSERT INTO ticket_messages (ticket_id, user_id, sender_role, message) VALUES (?, ?, 'user', ?)`, [result.insertId, userId, message]); await connection.commit(); return true; } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

export async function replyTicket(userId: number, ticketId: number, message: string) {
  const content = message.trim(); if (!content) throw new Error("回复内容不能为空");
  const [result] = await getDbPool().execute<ResultSetHeader>(`INSERT INTO ticket_messages (ticket_id, user_id, sender_role, message) SELECT id, ?, 'user', ? FROM tickets WHERE id = ? AND user_id = ? AND status = 0`, [userId, content, ticketId, userId]);
  if (result.affectedRows !== 1) throw new Error("工单不存在或已关闭");
  await getDbPool().execute(`UPDATE tickets SET reply_status = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`, [ticketId, userId]); return true;
}

export async function closeTicket(userId: number, ticketId: number) {
  const [result] = await getDbPool().execute<ResultSetHeader>(`UPDATE tickets SET status = 1, closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND status = 0`, [ticketId, userId]);
  if (result.affectedRows !== 1) throw new Error("工单不存在或已关闭"); return true;
}

export async function getInvites(userId: number) {
  const pool = getDbPool();
  const [codesResult, referralsResult, commissionsResult, transfersResult] = await Promise.all([
    pool.execute<RowDataPacket[]>(`SELECT id, user_id, code, status, page_views, created_at, updated_at FROM invite_codes WHERE user_id = ? ORDER BY id DESC`, [userId]),
    pool.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM user_referrals WHERE inviter_user_id = ?`, [userId]),
    pool.execute<RowDataPacket[]>(`SELECT COALESCE(SUM(commission_amount), 0) AS total FROM commission_logs WHERE inviter_user_id = ?`, [userId]),
    pool.execute<RowDataPacket[]>(`SELECT COALESCE(SUM(amount), 0) AS total FROM wallet_transactions WHERE user_id = ? AND wallet_type = 'commission' AND transaction_type = 'transfer'`, [userId]),
  ]);
  return { codes: codesResult[0].map((row) => ({ id: asNumber(row.id), user_id: asNumber(row.user_id), code: String(row.code), status: asNumber(row.status), pv: asNumber(row.page_views), created_at: unix(row.created_at as Date), updated_at: unix(row.updated_at as Date) })), stat: [asNumber(referralsResult[0][0]?.total), asNumber(commissionsResult[0][0]?.total), Math.abs(asNumber(transfersResult[0][0]?.total))] };
}

export async function createInviteCode(userId: number) {
  const code = randomBytes(16).toString("hex"); await getDbPool().execute(`INSERT INTO invite_codes (user_id, code) VALUES (?, ?)`, [userId, code]); return true;
}

export async function transferCommission(userId: number, amount: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("划转金额不正确");
  const connection = await getDbPool().getConnection();
  try { await connection.beginTransaction(); const [users] = await connection.execute<RowDataPacket[]>(`SELECT balance, commission_balance FROM users WHERE id = ? FOR UPDATE`, [userId]); const user = users[0]; if (!user || asNumber(user.commission_balance) < amount) throw new Error("佣金余额不足"); const nextBalance = asNumber(user.balance) + amount; await connection.execute(`UPDATE users SET balance = ?, commission_balance = commission_balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [nextBalance, amount, userId]); await connection.execute(`INSERT INTO wallet_transactions (user_id, wallet_type, transaction_type, amount, balance_after, description) VALUES (?, 'commission', 'transfer', ?, ?, '佣金划转至余额')`, [userId, -amount, asNumber(user.commission_balance) - amount]); await connection.execute(`INSERT INTO wallet_transactions (user_id, wallet_type, transaction_type, amount, balance_after, description) VALUES (?, 'balance', 'commission_transfer', ?, ?, '佣金划转入账')`, [userId, amount, nextBalance]); await connection.commit(); return true; } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

export async function listTraffic(userId: number) {
  const [rows] = await getDbPool().execute<RowDataPacket[]>(`SELECT record_at, COALESCE(SUM(upload_bytes), 0) AS u, COALESCE(SUM(download_bytes), 0) AS d FROM user_traffic_records WHERE user_id = ? GROUP BY record_at ORDER BY record_at DESC LIMIT 90`, [userId]);
  return rows.map((row) => ({ record_at: unix(row.record_at as Date) ?? 0, u: asNumber(row.u), d: asNumber(row.d) }));
}

export async function getUserStats(userId: number) {
  const pool = getDbPool(); const [orders, tickets, referrals] = await Promise.all([
    pool.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM orders WHERE user_id = ? AND status = 0`, [userId]),
    pool.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM tickets WHERE user_id = ? AND status = 0`, [userId]),
    pool.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM user_referrals WHERE inviter_user_id = ?`, [userId]),
  ]); return [asNumber(orders[0][0]?.total), asNumber(tickets[0][0]?.total), asNumber(referrals[0][0]?.total)] as [number, number, number];
}
