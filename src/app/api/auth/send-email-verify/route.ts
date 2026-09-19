import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/server/audit";
import { assertEmailServiceAvailable, createVerificationCode, clientIp, invalidateLatestVerificationCode, isEmailCodePurpose } from "@/lib/server/email-verification";
import { badRequest, readJsonBody, toApiError } from "@/lib/server/errors";
import { sendVerificationEmail } from "@/lib/server/mailer";
import { findUserByEmail } from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_MAX_LENGTH = 64;
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

export async function POST(request: Request) {
  try {
    const payload = await readJsonBody(request);
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    const purpose = typeof payload.purpose === "string" ? payload.purpose.trim() : "register";
    if (!email || email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
      throw badRequest("请输入有效的邮箱地址");
    }
    if (!isEmailCodePurpose(purpose)) throw badRequest("验证码用途不正确");
    await assertEmailServiceAvailable();

    // 找回密码时始终返回相同成功文案，避免接口成为账户枚举器。
    const user = await findUserByEmail(email);
    if (purpose === "reset-password" && !user) {
      return NextResponse.json({ message: "如该邮箱已注册，验证码将发送至邮箱" }, { status: 202 });
    }

    const ip = clientIp(request);
    const code = await createVerificationCode(email, purpose, ip);
    try {
      await sendVerificationEmail({ to: email, purpose, code });
    } catch (error) {
      await invalidateLatestVerificationCode(email, purpose);
      await recordAudit({ action: "auth.email_verification_failed", userId: user?.id ?? null, request, context: { email, purpose, ip } });
      throw error;
    }
    await recordAudit({ action: "auth.email_verification_sent", userId: user?.id ?? null, request, context: { email, purpose, ip } });
    return NextResponse.json({ message: "验证码已发送，请查收邮箱" }, { status: 202 });
  } catch (error) {
    const { status, payload } = toApiError(error, "auth send-email-verify");
    return NextResponse.json(payload, { status });
  }
}
