import { NextResponse } from "next/server";
import { listUserDevices, getUserDeviceLimit, removeUserDevices } from "@/lib/server/devices";
import { badRequest, readJsonBody, toApiError, unauthenticated } from "@/lib/server/errors";
import { getCurrentUser } from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 我的设备：订阅层登记的设备（HWID），以及当前设备数上限（0 表示不限）。 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) throw unauthenticated();
    const [limit, items] = await Promise.all([getUserDeviceLimit(user.id), listUserDevices(user.id)]);
    return NextResponse.json({ data: { limit, items } });
  } catch (error) {
    const { status, payload } = toApiError(error, "user devices list");
    return NextResponse.json(payload, { status });
  }
}

/** 移除设备：body `{ id }` 移除单台，`{ all: true }` 全部移除。移除后该设备下次拉取订阅需重新占用名额。 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) throw unauthenticated();
    const payload = await readJsonBody(request);

    if (payload.all === true) {
      return NextResponse.json({ data: { removed: await removeUserDevices(user.id) } });
    }
    const id = Number(payload.id);
    if (!Number.isSafeInteger(id) || id < 1) throw badRequest("设备编号不正确");
    const removed = await removeUserDevices(user.id, id);
    if (!removed) throw badRequest("设备不存在或已移除");
    return NextResponse.json({ data: { removed } });
  } catch (error) {
    const { status, payload } = toApiError(error, "user devices remove");
    return NextResponse.json(payload, { status });
  }
}
