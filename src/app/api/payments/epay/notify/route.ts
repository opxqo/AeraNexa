import { NextRequest } from "next/server";
import { handleEpayNotice } from "@/lib/server/payments/epay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 易支付异步通知：只认纯文本 success；通知丢失时由 return_url 或后台对账补偿。 */
async function handle(params: Record<string, string>) {
  try {
    const result = await handleEpayNotice(params, "notify");
    return new Response(result.processed ? "success" : "fail", { headers: { "content-type": "text/plain" } });
  } catch (error) {
    console.error("[epay notify]", error);
    return new Response("fail", { status: 200, headers: { "content-type": "text/plain" } });
  }
}

export async function GET(request: NextRequest) {
  return handle(Object.fromEntries(request.nextUrl.searchParams));
}

export async function POST(request: NextRequest) {
  const form = new URLSearchParams(await request.text());
  return handle({ ...Object.fromEntries(request.nextUrl.searchParams), ...Object.fromEntries(form) });
}
