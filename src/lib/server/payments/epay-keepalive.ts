import "server-only";

import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import type { RowDataPacket } from "mysql2";
import { recordAudit } from "../audit";
import { getDbPool } from "../db";
import { getNumberSetting, getSetting } from "../settings";
import { callEpayApi, postEpayMapi } from "./epay-api";
import { getEpayConfig } from "./epay-config";
import { buildEpayMapiParams, EPAY_TEST_PREFIX, epayTypeOf, parseEpayMapiResponse, parseEpayOrderQuery } from "./epay-protocol";
import { resolveChannel } from "./epay-test";

/**
 * 易支付商户保活：渠道条款规定商户号连续 5 天没有账单会被封禁，未支付的「白账单」也算。
 * worker 定期检查，距上一张保活账单超过间隔就通过 API 接口 mapi.php 下一笔 1 元的单（不付款），
 * 再用 act=order 确认网关确实记录了这笔单，确认后才写审计，否则下一轮重试。
 * 不能用 submit.php：那是给浏览器跳转收银台的，服务器单独请求它渠道不会建单（实测 act=order 查不到）。
 * 开关与间隔在后台「支付管理 → 商户保活」调整（同时出现在系统设置的支付分组）。
 *
 * 单号用测试单前缀：万一有人付款，通知会落到测试单处理逻辑，查不到测试记录直接拒绝，不影响真实订单。
 * 本文件会被 worker 引用（Node 剥离类型运行），只能使用可擦除的 TS 语法。
 */

const CREATED_ACTION = "payment.epay_keepalive_created" as const;
/** 渠道规定单笔最小支付金额 1 元（mapi.php 返回「最小支付金额是1元」）；只下单不付款，不产生扣款。 */
const KEEPALIVE_AMOUNT_CENTS = 100;
const KEEPALIVE_PREFIX = `${EPAY_TEST_PREFIX}K`;
/** 渠道条款：连续这么久没有账单就可能被封。 */
export const EPAY_BAN_AFTER_SECONDS = 5 * 24 * 3600;
const HISTORY_LIMIT = 10;

export const KEEPALIVE_SETTING_KEYS = {
  enabled: "payment.epay.keepalive_enabled",
  intervalHours: "payment.epay.keepalive_interval_hours",
} as const;

async function readKeepaliveSettings() {
  const [enabled, intervalHours] = await Promise.all([
    getSetting(KEEPALIVE_SETTING_KEYS.enabled),
    getNumberSetting(KEEPALIVE_SETTING_KEYS.intervalHours),
  ]);
  return { enabled: enabled === "true", intervalHours };
}

async function secondsSinceLastKeepalive(): Promise<number | null> {
  const [rows] = await getDbPool().execute<RowDataPacket[]>(
    `SELECT TIMESTAMPDIFF(SECOND, MAX(created_at), CURRENT_TIMESTAMP) AS age FROM audit_logs WHERE action = ?`,
    [CREATED_ACTION],
  );
  const age = rows[0]?.age;
  return age === null || age === undefined ? null : Number(age);
}

/** 优先用已启用的渠道；渠道全停用时商户号仍需保活，退而用任一配置齐全的易支付渠道。 */
async function pickChannel(): Promise<{ id: number; name: string; provider: string; enabled: boolean } | null> {
  const [rows] = await getDbPool().query<RowDataPacket[]>(
    `SELECT pm.id, pm.name, pm.provider, pm.is_enabled
       FROM payment_methods pm
       INNER JOIN payment_method_credentials pmc ON pmc.payment_method_id = pm.id
      WHERE pm.provider LIKE 'epay\\_%' AND pm.notify_domain IS NOT NULL AND pm.notify_domain <> ''
      ORDER BY pm.is_enabled DESC, pm.sort_order ASC, pm.id ASC`,
  );
  const row = rows.find((item) => epayTypeOf(String(item.provider)));
  return row ? { id: Number(row.id), name: String(row.name), provider: String(row.provider), enabled: Boolean(row.is_enabled) } : null;
}

/** mapi.php 要求传发起方 IP；保活单由本站服务器发起，取回调域名解析出的地址，解析失败时退回本机地址。 */
async function siteIp(notifyBase: string): Promise<string> {
  try {
    return (await lookup(new URL(notifyBase).hostname, { family: 4 })).address;
  } catch {
    return "127.0.0.1";
  }
}

async function createKeepaliveBill(adminId: number | null): Promise<string> {
  const picked = await pickChannel();
  if (!picked) throw new Error("没有配置齐全（商户密钥 + 回调域名）的易支付渠道");
  const channel = await resolveChannel(picked.id);

  const merchant = await callEpayApi(channel.gatewayUrl, { act: "query", pid: channel.pid, key: channel.key });
  if (Number(merchant.code) !== 1) throw new Error(`商户查询失败：${String(merchant.msg ?? "商户号或密钥不正确")}`);
  if (Number(merchant.active) !== 1) throw new Error(`商户状态异常（active=${String(merchant.active)}），可能已被封禁，请联系渠道客服`);

  const outTradeNo = `${KEEPALIVE_PREFIX}${randomBytes(10).toString("hex").toUpperCase()}`;
  const params = buildEpayMapiParams({
    gatewayUrl: channel.gatewayUrl,
    pid: channel.pid,
    key: channel.key,
    type: channel.type,
    outTradeNo,
    amountCents: KEEPALIVE_AMOUNT_CENTS,
    name: "AeraNexa 账户保活",
    notifyUrl: `${channel.notifyBase}/api/payments/epay/notify`,
    returnUrl: `${channel.notifyBase}/api/payments/epay/return`,
    clientIp: await siteIp(channel.notifyBase),
  });
  let created: { tradeNo: string };
  try {
    created = parseEpayMapiResponse(await postEpayMapi(channel.gatewayUrl, params));
  } catch (error) {
    throw new Error(`网关下单失败：${error instanceof Error ? error.message : String(error)}`);
  }

  const order = await callEpayApi(channel.gatewayUrl, { act: "order", pid: channel.pid, key: channel.key, trade_no: created.tradeNo });
  let tradeNo: string;
  try {
    tradeNo = parseEpayOrderQuery(order).tradeNo;
  } catch (error) {
    throw new Error(`网关未记录保活账单 ${outTradeNo}：${error instanceof Error ? error.message : String(error)}`);
  }

  await recordAudit({
    action: CREATED_ACTION,
    userId: adminId,
    resourceType: "epay_keepalive",
    resourceId: outTradeNo,
    context: { methodId: channel.id, channelName: channel.name, provider: channel.provider, amountCents: KEEPALIVE_AMOUNT_CENTS, epayTradeNo: tradeNo, manual: adminId !== null },
  });
  return `已在「${channel.name}」创建保活账单 ${outTradeNo}（渠道单号 ${tradeNo}）`;
}

