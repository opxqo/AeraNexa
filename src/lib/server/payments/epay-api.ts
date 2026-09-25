import "server-only";

import { unavailable } from "../errors";

function gatewayEndpoint(gatewayUrl: string, path: string): URL {
  return new URL(path, gatewayUrl.endsWith("/") ? gatewayUrl : `${gatewayUrl}/`);
}

async function readJson(request: Promise<Response>): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await request;
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

/**
 * 调用易支付 api.php（商户信息、订单查询等）。
 * 该接口以明文 key 鉴权，只能在服务端调用；返回前剔除 key，避免被带到前端或日志。
 * 渠道只从查询串读取 act（POST 表单会返回 "No Act!"），所以用 GET。
 * 本文件会被 worker 引用（Node 剥离类型运行），只能使用可擦除的 TS 语法。
 */
export async function callEpayApi(gatewayUrl: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const url = gatewayEndpoint(gatewayUrl, "api.php");
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return readJson(fetch(url, { signal: AbortSignal.timeout(10_000), cache: "no-store" }));
}

/** API 接口下单（POST mapi.php，表单编码），参数需已签名；返回渠道原始 JSON。 */
export async function postEpayMapi(gatewayUrl: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  return readJson(fetch(gatewayEndpoint(gatewayUrl, "mapi.php"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  }));
}
