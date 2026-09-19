import { NextResponse } from "next/server";
import { badRequest, readJsonBody, toApiError } from "@/lib/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_MAX_LENGTH = 64;
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

/**
 * 找回密码。
 *
 * 目前返回 501：`password_reset_tokens` 表结构已就绪，但缺少邮件投递能力，
 * 无法把重置链接送达用户。这里刻意不返回明文令牌——那等同于任何人都能重置任意邮箱的密码。
 *
 * TODO(SMTP)：接入邮件服务后按以下步骤实现：
 *   1) 校验邮箱存在，生成随机令牌，仅存 sha256 摘要 + 30 分钟有效期到 password_reset_tokens；
 *   2) 通过 MailService 投递重置链接；
 *   3) 新增 /api/auth/resetPassword：校验令牌未过期未消费，更新密码后撤销该账户全部会话并标记 consumed_at；
 *   4) 两个接口都要按邮箱 + IP 限流，且响应文案不区分邮箱是否存在，避免账号枚举。
 */
export async function POST(request: Request) {
  try {
    const payload = await readJsonBody(request);
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    if (!email || email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
      throw badRequest("请输入有效的邮箱地址");
    }

    return NextResponse.json(
      { message: "找回密码需要先配置邮箱服务，当前尚未启用", code: "unavailable" },
      { status: 501 },
    );
  } catch (error) {
    const { status, payload } = toApiError(error, "auth forget");
    return NextResponse.json(payload, { status });
  }
}
