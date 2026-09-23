import "server-only";

import { unavailable } from "../errors";
import { getSetting } from "../settings";

/** 易支付网关地址与商户号在后台「系统设置 → 支付」配置；商户密钥在支付渠道的「回调签名密钥」加密保存。 */
export async function getEpayConfig() {
  const gatewayUrl = (await getSetting("payment.epay.gateway_url")).trim();
  const pid = (await getSetting("payment.epay.pid")).trim();
  if (!/^https?:\/\/.+/i.test(gatewayUrl) || !/^\d+$/.test(pid)) {
    throw unavailable("易支付未配置：请在「系统设置 → 支付」填写网关地址与商户号");
  }
  return { gatewayUrl, pid };
}
