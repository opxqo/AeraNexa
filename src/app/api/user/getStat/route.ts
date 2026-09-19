import { NextResponse } from "next/server";
import { getUserStats } from "@/lib/server/client-portal";
import { toApiError, unauthenticated } from "@/lib/server/errors";
import { getCurrentUser } from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) throw unauthenticated();
    return NextResponse.json({ data: await getUserStats(user.id) });
  } catch (error) {
    const { status, payload } = toApiError(error, "user getStat");
    return NextResponse.json(payload, { status });
  }
}
