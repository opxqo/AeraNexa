import { NextResponse } from "next/server";
import { badRequest, readJsonBody, toApiError, unauthenticated } from "@/lib/server/errors";
import { getCurrentUser, updatePreferences, updateProfile } from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isReminderValue = (value: unknown): boolean => value === undefined || value === 0 || value === 1;

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) throw unauthenticated();

    const payload = await readJsonBody(request);

    if (!isReminderValue(payload.remind_expire) || !isReminderValue(payload.remind_traffic)) {
      throw badRequest("提醒设置格式不正确");
    }

    const hasNickname = payload.nickname !== undefined;
    let nickname: string | undefined;
    if (hasNickname) {
      if (typeof payload.nickname !== "string") throw badRequest("昵称格式不正确");
      nickname = payload.nickname.trim();
      if (nickname.length < 1 || nickname.length > 50) throw badRequest("昵称长度需在 1 到 50 个字符之间");
      // 过滤控制字符，避免写入不可见内容导致后台与订阅页显示异常。
      if (/[\u0000-\u001f\u007f]/.test(nickname)) throw badRequest("昵称包含不可用字符");
    }

    const hasReminder = payload.remind_expire !== undefined || payload.remind_traffic !== undefined;
    if (!hasNickname && !hasReminder) throw badRequest("没有需要更新的内容");

    if (hasReminder) {
      await updatePreferences(user.id, {
        remind_expire: payload.remind_expire as number | undefined,
        remind_traffic: payload.remind_traffic as number | undefined,
      });
    }
    if (hasNickname) await updateProfile(user.id, { nickname });

    return NextResponse.json({ data: true });
  } catch (error) {
    const { status, payload } = toApiError(error, "user update");
    return NextResponse.json(payload, { status });
  }
}
