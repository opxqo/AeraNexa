import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/users";
import { createBindingCode, getTelegramSettings } from "@/lib/server/telegram";
import { toApiError, unauthenticated } from "@/lib/server/errors";
export const runtime = "nodejs";
export async function GET() {
  try {
    if (!(await getCurrentUser())) throw unauthenticated();
    const settings = await getTelegramSettings();
    return NextResponse.json({ data: { enabled: settings.enabled, username: settings.username } });
  } catch (e) {
    const { status, payload } = toApiError(e, "telegram bind status");
    return NextResponse.json(payload, { status });
  }
}
export async function POST() {
  try {
    const user = await getCurrentUser(); if (!user) throw unauthenticated();
    const settings = await getTelegramSettings();
    if (!settings.enabled || !settings.username || !settings.token) {
      return NextResponse.json({ message: "Telegram Bot 当前未启用或尚未配置完成" }, { status: 409 });
    }
    return NextResponse.json({ data: { ...await createBindingCode(user.id), username: settings.username } });
  } catch (e) {
    const { status, payload } = toApiError(e, "telegram bind code");
    return NextResponse.json(payload, { status });
  }
}
