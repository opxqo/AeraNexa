import "server-only";

import { randomBytes } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { recordAudit } from "../audit";
import { getDbPool } from "../db";
import { badRequest, notFound, unavailable } from "../errors";
import { getPaymentCallbackSecret } from "../payment-credentials";
import { getEpayConfig } from "./epay-config";
import {
  buildEpaySubmitUrl,
  EPAY_TEST_PREFIX,
  epayTypeOf,
  parseEpayOrderQuery,
  verifyEpaySign,
  type EpayNotice,
} from "./epay-protocol";

/**
 * 后台「支付测试台」的易支付真实联调：商户连通性、发起测试支付、查询渠道订单状态、确认异步通知已到达。
 * 测试单只写审计日志，不建订单、不入账、不履约；回调走和真实订单相同的 notify / return 地址。
 */

const CREATED_ACTION = "admin.payment_epay_test_created" as const;
const NOTIFIED_ACTION = "payment.epay_test_notified" as const;
const MIN_TEST_CENTS = 1;
const MAX_TEST_CENTS = 100_000;

export type EpayTestChannel = {
  id: number;
  name: string;
  provider: string;
  enabled: boolean;
  notifyDomain: string;
  hasKey: boolean;
};

export type EpayTestOverview = {
  gatewayUrl: string;
  pid: string;
  configError: string | null;
  channels: EpayTestChannel[];
};

export async function getEpayTestOverview(): Promise<EpayTestOverview> {
  let gatewayUrl = "";
  let pid = "";
  let configError: string | null = null;
  try {
    ({ gatewayUrl, pid } = await getEpayConfig());
  } catch (error) {
    configError = error instanceof Error ? error.message : "易支付未配置";
  }
  const [rows] = await getDbPool().query<RowDataPacket[]>(
    `SELECT pm.id, pm.name, pm.provider, pm.is_enabled, pm.notify_domain, pmc.payment_method_id AS credential_id
       FROM payment_methods pm
       LEFT JOIN payment_method_credentials pmc ON pmc.payment_method_id = pm.id
      WHERE pm.provider LIKE 'epay\\_%'
      ORDER BY pm.sort_order ASC, pm.id ASC`,
  );
  const channels = rows
    .filter((row) => epayTypeOf(String(row.provider)))
    .map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      provider: String(row.provider),
      enabled: Boolean(row.is_enabled),
      notifyDomain: row.notify_domain ? String(row.notify_domain) : "",
      hasKey: row.credential_id !== null,
    }));
  return { gatewayUrl, pid, configError, channels };
}

async function resolveChannel(methodId: number) {
  const [rows] = await getDbPool().execute<RowDataPacket[]>(
    "SELECT id, name, provider, notify_domain FROM payment_methods WHERE id = ? LIMIT 1",
    [methodId],
  );
  const row = rows[0];
  const type = row ? epayTypeOf(String(row.provider)) : null;
  if (!row || !type) throw notFound("易支付渠道不存在");
  const name = String(row.name);
  const notifyBase = row.notify_domain ? String(row.notify_domain).replace(/\/+$/, "") : "";
  if (!notifyBase) throw unavailable(`支付渠道「${name}」未配置回调域名`);
  const key = await getPaymentCallbackSecret(methodId, String(row.provider));
  if (!key) throw unavailable(`支付渠道「${name}」未配置商户密钥`);
  const { gatewayUrl, pid } = await getEpayConfig();
  return { id: methodId, name, provider: String(row.provider), type, notifyBase, key, gatewayUrl, pid };
}

