import { NextResponse } from "next/server";
import { getEmailVerificationCode } from "@/lib/server/email-verification";
import { setSessionCookie } from "@/lib/server/session";
import { createUser, findUserByEmail, toPublicUser } from "@/lib/server/users";

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
    const confirmation = typeof payload.password_confirmation === "string" ? payload.password_confirmation : password;
    const emailCode = typeof payload.email_code === "string" ? payload.email_code.trim() : "";
    const expectedEmailCode = getEmailVerificationCode();

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ message: "请输入有效的邮箱地址" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ message: "密码长度不能少于 8 位" }, { status: 400 });
    }
    if (password !== confirmation) {
      return NextResponse.json({ message: "两次输入的密码不一致" }, { status: 400 });
    }
    if (emailCode !== expectedEmailCode) {
      return NextResponse.json({ message: "邮箱验证码错误" }, { status: 400 });
    }

    if (await findUserByEmail(email)) {
      return NextResponse.json({ message: "该邮箱已经注册" }, { status: 409 });
    }

    const user = await createUser(email, password);
    await setSessionCookie(user.id);
    return NextResponse.json({ data: toPublicUser(user) }, { status: 201 });
  } catch (error) {
    console.error("AeraNexa registration failed", error);
    return NextResponse.json({ message: "注册失败，请检查数据库配置" }, { status: 503 });
  }
}
