import { NextResponse } from "next/server";
import { badRequest, readJsonBody, toApiError, unauthenticated } from "@/lib/server/errors";
import { isAuthorizedTrafficReport, parseTrafficReport, recordTraffic } from "@/lib/server/traffic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 节点流量上报。
 *
 * 这是 `user_traffic_records` / `node_traffic_records` 目前**唯一的写入方**——
 * 两张表建好后一直只有读取（`/api/client/traffic`），没有写入，所以「流量明细」
 * 页面永远是空的。
 *
 * 认证用共享密钥（环境变量 `NODE_TRAFFIC_SECRET`），而不是每节点令牌：
 * 现阶段 `nodes` 表既没有面板地址也没有令牌字段，为了接入上报去改表结构不划算；
 * 共享密钥是面板无关的，将来接任何面板都不用再动表。
 *
 * 请求体（两个数组至少有一个非空）：
 *
 * ```json
 * {
 *   "records": [
 *     { "user_id": 1, "node_id": 2, "upload_bytes": 1024, "download_bytes": 2048,
 *       "server_rate": 1.5, "record_type": "day", "record_at": "2026-09-19" }
 *   ],
 *   "node_records": [
 *     { "node_id": 2, "upload_bytes": 1024, "download_bytes": 2048, "record_at": "2026-09-19" }
 *   ]
 * }
 * ```
 *
 * 语义说明：
 * - `upload_bytes` / `download_bytes` 是**增量**，同一个桶重复上报会累加，不会覆盖；
 * - `record_at` 缺偏移量时按东八区理解，并按 `record_type` 归一到桶起点；
 * - `record_type` 支持 hour / day / month，默认 day。
 */
export async function POST(request: Request) {
  try {
    if (!isAuthorizedTrafficReport(request)) throw unauthenticated("上报凭据缺失或不正确");

    const body = await readJsonBody(request);
    if (!("records" in body) && !("node_records" in body)) {
      throw badRequest("请求体需包含 records 或 node_records");
    }

    const input = parseTrafficReport(body);
    const result = await recordTraffic(input);
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    const { status, payload } = toApiError(error, "node traffic report");
    return NextResponse.json(payload, { status });
  }
}
