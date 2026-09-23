import { NextRequest, NextResponse } from "next/server";
import { handleEpayNotice } from "@/lib/server/payments/epay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 用户付款后易支付收银台跳回这里，携带与异步通知相同的签名参数；顺带补偿丢失的通知，再回到订单页。 */
export async function GET(request: NextRequest) {
  let tradeNo: string | null = null;
  let testTradeNo: string | null = null;
  try {
    ({ tradeNo, testTradeNo } = await handleEpayNotice(Object.fromEntries(request.nextUrl.searchParams), "return"));
  } catch (error) {
    console.error("[epay return]", error);
  }
  // 后台测试单跳回支付测试台，并自动恢复该测试单的查询。
  if (testTradeNo) return NextResponse.redirect(new URL(`/admin/payment-test?epay=${encodeURIComponent(testTradeNo)}`, request.url));
  return NextResponse.redirect(new URL(tradeNo ? `/order/${encodeURIComponent(tradeNo)}` : "/order", request.url));
}
