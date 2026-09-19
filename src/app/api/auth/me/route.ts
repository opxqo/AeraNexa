import { NextResponse } from "next/server";
import { getCurrentUser, toPublicUser } from "@/lib/server/users";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "未登录或登录已过期" }, { status: 401 });
    return NextResponse.json({ data: toPublicUser(user) });
  } catch (error) {
    console.error("AeraNexa session lookup failed", error);
    return NextResponse.json({ message: "用户系统暂不可用，请检查数据库配置" }, { status: 503 });
  }
}
