import { NextResponse } from "next/server";
import { getEmailVerificationCode } from "@/lib/server/email-verification";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "请求格式不正确" }, { status: 400 });
  }

  const payload = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ message: "请输入有效的邮箱地址" }, { status: 400 });
  }

  const code = getEmailVerificationCode();
  return NextResponse.json({
    data: code,
    message: `SMTP 尚未配置，当前验证码为 ${code}`,
  });
}
