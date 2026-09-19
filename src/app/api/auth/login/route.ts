import { NextResponse } from "next/server";
import { countRecentAuditsByContext, recordAudit } from "@/lib/server/audit";
import { badRequest, readJsonBody, toApiError, tooManyRequests } from "@/lib/server/errors";
import { setSessionCookie } from "@/lib/server/session";
import {
  findUserByEmail,
  findUserById,
  toPublicUser,
  updateLastLogin,
  verifyPassword,
} from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FAILED_ATTEMPTS_PER_ACCOUNT = 5;
const MAX_FAILED_ATTEMPTS_PER_IP = 30;
const FAILED_WINDOW_MINUTES = 15;

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function POST(request: Request) {
  try {
    const payload = await readJsonBody(request);
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    const password = typeof payload.password === "string" ? payload.password : "";

    if (!email || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
      throw badRequest("邮箱或密码格式不正确");
    }

    const ip = clientIp(request);
    // 防爆破：账号维度严格、IP 维度宽松。超限时直接拒绝，避免持续消耗 bcrypt 计算。
    const [accountFailures, ipFailures] = await Promise.all([
      countRecentAuditsByContext("auth.login_failed", "email", email, FAILED_WINDOW_MINUTES),
      countRecentAuditsByContext("auth.login_failed", "ip", ip, FAILED_WINDOW_MINUTES),
    ]);
    if (accountFailures >= MAX_FAILED_ATTEMPTS_PER_ACCOUNT || ipFailures >= MAX_FAILED_ATTEMPTS_PER_IP) {
      throw tooManyRequests(`登录尝试过于频繁，请 ${FAILED_WINDOW_MINUTES} 分钟后再试`);
    }

    const user = await findUserByEmail(email);
    const passwordMatches = user ? await verifyPassword(password, user.password_hash) : false;

    if (!user || !user.is_active || !passwordMatches) {
      await recordAudit({
        action: "auth.login_failed",
        userId: user?.id ?? null,
        request,
        context: { email, ip, reason: !user ? "unknown_email" : !user.is_active ? "inactive" : "bad_password" },
      });
      // 统一文案，避免通过错误信息枚举已注册邮箱。
      return NextResponse.json(
        { message: user && !user.is_active ? "该账户已被停用，请联系客服" : "邮箱或密码错误", code: "unauthenticated" },
        { status: 401 },
      );
    }

    await updateLastLogin(user.id);
    await setSessionCookie(user.id);
    await recordAudit({ action: "auth.login", userId: user.id, request, context: { email, ip } });

    const updatedUser = await findUserById(user.id);
    if (!updatedUser) throw new Error("User disappeared after login");
    return NextResponse.json({ data: toPublicUser(updatedUser) });
  } catch (error) {
    const { status, payload } = toApiError(error, "auth login");
    return NextResponse.json(payload, { status });
  }
}
