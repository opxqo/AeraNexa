import { NextResponse } from "next/server";
import { toApiError, unauthenticated } from "@/lib/server/errors";
import { listServers, MonitorError, toBusinessError } from "@/lib/server/monitor/client";
import { getCurrentUser } from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 节点状态页数据源：服务端代理 CF-Server-Monitor 的 /api/servers。
 * 管理员 JWT 只存在于服务端，浏览器拿到的是本接口裁剪后的 JSON。
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) throw unauthenticated();
    return NextResponse.json({ data: await listServers() });
  } catch (error) {
    const normalized = error instanceof MonitorError ? toBusinessError(error) : error;
    const { status, payload } = toApiError(normalized, "monitor servers");
    return NextResponse.json(payload, { status });
  }
}
