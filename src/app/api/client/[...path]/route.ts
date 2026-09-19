import { NextRequest, NextResponse } from "next/server";
import {
  cancelOrder,
  checkoutOrder,
  closeTicket,
  confirmMockPayment,
  createInviteCode,
  createOrder,
  createTicket,
  getInviteDetails,
  getInvites,
  getOrderDetail,
  getOrderStatus,
  getTicket,
  getUserStats,
  listKnowledge,
  listKnowledgeCategories,
  listNodes,
  listNotices,
  listOrders,
  listPaymentMethods,
  listPlans,
  listTickets,
  listTraffic,
  replyTicket,
  transferCommission,
  verifyCoupon,
} from "@/lib/server/client-portal";
import { listWalletTransactions, redeemRechargeCard } from "@/lib/server/recharge-cards";
import { recordAudit } from "@/lib/server/audit";
import { badRequest, readJsonBody, toApiError, unauthenticated } from "@/lib/server/errors";
import { getCurrentUser } from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };

const asInt = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};

const asText = (value: unknown, max = 255): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const asOptionalInt = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
};

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw unauthenticated();
  return user;
}

function failure(error: unknown, label: string) {
  const { status, payload } = toApiError(error, label);
  return NextResponse.json(payload, { status });
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireUser();
    const { path } = await context.params;
    const key = path.join("/");
    const query = request.nextUrl.searchParams;

    if (key === "plans") return NextResponse.json({ data: await listPlans() });

    if (key === "orders") {
      const rawStatus = query.get("status");
      const status = asOptionalInt(rawStatus);
      if (rawStatus !== null && status === undefined) throw badRequest("订单状态不正确");
      const result = await listOrders(user.id, {
        status,
        page: asOptionalInt(query.get("page")),
        pageSize: asOptionalInt(query.get("page_size")),
      });
      return NextResponse.json({
        data: result.items,
        meta: { total: result.total, page: result.page, page_size: result.pageSize, has_more: result.hasMore },
      });
    }

    if (key === "orders/status") {
      const tradeNo = asText(query.get("trade_no"), 64);
      if (!tradeNo) throw badRequest("缺少订单号");
      return NextResponse.json({ data: await getOrderStatus(user.id, tradeNo) });
    }

    if (key.startsWith("orders/")) {
      const tradeNo = decodeURIComponent(path[1] ?? "").trim().slice(0, 64);
      if (!tradeNo) throw badRequest("缺少订单号");
      return NextResponse.json({ data: await getOrderDetail(user.id, tradeNo) });
    }

    if (key === "payment-methods") return NextResponse.json({ data: await listPaymentMethods() });
    if (key === "wallet/transactions") {
      const result = await listWalletTransactions(user.id, asOptionalInt(query.get("page")), asOptionalInt(query.get("page_size")));
      return NextResponse.json({ data: result.items, meta: { total: result.total, page: result.page, page_size: result.pageSize } });
    }
    if (key === "nodes") return NextResponse.json({ data: await listNodes() });
    if (key === "notices") return NextResponse.json({ data: await listNotices() });
    if (key === "knowledge") {
      return NextResponse.json({ data: await listKnowledge(asText(query.get("category"), 100) || undefined) });
    }
    if (key === "knowledge/categories") return NextResponse.json({ data: await listKnowledgeCategories() });
    if (key === "tickets") return NextResponse.json({ data: await listTickets(user.id) });
    if (key.startsWith("tickets/")) {
      const ticketId = asInt(path[1]);
      if (!ticketId) throw badRequest("工单编号不正确");
      return NextResponse.json({ data: await getTicket(user.id, ticketId) });
    }
    if (key === "invites") return NextResponse.json({ data: await getInvites(user.id) });
    if (key === "invites/details") {
      return NextResponse.json({ data: await getInviteDetails(user.id, asOptionalInt(query.get("limit")) ?? 100) });
    }
    if (key === "traffic") {
      return NextResponse.json({ data: await listTraffic(user.id, asOptionalInt(query.get("days")) ?? 30) });
    }
    if (key === "stats") return NextResponse.json({ data: await getUserStats(user.id) });

    return NextResponse.json({ message: "接口不存在", code: "not_found" }, { status: 404 });
  } catch (error) {
    return failure(error, "client GET");
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireUser();
    const body = await readJsonBody(request);
    const { path } = await context.params;
    const key = path.join("/");

    if (key === "orders") {
      const planId = asInt(body.plan_id);
      const period = asText(body.period, 32);
      if (!planId) throw badRequest("请选择要购买的套餐");
      if (!period) throw badRequest("请选择付款周期");
      const tradeNo = await createOrder(user.id, {
        planId,
        period,
        couponCode: asText(body.coupon_code, 64) || undefined,
      });
      return NextResponse.json({ data: tradeNo }, { status: 201 });
    }

    if (key === "orders/cancel") {
      const tradeNo = asText(body.trade_no, 64);
      if (!tradeNo) throw badRequest("缺少订单号");
      return NextResponse.json({ data: await cancelOrder(user.id, tradeNo) });
    }

    if (key === "orders/checkout") {
      const tradeNo = asText(body.trade_no, 64);
      const methodId = asInt(body.method);
      if (!tradeNo) throw badRequest("缺少订单号");
      if (!methodId) throw badRequest("请选择支付方式");
      const result = await checkoutOrder(user.id, tradeNo, methodId);
      if (result.provider === "balance" && result.completed) {
        await recordAudit({ action: "order.paid", userId: user.id, resourceType: "order", resourceId: tradeNo, request, context: { provider: "balance", amount: result.amount } });
      }
      return NextResponse.json({ data: result });
    }

    if (key === "orders/mock-confirm") {
      const tradeNo = asText(body.trade_no, 64);
      const transactionId = asInt(body.transaction_id);
      if (!tradeNo) throw badRequest("缺少订单号");
      if (!transactionId) throw badRequest("模拟支付参数不正确");
      return NextResponse.json({ data: await confirmMockPayment(user.id, tradeNo, transactionId) });
    }

    if (key === "coupons/check") {
      const code = asText(body.code, 64);
      const planId = asInt(body.plan_id);
      if (!code) throw badRequest("请输入优惠码");
      if (!planId) throw badRequest("请选择套餐");
      return NextResponse.json({
        data: await verifyCoupon(user.id, code, planId, asText(body.period, 32) || undefined),
      });
    }

    if (key === "tickets") {
      const level = Number(body.level);
      if (!Number.isInteger(level)) throw badRequest("工单优先级不正确");
      const ticketId = await createTicket(user.id, {
        subject: asText(body.subject, 255),
        level,
        message: asText(body.message, 10000),
      });
      return NextResponse.json({ data: ticketId }, { status: 201 });
    }

    if (key === "tickets/reply") {
      const ticketId = asInt(body.id);
      if (!ticketId) throw badRequest("工单编号不正确");
      return NextResponse.json({ data: await replyTicket(user.id, ticketId, asText(body.message, 10000)) });
    }

    if (key === "tickets/close") {
      const ticketId = asInt(body.id);
      if (!ticketId) throw badRequest("工单编号不正确");
      return NextResponse.json({ data: await closeTicket(user.id, ticketId) });
    }

    if (key === "invites") {
      return NextResponse.json({ data: await createInviteCode(user.id) }, { status: 201 });
    }

    if (key === "commission/transfer") {
      const amount = asInt(body.transfer_amount);
      if (!amount) throw badRequest("划转金额不正确");
      return NextResponse.json({ data: await transferCommission(user.id, amount) });
    }

    if (key === "wallet/recharge") {
      const result = await redeemRechargeCard(user.id, asText(body.code, 128));
      await recordAudit({ action: "wallet.recharged", userId: user.id, resourceType: "recharge_card", resourceId: result.transaction_id, request, context: { creditedAmount: result.credited_amount } });
      return NextResponse.json({ data: result });
    }

    return NextResponse.json({ message: "接口不存在", code: "not_found" }, { status: 404 });
  } catch (error) {
    return failure(error, "client POST");
  }
}
