import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/server/audit";
import { toApiError } from "@/lib/server/errors";
import { clearSessionCookie } from "@/lib/server/session";
import { getCurrentUser } from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    // 先撤销 Cookie，保证即使审计/查询失败用户也确实退出了。
    await clearSessionCookie();
    try {
      const user = await getCurrentUser();
      if (user) {
        await recordAudit({ action: "auth.logout", userId: user.id, request, context: { email: user.email } });
      }
    } catch (error) {
      console.error("[aeranexa] logout audit skipped", error);
    }
    return NextResponse.json({ data: true });
  } catch (error) {
    const { status, payload } = toApiError(error, "auth logout");
    return NextResponse.json(payload, { status });
  }
}
