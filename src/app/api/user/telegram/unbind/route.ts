import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/users";
import { unbindTelegram } from "@/lib/server/telegram";
import { toApiError, unauthenticated } from "@/lib/server/errors";
export const runtime = "nodejs";
export async function POST() { try { const user = await getCurrentUser(); if (!user) throw unauthenticated(); await unbindTelegram(user.id); return NextResponse.json({ data: true }); } catch (e) { const { status, payload } = toApiError(e, "telegram unbind"); return NextResponse.json(payload, { status }); } }
