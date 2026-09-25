import "server-only";

import type { RowDataPacket } from "mysql2";
import { getDbPool } from "./db";

/**
 * 订阅拉取记录：所有客户端每次拉取订阅都记一条（含不上报 HWID 的 Clash 系），保留 30 天。
 * 只用于「我的设备」展示最近的拉取情况，不参与设备数限制——同一台设备换网络会显示成多条，
 * 同一网络下多台设备用同一客户端可能合并成一条。
 */

const RETENTION_DAYS = 30;

/** 常见客户端的 User-Agent 特征 → 展示名。按顺序匹配，靠前的更具体：
 *  有些客户端会在 UA 里捎带别家的名字以兼容订阅（如 FlClash 带 clash-verge），所以 Clash Verge 要排在它们后面。 */
const CLIENTS: ReadonlyArray<[RegExp, string]> = [
  [/flclash/i, "FlClash"],
  [/clashmetaforandroid|clash\.meta/i, "Clash Meta for Android"],
  [/clash[-_ ]?nyanpasu/i, "Clash Nyanpasu"],
  [/clashx/i, "ClashX"],
  [/clash[-_ ]?verge/i, "Clash Verge"],
  [/mihomo/i, "Mihomo"],
  [/stash/i, "Stash"],
  [/shadowrocket/i, "Shadowrocket"],
  [/quantumult/i, "Quantumult X"],
  [/surge/i, "Surge"],
  [/loon/i, "Loon"],
  [/hiddify/i, "Hiddify"],
  [/nekobox|nekoray/i, "NekoBox"],
  [/v2raytun/i, "v2RayTun"],
  [/happ/i, "Happ"],
  [/v2rayng/i, "v2rayNG"],
  [/v2rayn/i, "v2rayN"],
  [/streisand/i, "Streisand"],
  [/sing-?box|SFA\/|SFI\/|SFM\//i, "sing-box"],
  [/clash/i, "Clash"],
];

/** 从 User-Agent 解析客户端名称，尽量带上版本号，例如「Clash Verge v2.2.3」。 */
export function parseClientName(userAgent: string): string {
  const ua = userAgent.trim();
  if (!ua) return "未知客户端";
  for (const [pattern, name] of CLIENTS) {
    const match = ua.match(pattern);
    if (!match) continue;
    // 紧跟在特征后面的版本号：clash-verge/v2.2.3、Shadowrocket/2070、Stash/2.4.1
    const version = ua.slice((match.index ?? 0) + match[0].length).match(/^[^/\s]*\/v?(\d+(?:\.\d+){0,3})/i)?.[1];
    return version ? `${name} v${version}` : name;
  }
  if (/mozilla|chrome|safari|firefox/i.test(ua)) return "浏览器";
  // 其他：取第一个「名称/版本」片段，如 okhttp/4.9.3 → okhttp
  return ua.split(/[\s/;(]/)[0].slice(0, 64) || "未知客户端";
}

export type PullInfo = { userAgent: string; ip: string; hasHwid: boolean };

/** 记一条拉取记录，并顺手清掉这个用户 30 天前的记录。失败只打日志，不影响订阅下发。 */
export async function recordSubscriptionPull(userId: number, info: PullInfo): Promise<void> {
  const pool = getDbPool();
  await pool.execute(
    "INSERT INTO subscription_pulls (user_id, client, user_agent, ip, has_hwid) VALUES (?, ?, ?, ?, ?)",
    [userId, parseClientName(info.userAgent), info.userAgent.slice(0, 255) || null, info.ip.slice(0, 45) || null, info.hasHwid ? 1 : 0],
  );
  await pool.execute(
    `DELETE FROM subscription_pulls WHERE user_id = ? AND pulled_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${RETENTION_DAYS} DAY)`,
    [userId],
  );
}

export type SubscriptionPullGroup = {
  client: string;
  ip: string | null;
  userAgent: string | null;
  /** 30 天内拉取次数 */
  times: number;
  first_pulled_at: number;
  last_pulled_at: number;
};

/** 按「客户端 + IP」合并的最近拉取记录，最近的在前。 */
export async function listSubscriptionPulls(userId: number): Promise<SubscriptionPullGroup[]> {
  const [rows] = await getDbPool().execute<RowDataPacket[]>(
    `SELECT client, ip, MAX(user_agent) AS user_agent, COUNT(*) AS times,
            UNIX_TIMESTAMP(MIN(pulled_at)) AS first_at, UNIX_TIMESTAMP(MAX(pulled_at)) AS last_at
       FROM subscription_pulls
      WHERE user_id = ? AND pulled_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${RETENTION_DAYS} DAY)
      GROUP BY client, ip
      ORDER BY last_at DESC
      LIMIT 20`,
    [userId],
  );
  return rows.map((row) => ({
    client: String(row.client),
    ip: row.ip ? String(row.ip) : null,
    userAgent: row.user_agent ? String(row.user_agent) : null,
    times: Number(row.times),
    first_pulled_at: Number(row.first_at),
    last_pulled_at: Number(row.last_at),
  }));
}
