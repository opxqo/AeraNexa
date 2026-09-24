import { NextRequest } from "next/server";
import { handleEpayNotice } from "@/lib/server/payments/epay";
import { emitRuntimeLog, safeError } from "@/lib/server/runtime-logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 易支付异步通知：只认纯文本 success；通知丢失时由 return_url 或后台对账补偿。 */
async function handle(params: Record<string, string>, request: NextRequest) {
  const requestId = request.headers.get("x-request-id");
  try {
    const result = await handleEpayNotice(params, "notify");
    void emitRuntimeLog({ service: "web", category: "payment", level: result.processed ? "info" : "warn", eventCode: "payment.epay_notify", message: result.processed ? "Epay notice processed" : "Epay notice rejected or duplicate", requestId, path: request.nextUrl.pathname, details: { processed: result.processed, test: Boolean(result.testTradeNo) } });
    return new Response(result.processed ? "success" : "fail", { headers: { "content-type": "text/plain" } });
  } catch (error) {
    void emitRuntimeLog({ service: "web", category: "payment", level: "error", eventCode: "payment.epay_notify_failed", message: safeError(error), requestId, path: request.nextUrl.pathname });
    return new Response("fail", { status: 200, headers: { "content-type": "text/plain" } });
  }
}

export async function GET(request: NextRequest) {
  return handle(Object.fromEntries(request.nextUrl.searchParams), request);
}

export async function POST(request: NextRequest) {
  const form = new URLSearchParams(await request.text());
  return handle({ ...Object.fromEntries(request.nextUrl.searchParams), ...Object.fromEntries(form) }, request);
}
