import { NextResponse } from "next/server";
import { getEmailVerificationCode } from "@/lib/server/email-verification";
import { badRequest, readJsonBody, toApiError } from "@/lib/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_MAX_LENGTH = 64;
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

/**
 * 发送注册邮箱验证码。
 *
 * 当前 SMTP 尚未接入，接口直接把本地过渡码回显给前端，便于联调。
 * TODO(SMTP)：接入邮件服务时，这里必须改为
 *   1) 生成随机码并写入 email_verification_codes（code_hash 存储，带 expires_at 与 attempts）；
 *   2) 通过 MailService 投递，且响应体不再包含明文验证码；
 *   3) 增加按邮箱 + IP 的发送频率限制，防止被当作邮件轰炸跳板。
 */
export async function POST(request: Request) {
  try {
    const payload = await readJsonBody(request);
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    if (!email || email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
      throw badRequest("请输入有效的邮箱地址");
    }

    const code = getEmailVerificationCode();
    return NextResponse.json({
      data: code,
      message: `SMTP 尚未配置，当前验证码为 ${code}`,
    });
  } catch (error) {
    const { status, payload } = toApiError(error, "auth send-email-verify");
    return NextResponse.json(payload, { status });
  }
}
