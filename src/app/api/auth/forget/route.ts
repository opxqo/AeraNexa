import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/server/audit";
import { consumeVerificationCode } from "@/lib/server/email-verification";
import { badRequest, readJsonBody, toApiError } from "@/lib/server/errors";
import { revokeUserSessions } from "@/lib/server/session";
import { findUserByEmail, updatePassword } from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_MAX_LENGTH = 64;
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

export async function POST(request: Request) {
  try {
    const payload = await readJsonBody(request);
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    const emailCode = typeof payload.email_code === "string" ? payload.email_code.trim() : "";
    const password = typeof payload.password === "string" ? payload.password : "";
    const confirmation = typeof payload.password_confirmation === "string" ? payload.password_confirmation : password;
    if (!email || email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
      throw badRequest("请输入有效的邮箱地址");
    }
    if (!/^\d{6}$/.test(emailCode)) throw badRequest("请输入六位邮箱验证码");
    if (password.length < 8 || password.length > 72) throw badRequest("密码长度需为 8-72 位");
    if (password !== confirmation) throw badRequest("两次输入的密码不一致");
    const user = await findUserByEmail(email);
    if (!user || !user.is_active) throw badRequest("邮箱验证码错误或已过期");
    await consumeVerificationCode(email, "reset-password", emailCode);
    await updatePassword(user.id, password);
    await revokeUserSessions(user.id);
    await recordAudit({ action: "auth.security_reset", userId: user.id, request, context: { email } });

    return NextResponse.json({ data: true, message: "密码重置成功，请重新登录" });
  } catch (error) {
    const { status, payload } = toApiError(error, "auth forget");
    return NextResponse.json(payload, { status });
  }
}
