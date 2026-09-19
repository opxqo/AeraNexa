import { NextResponse } from "next/server";
import { clearSessionCookie, revokeUserSessions } from "@/lib/server/session";
import { getCurrentUser, updatePassword, verifyPassword } from "@/lib/server/users";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "未登录或登录已过期" }, { status: 401 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ message: "请求格式不正确" }, { status: 400 });
    }
    const payload = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const oldPassword = typeof payload.old_password === "string" ? payload.old_password : "";
    const newPassword = typeof payload.new_password === "string" ? payload.new_password : "";
    if (newPassword.length < 8) {
      return NextResponse.json({ message: "新密码长度不能少于 8 位" }, { status: 400 });
    }
    if (!(await verifyPassword(oldPassword, user.password_hash))) {
      return NextResponse.json({ message: "旧密码错误" }, { status: 400 });
    }
    if (newPassword === oldPassword) {
      return NextResponse.json({ message: "新密码不能与旧密码相同" }, { status: 400 });
    }

    await updatePassword(user.id, newPassword);
    await revokeUserSessions(user.id);
    await clearSessionCookie();
    return NextResponse.json({ data: true });
  } catch (error) {
    console.error("AeraNexa password update failed", error);
    return NextResponse.json({ message: "密码修改失败，请检查数据库配置" }, { status: 503 });
  }
}
