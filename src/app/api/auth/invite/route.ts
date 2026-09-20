import { NextRequest, NextResponse } from "next/server";
import { inspectInviteCode } from "@/lib/server/client-portal";
import { toApiError } from "@/lib/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get("code")?.trim() ?? "";
    return NextResponse.json({ data: await inspectInviteCode(code, true) });
  } catch (error) {
    const { status, payload } = toApiError(error, "invite lookup");
    return NextResponse.json(payload, { status });
  }
}
