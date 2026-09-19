import { NextResponse } from "next/server";
import { badRequest, readJsonBody, toApiError, unauthenticated } from "@/lib/server/errors";
import { clearSessionCookie, revokeUserSessions } from "@/lib/server/session";
import { getCurrentUser, updatePassword, verifyPassword } from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** bcrypt 只取前 72 字节，超长密码会静默共享前缀，因此显式限制长度。 */
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 72;

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) throw unauthenticated();

    const payload = await readJsonBody(request);
    const oldPassword = typeof payload.old_password === "string" ? payload.old_password : "";
    const newPassword = typeof payload.new_password === "string" ? payload.new_password : "";

    if (!oldPassword) throw badRequest("请输入当前密码");
    if (newPassword.length < PASSWORD_MIN_LENGTH) throw badRequest(`新密码长度不能少于 ${PASSWORD_MIN_LENGTH} 位`);
    if (newPassword.length > PASSWORD_MAX_LENGTH) throw badRequest(`新密码长度不能超过 ${PASSWORD_MAX_LENGTH} 位`);
    if (!newPassword.trim()) throw badRequest("新密码不能为空白字符");

    if (!(await verifyPassword(oldPassword, user.password_hash))) throw badRequest("旧密码错误");
    if (newPassword === oldPassword) throw badRequest("新密码不能与旧密码相同");

    await updatePassword(user.id, newPassword);
    // 改密后撤销该账户全部会话（含当前会话），旧 Cookie 无法重放。
    await revokeUserSessions(user.id);
    await clearSessionCookie();
    return NextResponse.json({ data: true });
  } catch (error) {
    const { status, payload } = toApiError(error, "user changePassword");
    return NextResponse.json(payload, { status });
  }
}
