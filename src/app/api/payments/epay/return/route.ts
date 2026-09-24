import { NextRequest } from "next/server";
import { handleEpayNotice } from "@/lib/server/payments/epay";
import { emitRuntimeLog, safeError } from "@/lib/server/runtime-logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 用户付款后易支付收银台跳回这里，携带与异步通知相同的签名参数；顺带补偿丢失的通知，再回到订单页。 */
export async function GET(request: NextRequest) {
  let tradeNo: string | null = null;
  let testTradeNo: string | null = null;
  try {
    const result = await handleEpayNotice(Object.fromEntries(request.nextUrl.searchParams), "return");
    ({ tradeNo, testTradeNo } = result);
    void emitRuntimeLog({ service: "web", category: "payment", level: result.processed ? "info" : "warn", eventCode: "payment.epay_return", message: result.processed ? "Epay return processed" : "Epay return not processed", requestId: request.headers.get("x-request-id"), path: request.nextUrl.pathname, details: { processed: result.processed, test: Boolean(testTradeNo) } });
  } catch (error) {
    void emitRuntimeLog({ service: "web", category: "payment", level: "error", eventCode: "payment.epay_return_failed", message: safeError(error), requestId: request.headers.get("x-request-id"), path: request.nextUrl.pathname });
  }
  // 后台测试单跳回支付测试台，并自动恢复该测试单的查询。
  if (testTradeNo) return redirect(`/admin/payment-test?epay=${encodeURIComponent(testTradeNo)}`);
  return redirect(tradeNo ? `/order/${encodeURIComponent(tradeNo)}?paying=1` : "/order");
}

/** 用相对 Location：反向代理后 request.url 是容器内地址（如 localhost:8080），不能拿来拼绝对跳转。 */
function redirect(path: string) {
  return new Response(null, { status: 303, headers: { location: path } });
}
