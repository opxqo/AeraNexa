/**
 * 易支付（彩虹易支付 EPay 协议）签名与报文处理。
 * 纯函数、零依赖，便于单测；网络与数据库交互在调用方。
 *
 * 协议要点（对照渠道开发文档 doc.html）：
 * - 签名：参数按键名升序，剔除 sign / sign_type / 空值，拼成 k=v&k=v 后直接追加商户密钥，取 md5 小写。
 * - 下单走页面跳转 submit.php；渠道明确不建议用 mapi.php。
 * - 异步通知：GET 请求，字段 pid/trade_no/out_trade_no/type/name/money/trade_status/param/sign/sign_type，
 *   响应体必须是纯文本 success。
 * - return_url 跳转时携带同一套已签名参数，可作为通知丢失时的补偿入口。
 */
import { createHash, timingSafeEqual } from "node:crypto";

export const EPAY_PAY_TYPES = ["wxpay", "alipay"] as const;
export type EpayPayType = (typeof EPAY_PAY_TYPES)[number];

const PROVIDER_PREFIX = "epay_";

/** 渠道标识 epay_wxpay / epay_alipay → epay 支付类型；其它渠道返回 null。 */
export function epayTypeOf(provider: string): EpayPayType | null {
  if (!provider.startsWith(PROVIDER_PREFIX)) return null;
  const type = provider.slice(PROVIDER_PREFIX.length);
  return (EPAY_PAY_TYPES as readonly string[]).includes(type) ? (type as EpayPayType) : null;
}

export function epayProviderOf(type: string): string | null {
  return (EPAY_PAY_TYPES as readonly string[]).includes(type) ? `${PROVIDER_PREFIX}${type}` : null;
}

export function epaySign(params: Record<string, string>, key: string): string {
  const content = Object.keys(params)
    .filter((name) => name !== "sign" && name !== "sign_type" && params[name] !== "")
    .sort()
    .map((name) => `${name}=${params[name]}`)
    .join("&");
  return createHash("md5").update(content + key, "utf8").digest("hex");
}

export function verifyEpaySign(params: Record<string, string>, key: string): boolean {
  const actual = params.sign ?? "";
  if (!/^[a-f0-9]{32}$/i.test(actual)) return false;
  const expected = Buffer.from(epaySign(params, key), "hex");
  return timingSafeEqual(Buffer.from(actual.toLowerCase(), "hex"), expected);
}

export function centsToYuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** "12.3" → 1230；格式不合法返回 null，避免浮点误差把金额比对放宽。 */
export function yuanToCents(yuan: string): number | null {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(yuan.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

type SubmitInput = {
  gatewayUrl: string;
  pid: string;
  key: string;
  type: EpayPayType;
  outTradeNo: string;
  amountCents: number;
  name: string;
  notifyUrl: string;
  returnUrl: string;
  clientIp?: string;
};

/** 生成页面跳转支付地址（GET submit.php），用户在渠道收银台付款。 */
export function buildEpaySubmitUrl(input: SubmitInput): string {
  const params: Record<string, string> = {
    pid: input.pid,
    type: input.type,
    out_trade_no: input.outTradeNo,
    notify_url: input.notifyUrl,
    return_url: input.returnUrl,
    name: input.name,
    money: centsToYuan(input.amountCents),
    clientip: input.clientIp ?? "",
  };
  if (!params.clientip) delete params.clientip;
  const url = new URL("submit.php", input.gatewayUrl.endsWith("/") ? input.gatewayUrl : `${input.gatewayUrl}/`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set("sign", epaySign(params, input.key));
  url.searchParams.set("sign_type", "MD5");
  return url.toString();
}

export type EpayNotice = {
  provider: string;
  epayTradeNo: string;
  outTradeNo: string;
  amountCents: number;
};

/** 校验通知字段形状（不含验签）；不合法返回 null。 */
export function parseEpayNotice(params: Record<string, string>, expectedPid: string): EpayNotice | null {
  if (params.pid !== expectedPid || params.trade_status !== "TRADE_SUCCESS") return null;
  const provider = epayProviderOf(params.type ?? "");
  const amountCents = yuanToCents(params.money ?? "");
  const epayTradeNo = (params.trade_no ?? "").trim();
  const outTradeNo = (params.out_trade_no ?? "").trim();
  if (!provider || !amountCents || !epayTradeNo || epayTradeNo.length > 64 || !outTradeNo || outTradeNo.length > 255) return null;
  return { provider, epayTradeNo, outTradeNo, amountCents };
}

/** 后台支付测试台发起的测试单前缀；真实订单用 EP 前缀，二者互不干扰。 */
export const EPAY_TEST_PREFIX = "ET";

export function isEpayTestTradeNo(outTradeNo: string): boolean {
  return outTradeNo.startsWith(EPAY_TEST_PREFIX);
}

export type EpayOrderQuery = {
  paid: boolean;
  tradeNo: string;
  type: string;
  amountCents: number | null;
  paidAt: string | null;
};

/** 解析 api.php?act=order 的返回；status 1 为已支付、0 为未支付。code 不为 1 时抛出渠道给的提示。 */
export function parseEpayOrderQuery(body: Record<string, unknown>): EpayOrderQuery {
  if (Number(body.code) !== 1) throw new Error(String(body.msg ?? "渠道查询失败"));
  const paid = Number(body.status) === 1;
  return {
    paid,
    tradeNo: String(body.trade_no ?? ""),
    type: String(body.type ?? ""),
    amountCents: yuanToCents(String(body.money ?? "")),
    paidAt: paid && body.endtime ? String(body.endtime) : null,
  };
}
