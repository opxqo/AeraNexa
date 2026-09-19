import { NextResponse } from "next/server";
import { toApiError, unauthenticated } from "@/lib/server/errors";
import { getCurrentUser, resetSecurity } from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 重置订阅安全信息（轮换 UUID 与订阅 Token）。
 * 会改变服务端状态，因此使用 POST，避免被 GET 预取或外链图片触发。
 */
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) throw unauthenticated();

    const token = await resetSecurity(user.id);
    const baseUrl = (process.env.SUBSCRIBE_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
    return NextResponse.json({
      data: {
        token,
        uuid: user.uuid,
        subscribe_url: `${baseUrl}/api/v1/client/subscribe?token=${token}`,
      },
    });
  } catch (error) {
    const { status, payload } = toApiError(error, "user resetSecurity");
    return NextResponse.json(payload, { status });
  }
}
