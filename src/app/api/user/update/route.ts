import { NextResponse } from "next/server";
import { getCurrentUser, updatePreferences } from "@/lib/server/users";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "请求格式不正确" }, { status: 400 });
  }

  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "未登录或登录已过期" }, { status: 401 });

    const payload = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const isReminderValue = (value: unknown) => value === undefined || value === 0 || value === 1;
    if (!isReminderValue(payload.remind_expire) || !isReminderValue(payload.remind_traffic)) {
      return NextResponse.json({ message: "提醒设置格式不正确" }, { status: 400 });
    }

    await updatePreferences(user.id, {
      remind_expire: payload.remind_expire as number | undefined,
      remind_traffic: payload.remind_traffic as number | undefined,
    });
    return NextResponse.json({ data: true });
  } catch (error) {
    console.error("AeraNexa user preference update failed", error);
    return NextResponse.json({ message: "保存失败，请检查数据库配置" }, { status: 503 });
  }
}
