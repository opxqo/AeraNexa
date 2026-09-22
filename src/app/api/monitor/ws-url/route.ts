import { NextResponse } from "next/server";
import { toApiError, unauthenticated } from "@/lib/server/errors";
import { buildWsUrl, MonitorError, toBusinessError } from "@/lib/server/monitor/client";
import { getCurrentUser } from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 返回浏览器可直连的 CF-Server-Monitor 实时通道地址。
 *
 * 仅公开模式（无需凭据）返回 wss 地址；管理员 JWT 模式下返回 null，
 * 因为该 JWT 等同管理员权限，绝不能下发给浏览器，此时前端应回退轮询代理接口。
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) throw unauthenticated();
    const url = await buildWsUrl("all");
    return NextResponse.json({ data: { url } });
  } catch (error) {
    const normalized = error instanceof MonitorError ? toBusinessError(error) : error;
    const { status, payload } = toApiError(normalized, "monitor ws-url");
    return NextResponse.json(payload, { status });
  }
}
