import { NextResponse } from "next/server";
import { badRequest, toApiError, unauthenticated } from "@/lib/server/errors";
import { ALLOWED_HISTORY_HOURS, getHistory, MonitorError, toBusinessError } from "@/lib/server/monitor/client";
import { getCurrentUser } from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 单节点时序历史（负载 / 流量 / 三网延迟），窗口取值受 CF-Server-Monitor 白名单限制。 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) throw unauthenticated();

    const url = new URL(request.url);
    const id = url.searchParams.get("id")?.trim() ?? "";
    const hours = Number(url.searchParams.get("hours") ?? "1");
    if (!id) throw badRequest("缺少节点 id");
    if (!ALLOWED_HISTORY_HOURS.includes(hours)) {
      throw badRequest(`hours 仅支持 ${ALLOWED_HISTORY_HOURS.join(" / ")}`);
    }

    return NextResponse.json({ data: await getHistory(id, hours) });
  } catch (error) {
    const normalized = error instanceof MonitorError ? toBusinessError(error) : error;
    const { status, payload } = toApiError(normalized, "monitor history");
    return NextResponse.json(payload, { status });
  }
}
