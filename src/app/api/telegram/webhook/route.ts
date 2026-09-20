import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getTelegramSettings, handleTelegramUpdate } from "@/lib/server/telegram";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const settings = await getTelegramSettings();
  const received = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  const expected = settings.webhookSecret;
  const valid = expected.length > 0 && received.length === expected.length && timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  if (!settings.enabled || settings.mode !== "webhook" || !valid) return new NextResponse(null, { status: 403 });
  const update = await request.json().catch(() => null);
  if (!update || typeof update !== "object") return new NextResponse(null, { status: 400 });
  await handleTelegramUpdate(update as Parameters<typeof handleTelegramUpdate>[0]);
  return NextResponse.json({ ok: true });
}
