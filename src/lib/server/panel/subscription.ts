import "server-only";

import { getSetting } from "../settings";

const MAX_SUBSCRIPTION_BYTES = 2 * 1024 * 1024;

export class PanelSubscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PanelSubscriptionError";
  }
}

/** 构造 3x-ui 的 Clash/Mihomo 配置地址，不接受任意用户输入的路径。 */
export function buildPanelClashUrl(panelBaseUrl: string, configuredUrl: string, subId: string): string {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(subId)) throw new PanelSubscriptionError("3x-ui 订阅标识格式无效");
  let prefix: URL;
  try {
    if (configuredUrl) {
      prefix = new URL(configuredUrl);
    } else {
      const panel = new URL(panelBaseUrl);
      prefix = new URL("/mihomo/", panel.origin);
    }
  } catch {
    throw new PanelSubscriptionError("3x-ui 订阅地址未配置或格式无效");
  }
  if (prefix.protocol !== "http:" && prefix.protocol !== "https:") throw new PanelSubscriptionError("3x-ui 订阅地址协议不受支持");
  if (!prefix.pathname.endsWith("/")) prefix.pathname += "/";
  return new URL(encodeURIComponent(subId), prefix).toString();
}

/**
 * 从 3x-ui 拉取已配置的 Clash/Mihomo YAML。仅由订阅服务在完成用户鉴权后调用；
 * 不转发浏览器 Cookie、令牌或用户原始请求头，响应头则由 AeraNexa 统一重写。
 */
export async function fetchPanelClashSubscription(subId: string): Promise<string> {
  const [panelBaseUrl, configuredUrl] = await Promise.all([
    getSetting("panel.base_url"),
    getSetting("subscribe.panel_clash_url"),
  ]);
  if (!panelBaseUrl) throw new PanelSubscriptionError("未配置 3x-ui 面板地址");
  const url = buildPanelClashUrl(panelBaseUrl, configuredUrl, subId);
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "text/yaml, application/yaml, text/plain;q=0.8" },
    });
  } catch {
    throw new PanelSubscriptionError("无法连接 3x-ui Clash/Mihomo 订阅服务");
  }
  if (!response.ok) throw new PanelSubscriptionError(`3x-ui Clash/Mihomo 订阅服务返回 HTTP ${response.status}`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_SUBSCRIPTION_BYTES) {
    throw new PanelSubscriptionError("3x-ui Clash/Mihomo 配置超过大小上限");
  }
  const body = await response.text();
  if (!body.trim()) throw new PanelSubscriptionError("3x-ui Clash/Mihomo 配置为空");
  if (Buffer.byteLength(body, "utf8") > MAX_SUBSCRIPTION_BYTES) throw new PanelSubscriptionError("3x-ui Clash/Mihomo 配置超过大小上限");
  return body;
}
