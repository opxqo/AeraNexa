import { NextRequest, NextResponse } from "next/server";
import { cancelOrder, checkoutOrder, closeTicket, confirmMockPayment, createInviteCode, createOrder, createTicket, getInvites, getOrderDetail, getOrderStatus, getTicket, getUserStats, listKnowledge, listKnowledgeCategories, listNodes, listNotices, listOrders, listPaymentMethods, listPlans, listTickets, listTraffic, replyTicket, transferCommission, verifyCoupon } from "@/lib/server/client-portal";
import { getCurrentUser } from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ path: string[] }> };
const invalid = (message: string) => NextResponse.json({ message }, { status: 400 });
const asInt = (value: unknown): number | null => { const number = Number(value); return Number.isInteger(number) && number > 0 ? number : null; };
const asText = (value: unknown, max = 255): string => typeof value === "string" ? value.trim().slice(0, max) : "";
async function payload(request: NextRequest) { try { const value: unknown = await request.json(); return value && typeof value === "object" ? value as Record<string, unknown> : {}; } catch { return null; } }

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser(); if (!user) return NextResponse.json({ message: "未登录或登录已过期" }, { status: 401 });
    const { path } = await context.params; const key = path.join("/"); const query = request.nextUrl.searchParams;
    if (key === "plans") return NextResponse.json({ data: await listPlans() });
    if (key === "orders") { const statusText = query.get("status"); const status = statusText === null ? undefined : Number(statusText); return Number.isInteger(status) ? NextResponse.json({ data: await listOrders(user.id, status) }) : statusText === null ? NextResponse.json({ data: await listOrders(user.id) }) : invalid("订单状态不正确"); }
    if (key === "orders/status") { const tradeNo = query.get("trade_no")?.trim(); return tradeNo ? NextResponse.json({ data: await getOrderStatus(user.id, tradeNo) }) : invalid("缺少订单号"); }
    if (key.startsWith("orders/")) { const tradeNo = decodeURIComponent(path[1] ?? "").trim(); return tradeNo ? NextResponse.json({ data: await getOrderDetail(user.id, tradeNo) }) : invalid("缺少订单号"); }
    if (key === "payment-methods") return NextResponse.json({ data: await listPaymentMethods() });
    if (key === "nodes") return NextResponse.json({ data: await listNodes() });
    if (key === "notices") return NextResponse.json({ data: await listNotices() });
    if (key === "knowledge") return NextResponse.json({ data: await listKnowledge(query.get("category") ?? undefined) });
    if (key === "knowledge/categories") return NextResponse.json({ data: await listKnowledgeCategories() });
    if (key === "tickets") return NextResponse.json({ data: await listTickets(user.id) });
    if (key.startsWith("tickets/")) { const ticketId = asInt(path[1]); return ticketId ? NextResponse.json({ data: await getTicket(user.id, ticketId) }) : invalid("工单编号不正确"); }
    if (key === "invites") return NextResponse.json({ data: await getInvites(user.id) });
    if (key === "traffic") return NextResponse.json({ data: await listTraffic(user.id) });
    if (key === "stats") return NextResponse.json({ data: await getUserStats(user.id) });
    return NextResponse.json({ message: "接口不存在" }, { status: 404 });
  } catch (error) { console.error("AeraNexa client GET failed", error); return NextResponse.json({ message: error instanceof Error ? error.message : "读取数据失败" }, { status: 503 }); }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser(); if (!user) return NextResponse.json({ message: "未登录或登录已过期" }, { status: 401 });
    const body = await payload(request); if (!body) return invalid("请求格式不正确"); const { path } = await context.params; const key = path.join("/");
    if (key === "orders") { const planId = asInt(body.plan_id); const period = asText(body.period, 32); return planId && period ? NextResponse.json({ data: await createOrder(user.id, { planId, period, couponCode: asText(body.coupon_code, 64) || undefined }) }, { status: 201 }) : invalid("套餐或付款周期不正确"); }
    if (key === "orders/cancel") { const tradeNo = asText(body.trade_no, 64); return tradeNo ? NextResponse.json({ data: await cancelOrder(user.id, tradeNo) }) : invalid("缺少订单号"); }
    if (key === "orders/checkout") { const tradeNo = asText(body.trade_no, 64); const methodId = asInt(body.method); return tradeNo && methodId ? NextResponse.json({ data: await checkoutOrder(user.id, tradeNo, methodId) }) : invalid("订单号或支付方式不正确"); }
    if (key === "orders/mock-confirm") { const tradeNo = asText(body.trade_no, 64); const transactionId = asInt(body.transaction_id); return tradeNo && transactionId ? NextResponse.json({ data: await confirmMockPayment(user.id, tradeNo, transactionId) }) : invalid("模拟支付参数不正确"); }
    if (key === "coupons/check") { const code = asText(body.code, 64); const planId = asInt(body.plan_id); return code && planId ? NextResponse.json({ data: await verifyCoupon(user.id, code, planId, asText(body.period, 32) || undefined) }) : invalid("优惠券或套餐不正确"); }
    if (key === "tickets") { const level = Number(body.level); return Number.isInteger(level) ? NextResponse.json({ data: await createTicket(user.id, { subject: asText(body.subject), level, message: asText(body.message, 10000) }) }, { status: 201 }) : invalid("工单优先级不正确"); }
    if (key === "tickets/reply") { const ticketId = asInt(body.id); return ticketId ? NextResponse.json({ data: await replyTicket(user.id, ticketId, asText(body.message, 10000)) }) : invalid("工单编号不正确"); }
    if (key === "tickets/close") { const ticketId = asInt(body.id); return ticketId ? NextResponse.json({ data: await closeTicket(user.id, ticketId) }) : invalid("工单编号不正确"); }
    if (key === "invites") return NextResponse.json({ data: await createInviteCode(user.id) }, { status: 201 });
    if (key === "commission/transfer") { const amount = asInt(body.transfer_amount); return amount ? NextResponse.json({ data: await transferCommission(user.id, amount) }) : invalid("划转金额不正确"); }
    return NextResponse.json({ message: "接口不存在" }, { status: 404 });
  } catch (error) { console.error("AeraNexa client POST failed", error); return NextResponse.json({ message: error instanceof Error ? error.message : "操作失败" }, { status: 503 }); }
}
