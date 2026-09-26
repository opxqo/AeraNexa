import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/server/audit";
import { clientIp } from "@/lib/server/email-verification";
import { EnrollmentError, enrollNode } from "@/lib/server/panel/node-enrollment";
import { toApiError } from "@/lib/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 3x-node 一键安装回调（`3x-ui-node enroll`）。无登录态，凭一次性注册码认证。
 * 响应沿用节点 API 的 `{ success, msg, obj }`，节点只认这个形状。
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, msg: "请求体必须是 JSON 对象", obj: null }, { status: 400 });
  }
  try {
    const result = await enrollNode(body, clientIp(request));
    await recordAudit({ action: "node.enrolled", resourceType: "node_panel_connection", resourceId: result.connectionId, request, context: { name: result.name } });
    return NextResponse.json({ success: true, msg: `已登记为「${result.name}」（#${result.connectionId}），等待管理员在 AN 后台启用`, obj: { connectionId: result.connectionId } });
  } catch (error) {
    if (error instanceof EnrollmentError) {
      return NextResponse.json({ success: false, msg: error.message, obj: null }, { status: error.status });
    }
    const { status, payload } = toApiError(error, "node enroll");
    return NextResponse.json({ success: false, msg: payload.message, obj: null }, { status });
  }
}
