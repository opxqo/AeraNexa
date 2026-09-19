import { NextRequest, NextResponse } from "next/server";
import { processPaymentCallback } from "@/lib/server/payment-callbacks";
import { toApiError } from "@/lib/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CallbackRouteContext = { params: Promise<{ provider: string }> };

export async function POST(request: NextRequest, context: CallbackRouteContext) {
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
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const { status, payload } = toApiError(error, "payment callback");
    return NextResponse.json(payload, { status });
  }
}