/** worker 调用：停用、未到期或未配置易支付时返回 null；成功返回摘要；网关异常时抛错，由 worker 记录并下一轮重试。 */
export async function runEpayKeepalive(): Promise<string | null> {
  const settings = await readKeepaliveSettings();
  if (!settings.enabled) return null;
  const age = await secondsSinceLastKeepalive();
  if (age !== null && age < settings.intervalHours * 3600) return null;
  if (!(await pickChannel())) return null;
  return createKeepaliveBill(null);
}

/** 后台手动补一张：忽略开关与间隔，失败直接把原因抛给页面。 */
export async function createEpayKeepaliveNow(adminId: number): Promise<string> {
  return createKeepaliveBill(adminId);
}

export type EpayKeepaliveBill = {
  outTradeNo: string;
  epayTradeNo: string;
  channelName: string;
  manual: boolean;
  createdAt: string;
};

export type EpayKeepaliveOverview = {
  enabled: boolean;
  intervalHours: number;
  configError: string | null;
  channel: { name: string; provider: string; enabled: boolean } | null;
  /** 距上一张保活账单的秒数；从未创建为 null。 */
  lastBillAgoSeconds: number | null;
  /** 距下次自动下单的秒数，≤0 表示已到期、等待 worker 下一次检查。 */
  nextDueInSeconds: number | null;
  /** 距 5 天封号期限的秒数（按最后一张保活账单计算）。 */
  banDeadlineInSeconds: number | null;
  worker: { alive: boolean; lastCheckAgoSeconds: number | null; ok: boolean; summary: string; error: string };
  history: EpayKeepaliveBill[];
};

function formatTime(value: Date | string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

/** worker 最近一次完成任何任务超过这么久视为未运行（保活检查每小时一次，不能单看它）。 */
const WORKER_STALE_SECONDS = 300;

export async function getEpayKeepaliveOverview(): Promise<EpayKeepaliveOverview> {
  const pool = getDbPool();
  let configError: string | null = null;
  await getEpayConfig().catch((error: unknown) => {
    configError = error instanceof Error ? error.message : "易支付未配置";
  });
  const [settings, channel, lastBillAgoSeconds, [historyRows], [runRows], [aliveRows]] = await Promise.all([
    readKeepaliveSettings(),
    pickChannel(),
    secondsSinceLastKeepalive(),
    pool.execute<RowDataPacket[]>(
      `SELECT resource_id, context, created_at FROM audit_logs WHERE action = ? ORDER BY id DESC LIMIT ${HISTORY_LIMIT}`,
      [CREATED_ACTION],
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT last_ok, last_summary, last_error, TIMESTAMPDIFF(SECOND, last_finished_at, CURRENT_TIMESTAMP) AS ago
         FROM worker_runs WHERE task = 'epay_keepalive'`,
    ),
    pool.query<RowDataPacket[]>("SELECT MIN(TIMESTAMPDIFF(SECOND, last_finished_at, CURRENT_TIMESTAMP)) AS age FROM worker_runs"),
  ]);

  const run = runRows[0];
  const workerAge = aliveRows[0]?.age;
  return {
    enabled: settings.enabled,
    intervalHours: settings.intervalHours,
    configError,
    channel: channel ? { name: channel.name, provider: channel.provider, enabled: channel.enabled } : null,
    lastBillAgoSeconds,
    nextDueInSeconds: lastBillAgoSeconds === null ? 0 : settings.intervalHours * 3600 - lastBillAgoSeconds,
    banDeadlineInSeconds: lastBillAgoSeconds === null ? null : EPAY_BAN_AFTER_SECONDS - lastBillAgoSeconds,
    worker: {
      alive: workerAge !== null && workerAge !== undefined && Number(workerAge) <= WORKER_STALE_SECONDS,
      lastCheckAgoSeconds: run ? Math.max(0, Number(run.ago)) : null,
      ok: run ? Boolean(Number(run.last_ok)) : false,
      summary: run?.last_summary ? String(run.last_summary) : "",
      error: run?.last_error ? String(run.last_error) : "",
    },
    history: historyRows.map((row) => {
      const context = typeof row.context === "string" ? JSON.parse(row.context) : row.context ?? {};
      return {
        outTradeNo: String(row.resource_id),
        epayTradeNo: String(context.epayTradeNo ?? ""),
        channelName: String(context.channelName ?? ""),
        manual: Boolean(context.manual),
        createdAt: formatTime(row.created_at),
      };
    }),
  };
}
