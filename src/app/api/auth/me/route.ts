import { NextResponse } from "next/server";
import { toApiError, unauthenticated } from "@/lib/server/errors";
import { getCurrentUser, toPublicUser } from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) throw unauthenticated();
    return NextResponse.json({ data: toPublicUser(user) });
  } catch (error) {
    const { status, payload } = toApiError(error, "auth me");
    return NextResponse.json(payload, { status });
  }
}
