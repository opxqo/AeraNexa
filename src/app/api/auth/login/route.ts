import { NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/server/session";
import {
  findUserByEmail,
  findUserById,
  toPublicUser,
  updateLastLogin,
  verifyPassword,
} from "@/lib/server/users";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "请求格式不正确" }, { status: 400 });
  }

  try {
    const payload = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    const password = typeof payload.password === "string" ? payload.password : "";

    if (!email || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
      return NextResponse.json({ message: "邮箱或密码格式不正确" }, { status: 400 });
    }

    const user = await findUserByEmail(email);
    if (!user || !user.is_active || !(await verifyPassword(password, user.password_hash))) {
      return NextResponse.json({ message: "邮箱或密码错误" }, { status: 401 });
    }

    await updateLastLogin(user.id);
    await setSessionCookie(user.id);
    const updatedUser = await findUserById(user.id);
    if (!updatedUser) throw new Error("User disappeared after login");
    return NextResponse.json({ data: toPublicUser(updatedUser) });
  } catch (error) {
    console.error("AeraNexa login failed", error);
    return NextResponse.json({ message: "用户系统暂不可用，请检查数据库配置" }, { status: 503 });
  }
}
