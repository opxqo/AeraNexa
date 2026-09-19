import { NextResponse } from "next/server";
import { getCurrentUser, resetSecurity } from "@/lib/server/users";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "未登录或登录已过期" }, { status: 401 });

    const token = await resetSecurity(user.id);
    const baseUrl = (process.env.SUBSCRIBE_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
    return NextResponse.json({ data: `${baseUrl}/api/v1/client/subscribe?token=${token}` });
  } catch (error) {
    console.error("AeraNexa security reset failed", error);
    return NextResponse.json({ message: "重置失败，请检查数据库配置" }, { status: 503 });
  }
}