/** 调用 api.php：该接口以明文 key 鉴权，只能在服务端调用，返回给前端前必须剔除 key。 */
async function callEpayApi(gatewayUrl: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const url = new URL("api.php", gatewayUrl.endsWith("/") ? gatewayUrl : `${gatewayUrl}/`);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
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

export type EpayMerchantCheck = {
  active: boolean;
  balance: string;
  orders: number;
  ordersToday: number;
};

/** act=query：只读查询商户信息，用来验证网关地址、商户号、密钥三者是否匹配。 */
export async function checkEpayMerchant(methodId: number): Promise<EpayMerchantCheck> {
  const channel = await resolveChannel(methodId);
  const body = await callEpayApi(channel.gatewayUrl, { act: "query", pid: channel.pid, key: channel.key });
  if (Number(body.code) !== 1) throw badRequest(`网关拒绝：${String(body.msg ?? "商户号或密钥不正确")}`);
  return {
    active: Number(body.active) === 1,
    balance: String(body.money ?? "0.00"),
    orders: Number(body.orders ?? 0),
    ordersToday: Number(body.order_today ?? 0),
  };
}

export async function createEpayTestPayment(methodId: number, amountCents: number, adminId: number) {
  if (!Number.isInteger(amountCents) || amountCents < MIN_TEST_CENTS || amountCents > MAX_TEST_CENTS) {
    throw badRequest("测试金额需在 0.01 到 1000.00 元之间");
  }
  const channel = await resolveChannel(methodId);
  const outTradeNo = `${EPAY_TEST_PREFIX}${randomBytes(10).toString("hex").toUpperCase()}`;
  const payUrl = buildEpaySubmitUrl({
    gatewayUrl: channel.gatewayUrl,
    pid: channel.pid,
    key: channel.key,
    type: channel.type,
    outTradeNo,
    amountCents,
    name: "AeraNexa 支付测试",
    notifyUrl: `${channel.notifyBase}/api/payments/epay/notify`,
    returnUrl: `${channel.notifyBase}/api/payments/epay/return`,
  });
  await recordAudit({
    action: CREATED_ACTION,
    userId: adminId,
    resourceType: "epay_test",
    resourceId: outTradeNo,
    context: { methodId, provider: channel.provider, amountCents },
  });
  return { outTradeNo, payUrl, notifyUrl: `${channel.notifyBase}/api/payments/epay/notify` };
}

type TestRecord = { methodId: number; amountCents: number; createdAt: string };

async function findTestRecord(outTradeNo: string): Promise<TestRecord | null> {
  const [rows] = await getDbPool().execute<RowDataPacket[]>(
    `SELECT context, created_at FROM audit_logs WHERE action = ? AND resource_id = ? ORDER BY id DESC LIMIT 1`,
    [CREATED_ACTION, outTradeNo],
  );
  if (!rows[0]) return null;
  const context = typeof rows[0].context === "string" ? JSON.parse(rows[0].context) : rows[0].context;
  return { methodId: Number(context.methodId), amountCents: Number(context.amountCents), createdAt: String(rows[0].created_at) };
}

export type EpayTestNotification = { source: string; verified: boolean; amountMatches: boolean; receivedAt: string };

export type EpayTestStatus = {
  outTradeNo: string;
  channelName: string;
  amountCents: number;
  createdAt: string;
  gateway: { paid: boolean; tradeNo: string; amountCents: number | null; paidAt: string | null } | null;
  gatewayError: string | null;
  notifications: EpayTestNotification[];
};

export async function getEpayTestStatus(outTradeNo: string): Promise<EpayTestStatus> {
  const record = await findTestRecord(outTradeNo);
  if (!record) throw notFound("测试单不存在");
  const channel = await resolveChannel(record.methodId);

  let gateway: EpayTestStatus["gateway"] = null;
  let gatewayError: string | null = null;
  try {
    const body = await callEpayApi(channel.gatewayUrl, { act: "order", pid: channel.pid, key: channel.key, out_trade_no: outTradeNo });
    const parsed = parseEpayOrderQuery(body);
    gateway = { paid: parsed.paid, tradeNo: parsed.tradeNo, amountCents: parsed.amountCents, paidAt: parsed.paidAt };
  } catch (error) {
    // 用户还没打开收银台时渠道里没有这笔单，查询会报「订单不存在」，属于正常状态。
    gatewayError = error instanceof Error ? error.message : String(error);
  }

  const [rows] = await getDbPool().execute<RowDataPacket[]>(
    `SELECT context, created_at FROM audit_logs WHERE action = ? AND resource_id = ? ORDER BY id ASC LIMIT 20`,
    [NOTIFIED_ACTION, outTradeNo],
  );
  const notifications = rows.map((row) => {
    const context = typeof row.context === "string" ? JSON.parse(row.context) : row.context;
    return {
      source: String(context.source),
      verified: Boolean(context.verified),
      amountMatches: Boolean(context.amountMatches),
      receivedAt: String(row.created_at),
    };
  });

  return { outTradeNo, channelName: channel.name, amountCents: record.amountCents, createdAt: record.createdAt, gateway, gatewayError, notifications };
}

/** 测试单的异步通知 / 同步跳转：只验签并记审计，不触碰订单。返回是否应答 success。 */
export async function handleEpayTestNotice(
  notice: EpayNotice,
  params: Record<string, string>,
  source: "notify" | "return",
): Promise<boolean> {
  const record = await findTestRecord(notice.outTradeNo);
  if (!record) return false;
  let verified = false;
  try {
    const channel = await resolveChannel(record.methodId);
    verified = verifyEpaySign(params, channel.key);
  } catch {
    verified = false;
  }
  const amountMatches = notice.amountCents === record.amountCents;
  await recordAudit({
    action: NOTIFIED_ACTION,
    resourceType: "epay_test",
    resourceId: notice.outTradeNo,
    context: { source, verified, amountMatches, epayTradeNo: notice.epayTradeNo, amountCents: notice.amountCents },
  });
  return verified;
}
