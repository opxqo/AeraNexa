import { NextRequest } from "next/server";
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
  if (testTradeNo) return redirect(`/admin/payment-test?epay=${encodeURIComponent(testTradeNo)}`);
  return redirect(tradeNo ? `/order/${encodeURIComponent(tradeNo)}` : "/order");
}

/** 用相对 Location：反向代理后 request.url 是容器内地址（如 localhost:8080），不能拿来拼绝对跳转。 */
function redirect(path: string) {
  return new Response(null, { status: 303, headers: { location: path } });
}
