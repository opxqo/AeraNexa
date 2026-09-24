import { NextRequest, NextResponse } from "next/server";
import { processPaymentCallback } from "@/lib/server/payment-callbacks";
import { toApiError } from "@/lib/server/errors";
import { emitRuntimeLog, safeError } from "@/lib/server/runtime-logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CallbackRouteContext = { params: Promise<{ provider: string }> };

export async function POST(request: NextRequest, context: CallbackRouteContext) {
  const requestId = request.headers.get("x-request-id");
  try {
    const { provider } = await context.params;
    const rawBody = await request.text();
    const result = await processPaymentCallback({
      provider,
      timestamp: request.headers.get("x-aera-timestamp") ?? "",
      eventId: request.headers.get("x-aera-event-id") ?? "",
      signature: request.headers.get("x-aera-signature") ?? "",
      rawBody,
    });
    void emitRuntimeLog({ service: "web", category: "payment", level: result.processed ? "info" : "warn", eventCode: "payment.callback", message: result.processed ? "Payment callback processed" : "Payment callback not processed", requestId, path: request.nextUrl.pathname, details: { processed: result.processed, duplicate: Boolean(result.duplicate) } });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const { status, payload } = toApiError(error, "payment callback");
    void emitRuntimeLog({ service: "web", category: "payment", level: "error", eventCode: "payment.callback_failed", message: safeError(error), requestId, path: request.nextUrl.pathname, statusCode: status });
    return NextResponse.json(payload, { status });
  }
}
