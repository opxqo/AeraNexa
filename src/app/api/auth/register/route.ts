import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/server/audit";
import { consumeVerificationCode } from "@/lib/server/email-verification";
import { badRequest, conflict, readJsonBody, toApiError } from "@/lib/server/errors";
import { setSessionCookie } from "@/lib/server/session";
import { findUserByEmail, registerUser, toPublicUser } from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** users.email 为 VARCHAR(64)，超长会在数据库层被截断或报错，这里提前拦截。 */
const EMAIL_MAX_LENGTH = 64;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 72;
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

export async function POST(request: Request) {
  try {
    const payload = await readJsonBody(request);
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    const password = typeof payload.password === "string" ? payload.password : "";
    const confirmation = typeof payload.password_confirmation === "string" ? payload.password_confirmation : password;
    const emailCode = typeof payload.email_code === "string" ? payload.email_code.trim() : "";
    const inviteCode = typeof payload.invite_code === "string" ? payload.invite_code.trim() : "";

    if (!email || email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
      throw badRequest("请输入有效的邮箱地址");
    }
    if (password.length < PASSWORD_MIN_LENGTH) throw badRequest(`密码长度不能少于 ${PASSWORD_MIN_LENGTH} 位`);
    if (password.length > PASSWORD_MAX_LENGTH) throw badRequest(`密码长度不能超过 ${PASSWORD_MAX_LENGTH} 位`);
    if (password !== confirmation) throw badRequest("两次输入的密码不一致");
    if (await findUserByEmail(email)) throw conflict("该邮箱已经注册");
    if (!emailCode) throw badRequest("请输入邮箱验证码");
    await consumeVerificationCode(email, "register", emailCode);

    const user = await registerUser({ email, password, inviteCode: inviteCode || undefined });
    await setSessionCookie(user.id);
    await recordAudit({
      action: "auth.register",
      userId: user.id,
      request,
      context: { email, invited: Boolean(inviteCode) },
    });

    return NextResponse.json({ data: toPublicUser(user) }, { status: 201 });
  } catch (error) {
    const { status, payload } = toApiError(error, "auth register");
    return NextResponse.json(payload, { status });
  }
}
