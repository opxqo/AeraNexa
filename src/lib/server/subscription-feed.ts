import "server-only";

import type { RowDataPacket } from "mysql2";
import { getDbPool } from "./db";
import { deviceGateHeaders, gateDevice, type DeviceInfo } from "./devices";
import { PANEL_NAME } from "./panel/import-inbounds";
import { buildClashProxy, clashNoticeProxy, renderClashConfig } from "./panel/clash";
import { buildLink, noticeLink, type LinkNode } from "./panel/links";
import { isEligible, SYNC_PROTOCOLS } from "./panel/sync-model";

/**
 * 用户订阅（docs/node-domain-design.md §4.6）。
 *
 * 数据全部来自本地库，不实时调用 3x-ui：节点参数取自导入时的入站快照，
 * 用户身份即 users.uuid（与同步到 3x-ui 的客户端一致）。
 * 格式：Base64（v2rayN / Shadowrocket 通用）与 Clash / Mihomo YAML。
 */

export type SubscriptionFormat = "base64" | "clash";

const TOKEN_PATTERN = /^[a-f0-9]{32}$/;

export type SubscriptionFeed = {
  body: string;
  contentType: string;
  /** 设备登记结果等附加响应头。 */
  headers: Record<string, string>;
  userInfo: { upload: number; download: number; total: number; expire: number };
};

type UserRow = RowDataPacket & {
  id: number;
  uuid: string;
  is_active: number;
  plan_id: number | null;
  expired_at: number | null;
  transfer_enable: number;
  upload_bytes: number;
  download_bytes: number;
  group_id: number | null;
  device_limit: number;
};

function reasonFor(user: UserRow, nowSeconds: number, hasNodes: boolean): string {
  if (!user.is_active) return "账户已停用，请联系客服";
  if (user.plan_id === null) return "尚未订阅套餐，请先购买";
  if (user.expired_at !== null && Number(user.expired_at) <= nowSeconds) return "套餐已到期，请续费";
  if (Number(user.transfer_enable) <= 0 || Number(user.upload_bytes) + Number(user.download_bytes) >= Number(user.transfer_enable)) {
    return "流量已用尽，请重置流量或升级套餐";
  }
  return hasNodes ? "当前客户端不支持可用节点的协议，请更换客户端" : "暂无可用节点，请稍后刷新或联系客服";
}

/** token 不存在时返回 null（路由返回 404，不区分「格式错」与「查无此人」）。 */
export async function getSubscriptionFeed(
  token: string,
  format: SubscriptionFormat = "base64",
  device: DeviceInfo | null = null,
): Promise<SubscriptionFeed | null> {
  if (!TOKEN_PATTERN.test(token)) return null;

  const pool = getDbPool();
  const [users] = await pool.execute<UserRow[]>(
    `SELECT u.id, u.uuid, u.is_active, u.plan_id, u.expired_at, u.transfer_enable,
            u.upload_bytes, u.download_bytes, p.group_id,
            COALESCE(u.device_limit_override, p.device_limit, 0) AS device_limit
       FROM users u
       LEFT JOIN plans p ON p.id = u.plan_id
      WHERE u.subscription_token = ?
      LIMIT 1`,
    [token],
  );
  const user = users[0];
  if (!user) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const upload = Number(user.upload_bytes);
  const download = Number(user.download_bytes);
  const userInfo = {
    upload,
    download,
    total: Number(user.transfer_enable),
    expire: user.expired_at === null ? 0 : Number(user.expired_at),
  };

  const eligible = isEligible(
    {
      userId: Number(user.id),
      email: "",
      uuid: String(user.uuid),
      isActive: Boolean(Number(user.is_active)),
      planId: user.plan_id === null ? null : Number(user.plan_id),
      expiredAt: user.expired_at === null ? null : Number(user.expired_at),
      transferEnable: Number(user.transfer_enable),
      usedBytes: upload + download,
      subId: "",
      deviceLimit: 0,
      inboundIds: [],
    },
    nowSeconds,
  );

  const nodes: LinkNode[] = [];
  if (eligible && user.group_id !== null) {
    // 与 Reconciler 使用同一套分配规则：权限组内、已启用、面板中仍存在、协议受支持。
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT n.name, n.host, n.port, n.protocol, n.inbound_snapshot
         FROM nodes n
         JOIN node_access_groups nag ON nag.node_id = n.id
        WHERE nag.group_id = ? AND n.external_panel = ? AND n.is_enabled = 1
          AND n.missing_since IS NULL AND n.inbound_snapshot IS NOT NULL
        ORDER BY n.sort_order ASC, n.id ASC`,
      [user.group_id, PANEL_NAME],
    );
    for (const row of rows) {
      const protocol = String(row.protocol);
      if (!SYNC_PROTOCOLS.has(protocol)) continue;
      const snapshot = typeof row.inbound_snapshot === "string" ? JSON.parse(row.inbound_snapshot) : row.inbound_snapshot;
      nodes.push({ name: String(row.name), host: String(row.host), port: Number(row.port), protocol, snapshot });
    }
  }

  // 订阅层设备限制：只在确实要下发节点时登记，避免过期用户的拉取占用设备名额。
  let headers: Record<string, string> = {};
  let deviceNotice: string | null = null;
  if (nodes.length && device) {
    const gate = await gateDevice(Number(user.id), Number(user.device_limit), device);
    headers = deviceGateHeaders(gate);
    if (!gate.allowed) {
      nodes.length = 0;
      deviceNotice = `设备数已达上限（${gate.limit} 台），请在个人中心移除旧设备`;
    }
  }

  const uuid = String(user.uuid);
  // 节点都无法用该格式表达时，与「没有节点」一样下发提示节点，而不是空配置。
  const notice = () => deviceNotice ?? reasonFor(user, nowSeconds, nodes.length > 0);

  if (format === "clash") {
    const proxies = nodes.map((node) => buildClashProxy(node, uuid)).filter((proxy) => proxy !== null);
    return {
      body: renderClashConfig(proxies.length ? proxies : [clashNoticeProxy(notice())]),
      contentType: "text/yaml; charset=utf-8",
      headers,
      userInfo,
    };
  }

  const links = nodes.map((node) => buildLink(node, uuid)).filter((link) => link !== null);
  if (!links.length) links.push(noticeLink(notice()));
  return {
    body: Buffer.from(links.join("\n"), "utf8").toString("base64"),
    contentType: "text/plain; charset=utf-8",
    headers,
    userInfo,
  };
}
