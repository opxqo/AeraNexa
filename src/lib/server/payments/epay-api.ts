import "server-only";

import { unavailable } from "../errors";

/**
 * 调用易支付 api.php（商户信息、订单查询等）。
 * 该接口以明文 key 鉴权，只能在服务端调用；返回前剔除 key，避免被带到前端或日志。
 * 渠道只从查询串读取 act（POST 表单会返回 "No Act!"），所以用 GET。
 * 本文件会被 worker 引用（Node 剥离类型运行），只能使用可擦除的 TS 语法。
 */
export async function callEpayApi(gatewayUrl: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const url = new URL("api.php", gatewayUrl.endsWith("/") ? gatewayUrl : `${gatewayUrl}/`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
  } catch (error) {
    throw unavailable(`无法连接易支付网关：${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await response.text();
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    delete body.key;
    return body;
  } catch {
    throw unavailable(`网关返回非 JSON（HTTP ${response.status}）：${text.slice(0, 120)}`);
  }
}
