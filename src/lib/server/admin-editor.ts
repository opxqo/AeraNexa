import "server-only";

import type { RowDataPacket } from "mysql2";
import type { AdminSectionKey } from "@/lib/admin-navigation";
import { getDbPool } from "./db";
import { requireAdminUser } from "./admin";
import { getSmtpSettings } from "./smtp-settings";
import { listSettingsForAdmin, settingsEncryptionReady, type AdminSettingView } from "./settings";
import { badRequest, notFound } from "./errors";
import { ensureSystemPaymentMethods } from "./client-portal";
import { ONETIME_PERIOD, RECURRING_PERIODS } from "./subscription";

export type AdminListQuery = { q?: string; page?: number; pageSize?: number };
export type AdminPage<T> = { rows: T[]; total: number; page: number; pageSize: number };

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function normalize(query: AdminListQuery = {}): { q: string; page: number; pageSize: number; offset: number } {
  const q = (query.q ?? "").trim().slice(0, 100);
  const page = Number.isInteger(query.page) && (query.page as number) > 0 ? (query.page as number) : 1;
  const requested = Number.isInteger(query.pageSize) && (query.pageSize as number) > 0 ? (query.pageSize as number) : DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(requested, MAX_PAGE_SIZE);
  return { q, page, pageSize, offset: (page - 1) * pageSize };
}

type EditorUser = {
  id: number; email: string; nickname: string; role: "admin" | "user"; isActive: boolean;
  planName: string; createdAt: string; expiredAt: string; transferEnableGb: number;
  balance: number; commissionBalance: number; uuid: string;
  /** 已用流量（GB，节点域流量采集回写）。 */
  usedGb: number;
  /** 单用户设备数覆盖；null 跟随套餐，0 不限。 */
  deviceLimitOverride: number | null;
  /** 订阅层已登记设备数。 */
  deviceCount: number;
};

type EditorPlan = {
  id: number; name: string; transferEnable: number; speedLimit: number | null; capacityLimit: number | null;
  content: string; sortOrder: number; isVisible: boolean; isRenewable: boolean;
  monthPrice: number | null; quarterPrice: number | null; halfYearPrice: number | null;
  yearPrice: number | null; twoYearPrice: number | null; threeYearPrice: number | null;
  onetimePrice: number | null; resetPrice: number | null;
  /** 设备数上限；null 或 0 表示不限。 */
  deviceLimit: number | null;
  /** 节点权限组；null 表示该套餐不分配任何节点。 */
  groupId: number | null;
};

type EditorPayment = {
  id: number; provider: string; name: string; isEnabled: boolean; handlingFeeFixed: number;
  handlingFeePercent: number; notifyDomain: string; sortOrder: number; transactionCount: number;
};

type EditorRefund = {
  id: number; orderId: number; tradeNo: string; email: string; amount: number; reason: string;
  status: string; adminEmail: string; completedAt: string; createdAt: string;
};

type EditorReconciliation = {
  id: number; batchId: number; provider: string; filename: string; providerTradeNo: string;
  amount: number; status: string; matchStatus: string; resolutionStatus: string;
  resolutionNote: string; createdAt: string;
};

export type EditorRechargeCard = {
  id: number; batchNo: string; batchName: string; amount: number; codeTail: string; status: "unused" | "redeemed" | "disabled" | "expired";
  expiresAt: string; redeemedBy: string; redeemedAt: string; createdAt: string;
};

export type EditorRechargeCardBatch = {
  id: number; batchNo: string; name: string; amount: number; quantity: number;
  totalCount: number; unusedCount: number; disabledCount: number; redeemedCount: number;
  expiresAt: string; createdAt: string;
};

export type AdminRechargeCardBatchDetails = {
  batch: EditorRechargeCardBatch;
  page: AdminPage<EditorRechargeCard>;
};

type EditorNode = {
  id: number; name: string; protocol: string; host: string; port: number; serverPort: number | null;
  rate: number; isVisible: boolean; isEnabled: boolean; isOnline: boolean; externalPanel: string;
  externalInboundId: string; sortOrder: number; lastCheckAt: string; accountCount: number;
  /** 由 3x-ui 导入（有入站快照）：协议、入站 ID、服务端口以面板为准，后台只读。 */
  imported: boolean;
  /** 3x-ui 中已不存在的时间；空字符串表示正常。 */
  missingSince: string;
  groupIds: number[];
};

/** 节点权限组：套餐 → 权限组 → 节点，决定用户能用哪些节点。 */
export type EditorAccessGroup = { id: number; name: string; nodeCount: number; planCount: number };

async function listAccessGroups(): Promise<EditorAccessGroup[]> {
  const [rows] = await getDbPool().query<RowDataPacket[]>(
    `SELECT g.id, g.name,
            (SELECT COUNT(*) FROM node_access_groups nag WHERE nag.group_id = g.id) AS node_count,
            (SELECT COUNT(*) FROM plans p WHERE p.group_id = g.id) AS plan_count
       FROM access_groups g ORDER BY g.id ASC`,
  );
  return rows.map((row) => ({
    id: asNumber(row.id),
    name: String(row.name),
    nodeCount: asNumber(row.node_count),
    planCount: asNumber(row.plan_count),
  }));
}

type EditorTicket = {
  id: number; subject: string; email: string; userId: number; level: number; status: number;
  replyStatus: number; updatedAt: string; messageCount: number; lastMessage: string;
};

type EditorOrder = {
  id: number; tradeNo: string; email: string; planId: number; planName: string; orderType: number; period: string;
  subtotalAmount: number; totalAmount: number; discountAmount: number; status: number;
  couponCode: string; adminRemark: string;
  /** gateway = 支付回调履约；admin = 后台人工补单；null = 尚未履约。 */
  fulfillmentSource: string | null;
  paymentProvider: string | null; paymentTransactionId: number | null; refunded: boolean;
  createdAt: string; paidAt: string;
};

/** 节点流量记录。`node_traffic_records` 此前没有人读，这里让后台能看见它。 */
type EditorNodeTraffic = {
  id: number;
  nodeId: number;
  /** 节点可能已被删除（记录会随之外键级联），因此名称可能为空。 */
  nodeName: string;
  uploadBytes: number;
  downloadBytes: number;
  recordType: string;
  recordAt: string;
};

/**
 * 按统计粒度分组的汇总。
 *
 * 唯一键是 (node_id, record_type, record_at)，所以小时粒度与日粒度的记录可以同时存在、
 * 覆盖同一时段。若不分粒度直接 SUM，两者会被叠加，数字翻倍。按粒度分开统计，
 * 每个数字都在同一口径内，混合上报的情况也能一眼看见。
 */
type TrafficSummary = {
  recordType: string;
  uploadBytes: number;
  downloadBytes: number;
  nodeCount: number;
  recordCount: number;
}[];

type EditorCoupon = {
  id: number; code: string; name: string; discountType: number; discountValue: number;
  maxUses: number | null; maxUsesPerUser: number | null;
  planIds: number[] | null; periods: string[] | null;
  startsAt: string; endsAt: string; startsAtInput: string; endsAtInput: string;
  isVisible: boolean; isActive: boolean;
  /** 已核销次数，以 coupon_usages 为准。 */
  usedCount: number; createdAt: string;
};

type EditorNotice = {
  id: number; title: string; content: string; imageUrl: string; tags: string[];
  isVisible: boolean;
  /** published_at 在 SQL 里与 CURRENT_TIMESTAMP 比较，因此库内按 UTC 挂钟时间存储。 */
  publishedAt: string; publishedAtInput: string;
  createdAt: string; updatedAt: string;
};

/**
 * 文档列表只带元信息，正文按需加载。
 *
 * body 是 MEDIUMTEXT，一页 20 条最坏情况能拉出几百 MB；工单消息也是同样的
 * 理由拆成 getAdminTicketMessages，这里沿用那套做法。
 */
type EditorKnowledge = {
  id: number; language: string; category: string; title: string;
  sortOrder: number; isVisible: boolean; updatedAt: string;
  /** 正文字符数，仅用于列表上给个篇幅提示。 */
  bodyLength: number;
};

type EditorMailSettings = {
  enabled: boolean; host: string; port: number; secure: boolean; username: string;
  fromName: string; fromEmail: string; hasPassword: boolean; configured: boolean;
  encryptionReady: boolean; updatedAt: string;
};

export type AdminEditorData =
  | { section: "users"; page: AdminPage<EditorUser> }
  // 套餐与节点表单都要选择节点权限组，因此一并带上权限组选项。
  | { section: "plans"; page: AdminPage<EditorPlan>; groups: EditorAccessGroup[] }
  | { section: "payments"; page: AdminPage<EditorPayment> }
  | { section: "refunds"; page: AdminPage<EditorRefund> }
  | { section: "reconciliation"; page: AdminPage<EditorReconciliation> }
  | { section: "recharge-cards"; page: AdminPage<EditorRechargeCardBatch> }
  | { section: "nodes"; page: AdminPage<EditorNode>; groups: EditorAccessGroup[] }
  | { section: "tickets"; page: AdminPage<EditorTicket> }
  | { section: "notices"; page: AdminPage<EditorNotice> }
  | { section: "knowledge"; page: AdminPage<EditorKnowledge> }
  | { section: "traffic"; page: AdminPage<EditorNodeTraffic>; summary: TrafficSummary }
  | { section: "mail"; page: AdminPage<EditorMailSettings> }
  | { section: "settings"; page: AdminPage<AdminSettingView>; encryptionReady: boolean }
  // 优惠券表单需要勾选适用套餐，因此一并带上套餐选项。
  | { section: "coupons"; page: AdminPage<EditorCoupon>; plans: Array<{ id: number; name: string }> }
  // 订单改单表单需要切换套餐与周期，因此带上套餐及其可售周期。
  | { section: "orders"; page: AdminPage<EditorOrder>; plans: Array<{ id: number; name: string; periods: string[] }> };

function asNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asDate(value: Date | string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function asDateFromSeconds(value: number | string | null): string {
  if (value === null || value === undefined) return "—";
  const seconds = asNumber(value);
  if (!seconds) return "长期有效";
  return asDate(new Date(seconds * 1000));
}

/** 转为 <input type="date"> 需要的 YYYY-MM-DD；空值返回空串。 */
function asDateInput(value: Date | string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  // 用 UTC 字段拼接，避免服务器时区把日期整体偏移一天。
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mapRechargeCardBatch(row: RowDataPacket): EditorRechargeCardBatch {
  return {
    id: asNumber(row.id), batchNo: String(row.batch_no), name: String(row.name), amount: asNumber(row.amount),
    quantity: asNumber(row.quantity), totalCount: asNumber(row.total_count), unusedCount: asNumber(row.unused_count),
    disabledCount: asNumber(row.disabled_count), redeemedCount: asNumber(row.redeemed_count),
    expiresAt: row.expires_at ? asDate(row.expires_at as Date) : "长期有效", createdAt: asDate(row.created_at as Date),
  };
}

function mapRechargeCard(row: RowDataPacket): EditorRechargeCard {
  const expired = row.expires_at && new Date(row.expires_at as Date).getTime() < Date.now() && String(row.status) !== "redeemed";
  return {
    id: asNumber(row.id), batchNo: String(row.batch_no), batchName: String(row.batch_name), amount: asNumber(row.amount),
    codeTail: String(row.code_tail), status: expired ? "expired" : (String(row.status) as EditorRechargeCard["status"]),
    expiresAt: row.expires_at ? asDate(row.expires_at as Date) : "长期有效",
    redeemedBy: row.redeemed_email ? String(row.redeemed_email) : "—",
    redeemedAt: asDate(row.redeemed_at as Date | null), createdAt: asDate(row.created_at as Date),
  };
}

/**
 * 转为 <input type="datetime-local"> 需要的 YYYY-MM-DDTHH:mm；空值返回空串。
 *
 * DATETIME 列里存的是 UTC 挂钟时间，mysql2（timezone: "Z"）把它按 UTC 解析，
 * 所以这里加上 8 小时换成东八区挂钟时间再取字段，与 asDate 的展示口径一致。
 */
function asDateTimeInput(value: Date | string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
  return shifted.toISOString().slice(0, 16);
}

/**
 * JSON 列 → 数组。
 *
 * mysql2 会根据字段类型把 JSON 列自动反序列化成 JS 值，所以从驱动拿到的
 * 通常已经是数组；但显式 CAST 成字符、或将来换驱动时又可能是字符串。
 * 两种都接住——早先只按字符串处理，导致 plan_ids / periods / tags 一律读成 null，
 * 打开优惠券编辑框时勾选是空的，保存就会把适用范围悄悄清掉。
 */
function parseJsonArray(value: unknown): unknown[] | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function asNumberList(value: unknown): number[] | null {
  const list = parseJsonArray(value);
  if (!list) return null;
  const numbers = list.map((item) => asNumber(item as number)).filter((item) => item > 0);
  return numbers.length ? numbers : null;
}

function asStringList(value: unknown): string[] | null {
  const list = parseJsonArray(value);
  if (!list) return null;
  const strings = list.map((item) => String(item)).filter(Boolean);
  return strings.length ? strings : null;
}

const like = (value: string) => `%${value.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;

async function countTotal(sql: string, params: Array<string | number | null>): Promise<number> {
  const [rows] = await getDbPool().execute<RowDataPacket[]>(sql, params);
  return asNumber(rows[0]?.total);
}

export async function getAdminEditorData(
  section: AdminSectionKey,
  query: AdminListQuery = {},
): Promise<AdminEditorData> {
  await requireAdminUser();
  const pool = getDbPool();
  const { q, page, pageSize, offset } = normalize(query);
  const limitClause = ` LIMIT ${pageSize} OFFSET ${offset}`;

  if (section === "settings") {
    const rows = await listSettingsForAdmin();
    return { section, page: { total: rows.length, page: 1, pageSize: rows.length, rows }, encryptionReady: settingsEncryptionReady() };
  }

  if (section === "mail") {
    const settings = await getSmtpSettings();
    return {
      section,
      page: { total: 1, page: 1, pageSize: 1, rows: [{
        enabled: settings.enabled, host: settings.host, port: settings.port, secure: settings.secure,
        username: settings.username, fromName: settings.fromName, fromEmail: settings.fromEmail,
        hasPassword: settings.hasPassword, configured: settings.configured,
        encryptionReady: settings.encryptionReady, updatedAt: asDate(settings.updatedAt),
      }] },
    };
  }

  if (section === "users") {
    const where = q ? "WHERE (u.email LIKE ? OR u.nickname LIKE ?)" : "";
    const params = q ? [like(q), like(q)] : [];
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT u.id, u.email, u.nickname, u.role, u.is_active, u.expired_at, u.transfer_enable,
              u.balance, u.commission_balance, u.uuid, u.created_at, p.name AS plan_name,
              u.upload_bytes + u.download_bytes AS used_bytes, u.device_limit_override,
              (SELECT COUNT(*) FROM user_devices d WHERE d.user_id = u.id) AS device_count
         FROM users u LEFT JOIN plans p ON p.id = u.plan_id
         ${where} ORDER BY u.id DESC${limitClause}`,
      params,
    );
    const total = await countTotal(
      `SELECT COUNT(*) AS total FROM users u ${where}`,
      params,
    );
    return {
      section,
      page: {
        total, page, pageSize,
        rows: rows.map((row) => ({
          id: asNumber(row.id),
          email: String(row.email),
          nickname: String(row.nickname),
          role: row.role === "admin" ? "admin" : "user",
          isActive: Boolean(row.is_active),
          planName: row.plan_name ? String(row.plan_name) : "未订阅",
          createdAt: asDate(row.created_at as Date),
          expiredAt: asDateFromSeconds(row.expired_at as number | null),
          // 套餐额度以 GB 存储、用户额度以字节存储，此处统一换算为 GB 供后台编辑。
          transferEnableGb: Math.round((asNumber(row.transfer_enable) / 1073741824) * 100) / 100,
          balance: asNumber(row.balance),
          commissionBalance: asNumber(row.commission_balance),
          uuid: String(row.uuid),
          usedGb: Math.round((asNumber(row.used_bytes) / 1073741824) * 100) / 100,
          deviceLimitOverride: row.device_limit_override === null ? null : asNumber(row.device_limit_override),
          deviceCount: asNumber(row.device_count),
        })),
      },
    };
  }

  if (section === "plans") {
    const where = q ? "WHERE name LIKE ?" : "";
    const params = q ? [like(q)] : [];
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, group_id, name, transfer_enable, speed_limit, device_limit, capacity_limit, content, sort_order,
              is_visible, is_renewable, month_price, quarter_price, half_year_price, year_price,
              two_year_price, three_year_price, onetime_price, reset_price
         FROM plans ${where} ORDER BY sort_order ASC, id DESC${limitClause}`,
      params,
    );
    const total = await countTotal(`SELECT COUNT(*) AS total FROM plans ${where}`, params);
    const nullable = (value: unknown) => (value === null || value === undefined ? null : asNumber(value as number));
    return {
      section,
      page: {
        total, page, pageSize,
        rows: rows.map((row) => ({
          id: asNumber(row.id),
          name: String(row.name),
          transferEnable: asNumber(row.transfer_enable),
          speedLimit: nullable(row.speed_limit),
          capacityLimit: nullable(row.capacity_limit),
          content: row.content ? String(row.content) : "",
          sortOrder: asNumber(row.sort_order),
          isVisible: Boolean(row.is_visible),
          isRenewable: Boolean(row.is_renewable),
          monthPrice: nullable(row.month_price),
          quarterPrice: nullable(row.quarter_price),
          halfYearPrice: nullable(row.half_year_price),
          yearPrice: nullable(row.year_price),
          twoYearPrice: nullable(row.two_year_price),
          threeYearPrice: nullable(row.three_year_price),
          onetimePrice: nullable(row.onetime_price),
          resetPrice: nullable(row.reset_price),
          groupId: nullable(row.group_id),
          deviceLimit: nullable(row.device_limit),
        })),
      },
      groups: await listAccessGroups(),
    };
  }

  if (section === "payments") {
    await ensureSystemPaymentMethods();
    const where = q ? "WHERE (pm.name LIKE ? OR pm.provider LIKE ?)" : "";
    const params = q ? [like(q), like(q)] : [];
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT pm.id, pm.provider, pm.name, pm.is_enabled, pm.handling_fee_fixed, pm.handling_fee_percent,
              pm.notify_domain, pm.sort_order,
              (SELECT COUNT(*) FROM payment_transactions pt WHERE pt.payment_method_id = pm.id) AS transaction_count
         FROM payment_methods pm ${where} ORDER BY pm.sort_order ASC, pm.id DESC${limitClause}`,
      params,
    );
    const total = await countTotal(`SELECT COUNT(*) AS total FROM payment_methods pm ${where}`, params);
    return {
      section,
      page: {
        total, page, pageSize,
        rows: rows.map((row) => ({
          id: asNumber(row.id),
          provider: String(row.provider),
          name: String(row.name),
          isEnabled: Boolean(row.is_enabled),
          handlingFeeFixed: asNumber(row.handling_fee_fixed),
          handlingFeePercent: asNumber(row.handling_fee_percent),
          notifyDomain: row.notify_domain ? String(row.notify_domain) : "",
          sortOrder: asNumber(row.sort_order),
          transactionCount: asNumber(row.transaction_count),
        })),
      },
    };
  }

  if (section === "refunds") {
    const where = q ? "WHERE (o.trade_no LIKE ? OR u.email LIKE ? OR r.reason LIKE ?)" : "";
    const params = q ? [like(q), like(q), like(q)] : [];
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT r.id, r.order_id, r.amount, r.reason, r.status, r.completed_at, r.created_at,
              o.trade_no, u.email, admin.email AS admin_email
         FROM payment_refunds r
         INNER JOIN orders o ON o.id = r.order_id
         INNER JOIN users u ON u.id = r.user_id
         INNER JOIN users admin ON admin.id = r.admin_id
         ${where} ORDER BY r.id DESC${limitClause}`,
      params,
    );
    const total = await countTotal(
      `SELECT COUNT(*) AS total FROM payment_refunds r INNER JOIN orders o ON o.id = r.order_id INNER JOIN users u ON u.id = r.user_id ${where}`,
      params,
    );
    return { section, page: { total, page, pageSize, rows: rows.map((row) => ({
      id: asNumber(row.id), orderId: asNumber(row.order_id), tradeNo: String(row.trade_no), email: String(row.email),
      amount: asNumber(row.amount), reason: String(row.reason), status: String(row.status), adminEmail: String(row.admin_email),
      completedAt: asDate(row.completed_at as Date | null), createdAt: asDate(row.created_at as Date),
    })) } };
  }

  if (section === "reconciliation") {
    const where = q ? "WHERE (b.provider LIKE ? OR rr.provider_trade_no LIKE ? OR rr.match_status LIKE ?)" : "";
    const params = q ? [like(q), like(q), like(q)] : [];
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT rr.id, rr.batch_id, rr.provider_trade_no, rr.amount_cents, rr.match_status, rr.resolution_status,
              rr.resolution_note, rr.created_at, b.provider, b.filename
         FROM reconciliation_rows rr
         INNER JOIN reconciliation_batches b ON b.id = rr.batch_id
         ${where} ORDER BY rr.id DESC${limitClause}`,
      params,
    );
    const total = await countTotal(
      `SELECT COUNT(*) AS total FROM reconciliation_rows rr INNER JOIN reconciliation_batches b ON b.id = rr.batch_id ${where}`,
      params,
    );
    return { section, page: { total, page, pageSize, rows: rows.map((row) => ({
      id: asNumber(row.id), batchId: asNumber(row.batch_id), provider: String(row.provider), filename: String(row.filename),
      providerTradeNo: String(row.provider_trade_no), amount: asNumber(row.amount_cents), status: "已导入",
      matchStatus: String(row.match_status), resolutionStatus: String(row.resolution_status),
      resolutionNote: row.resolution_note ? String(row.resolution_note) : "", createdAt: asDate(row.created_at as Date),
    })) } };
  }

  if (section === "recharge-cards") {
    const where = q ? "WHERE (b.batch_no LIKE ? OR b.name LIKE ?)" : "";
    const params = q ? [like(q), like(q)] : [];
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT b.id, b.batch_no, b.name, b.amount, b.quantity, b.expires_at, b.created_at,
              COUNT(c.id) AS total_count,
              COALESCE(SUM(c.status = 'unused'), 0) AS unused_count,
              COALESCE(SUM(c.status = 'disabled'), 0) AS disabled_count,
              COALESCE(SUM(c.status = 'redeemed'), 0) AS redeemed_count
         FROM recharge_card_batches b
         LEFT JOIN recharge_cards c ON c.batch_id = b.id
         ${where}
        GROUP BY b.id
        ORDER BY b.id DESC${limitClause}`,
      params,
    );
    const total = await countTotal(
      `SELECT COUNT(*) AS total FROM recharge_card_batches b ${where}`,
      params,
    );
    return {
      section,
      page: {
        total, page, pageSize,
        rows: rows.map(mapRechargeCardBatch),
      },
    };
  }

  if (section === "nodes") {
    const where = q ? "WHERE (n.name LIKE ? OR n.host LIKE ?)" : "";
    const params = q ? [like(q), like(q)] : [];
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT n.id, n.name, n.protocol, n.host, n.port, n.server_port, n.rate, n.is_visible, n.is_enabled, n.is_online,
              n.external_panel, n.external_inbound_id, n.sort_order, n.last_check_at, n.missing_since,
              n.snapshot_hash IS NOT NULL AS imported,
              (SELECT GROUP_CONCAT(nag.group_id) FROM node_access_groups nag WHERE nag.node_id = n.id) AS group_ids,
              (SELECT COUNT(*) FROM proxy_accounts pa WHERE pa.node_id = n.id) AS account_count
         FROM nodes n ${where} ORDER BY n.sort_order ASC, n.id DESC${limitClause}`,
      params,
    );
    const total = await countTotal(`SELECT COUNT(*) AS total FROM nodes n ${where}`, params);
    return {
      section,
      page: {
        total, page, pageSize,
        rows: rows.map((row) => ({
          id: asNumber(row.id),
          name: String(row.name),
          protocol: String(row.protocol),
          host: String(row.host),
          port: asNumber(row.port),
          serverPort: row.server_port === null ? null : asNumber(row.server_port),
          rate: asNumber(row.rate),
          isVisible: Boolean(row.is_visible),
          isEnabled: Boolean(row.is_enabled),
          isOnline: Boolean(row.is_online),
          externalPanel: String(row.external_panel),
          externalInboundId: row.external_inbound_id ? String(row.external_inbound_id) : "",
          sortOrder: asNumber(row.sort_order),
          lastCheckAt: asDate(row.last_check_at as Date | null),
          accountCount: asNumber(row.account_count),
          imported: Boolean(row.imported),
          missingSince: row.missing_since ? asDate(row.missing_since as Date) : "",
          groupIds: row.group_ids ? String(row.group_ids).split(",").map(Number).filter(Number.isInteger) : [],
        })),
      },
      groups: await listAccessGroups(),
    };
  }

  if (section === "tickets") {
    const where = q ? "WHERE (t.subject LIKE ? OR u.email LIKE ?)" : "";
    const params = q ? [like(q), like(q)] : [];
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT t.id, t.subject, t.user_id, t.level, t.status, t.reply_status, t.updated_at,
              u.email,
              (SELECT COUNT(*) FROM ticket_messages tm WHERE tm.ticket_id = t.id) AS message_count,
              (SELECT tm.message FROM ticket_messages tm WHERE tm.ticket_id = t.id ORDER BY tm.id DESC LIMIT 1) AS last_message
         FROM tickets t INNER JOIN users u ON u.id = t.user_id
         ${where} ORDER BY t.updated_at DESC${limitClause}`,
      params,
    );
    // 无搜索词时不要 JOIN users：tickets.user_id 是非空外键，必然匹配到用户，
    // JOIN 改变不了计数结果，却让执行计划从 users 起手（实测多扫近 1.5 万行）。
    const total = await countTotal(
      q
        ? `SELECT COUNT(*) AS total FROM tickets t INNER JOIN users u ON u.id = t.user_id ${where}`
        : `SELECT COUNT(*) AS total FROM tickets t`,
      params,
    );
    return {
      section,
      page: {
        total, page, pageSize,
        rows: rows.map((row) => ({
          id: asNumber(row.id),
          subject: String(row.subject),
          userId: asNumber(row.user_id),
          email: String(row.email),
          level: asNumber(row.level),
          status: asNumber(row.status),
          replyStatus: asNumber(row.reply_status),
          updatedAt: asDate(row.updated_at as Date),
          messageCount: asNumber(row.message_count),
          lastMessage: row.last_message ? String(row.last_message).slice(0, 80) : "",
        })),
      },
    };
  }

  if (section === "coupons") {
    const where = q ? "WHERE (c.code LIKE ? OR c.name LIKE ?)" : "";
    const params = q ? [like(q), like(q)] : [];
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT c.id, c.code, c.name, c.discount_type, c.discount_value,
              c.max_uses, c.max_uses_per_user, c.plan_ids, c.periods,
              c.starts_at, c.ends_at, c.is_visible, c.is_active, c.created_at,
              (SELECT COUNT(*) FROM coupon_usages cu WHERE cu.coupon_id = c.id) AS used_count
         FROM coupons c ${where} ORDER BY c.id DESC${limitClause}`,
      params,
    );
    const total = await countTotal(`SELECT COUNT(*) AS total FROM coupons c ${where}`, params);
    const [planRows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, name FROM plans ORDER BY sort_order ASC, id ASC`,
    );
    return {
      section,
      plans: planRows.map((row) => ({ id: asNumber(row.id), name: String(row.name) })),
      page: {
        total, page, pageSize,
        rows: rows.map((row) => ({
          id: asNumber(row.id),
          code: String(row.code),
          name: String(row.name),
          discountType: asNumber(row.discount_type) === 2 ? 2 : 1,
          discountValue: asNumber(row.discount_value),
          maxUses: row.max_uses === null ? null : asNumber(row.max_uses),
          maxUsesPerUser: row.max_uses_per_user === null ? null : asNumber(row.max_uses_per_user),
          planIds: asNumberList(row.plan_ids),
          periods: asStringList(row.periods),
          startsAt: asDate(row.starts_at as Date | null),
          endsAt: asDate(row.ends_at as Date | null),
          startsAtInput: asDateInput(row.starts_at as Date | null),
          endsAtInput: asDateInput(row.ends_at as Date | null),
          isVisible: Boolean(row.is_visible),
          isActive: Boolean(row.is_active),
          usedCount: asNumber(row.used_count),
          createdAt: asDate(row.created_at as Date),
        })),
      },
    };
  }

  if (section === "notices") {
    const where = q ? "WHERE (title LIKE ? OR content LIKE ?)" : "";
    const params = q ? [like(q), like(q)] : [];
    // 后台按录入顺序倒序，而不是照搬门户的「发布时间的倒序」：
    // 排期到未来的公告在门户排在最前，在后台这样排会让人找不到刚写的那条。
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, title, content, image_url, tags, is_visible, published_at, created_at, updated_at
         FROM notices ${where} ORDER BY id DESC${limitClause}`,
      params,
    );
    const total = await countTotal(`SELECT COUNT(*) AS total FROM notices ${where}`, params);
    return {
      section,
      page: {
        total, page, pageSize,
        rows: rows.map((row) => ({
          id: asNumber(row.id),
          title: String(row.title),
          content: row.content ? String(row.content) : "",
          imageUrl: row.image_url ? String(row.image_url) : "",
          tags: asStringList(row.tags) ?? [],
          isVisible: Boolean(row.is_visible),
          publishedAt: row.published_at ? asDate(row.published_at as Date) : "立即生效",
          publishedAtInput: asDateTimeInput(row.published_at as Date | null),
          createdAt: asDate(row.created_at as Date),
          updatedAt: asDate(row.updated_at as Date),
        })),
      },
    };
  }

  if (section === "knowledge") {
    const where = q ? "WHERE (title LIKE ? OR category LIKE ?)" : "";
    const params = q ? [like(q), like(q)] : [];
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, language, category, title, sort_order, is_visible, updated_at, CHAR_LENGTH(body) AS body_length
         FROM knowledge_articles ${where} ORDER BY category ASC, sort_order ASC, id ASC${limitClause}`,
      params,
    );
    const total = await countTotal(`SELECT COUNT(*) AS total FROM knowledge_articles ${where}`, params);
    return {
      section,
      page: {
        total, page, pageSize,
        rows: rows.map((row) => ({
          id: asNumber(row.id),
          language: String(row.language),
          category: String(row.category),
          title: String(row.title),
          sortOrder: asNumber(row.sort_order),
          isVisible: Boolean(row.is_visible),
          updatedAt: asDate(row.updated_at as Date),
          bodyLength: asNumber(row.body_length),
        })),
      },
    };
  }

  if (section === "traffic") {
    const where = q ? "WHERE (n.name LIKE ?)" : "";
    const params = q ? [like(q)] : [];
    // 用 LEFT JOIN：记录随节点级联删除，但万一有脏数据也不至于整页空白。
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT r.id, r.node_id, r.upload_bytes, r.download_bytes, r.record_type, r.record_at,
              n.name AS node_name
         FROM node_traffic_records r
         LEFT JOIN nodes n ON n.id = r.node_id
         ${where} ORDER BY r.record_at DESC, r.id DESC${limitClause}`,
      params,
    );
    // 无搜索词时计数与汇总都不需要 JOIN：两者的列全部来自 r，
    // JOIN 仅为了按节点名过滤。与订单计数的既有做法一致。
    const countJoin = q ? " LEFT JOIN nodes n ON n.id = r.node_id" : "";
    const total = await countTotal(
      `SELECT COUNT(*) AS total FROM node_traffic_records r${countJoin} ${where}`,
      params,
    );
    // 汇总必须跟随搜索条件，否则「筛选后表格变了、卡片数字没变」会让人以为算错了。
    const [summaryRows] = await pool.execute<RowDataPacket[]>(
      `SELECT r.record_type,
              COALESCE(SUM(r.upload_bytes), 0) AS up, COALESCE(SUM(r.download_bytes), 0) AS down,
              COUNT(DISTINCT r.node_id) AS nodes, COUNT(*) AS records
         FROM node_traffic_records r${countJoin}
         ${where}
         GROUP BY r.record_type ORDER BY r.record_type`,
      params,
    );
    return {
      section,
      summary: summaryRows.map((row) => ({
        recordType: String(row.record_type ?? "day"),
        uploadBytes: asNumber(row.up),
        downloadBytes: asNumber(row.down),
        nodeCount: asNumber(row.nodes),
        recordCount: asNumber(row.records),
      })),
      page: {
        total, page, pageSize,
        rows: rows.map((row) => ({
          id: asNumber(row.id),
          nodeId: asNumber(row.node_id),
          nodeName: row.node_name ? String(row.node_name) : "（节点已删除）",
          uploadBytes: asNumber(row.upload_bytes),
          downloadBytes: asNumber(row.download_bytes),
          recordType: String(row.record_type ?? "day"),
          recordAt: asDate(row.record_at as Date),
        })),
      },
    };
  }

  const where = q ? "WHERE (o.trade_no LIKE ? OR u.email LIKE ?)" : "";
  const params = q ? [like(q), like(q)] : [];
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT o.id, o.trade_no, o.order_type, o.period, o.plan_id, o.total_amount, o.discount_amount,
            o.surplus_amount, o.status, o.created_at, o.paid_at,
            o.fulfillment_source, o.admin_remark, c.code AS coupon_code,
            (SELECT pm.provider FROM payment_transactions pt INNER JOIN payment_methods pm ON pm.id = pt.payment_method_id WHERE pt.order_id = o.id AND pt.status = 'completed' ORDER BY pt.id DESC LIMIT 1) AS payment_provider,
            (SELECT pt.id FROM payment_transactions pt WHERE pt.order_id = o.id AND pt.status = 'completed' ORDER BY pt.id DESC LIMIT 1) AS payment_transaction_id,
            EXISTS(SELECT 1 FROM payment_refunds pr WHERE pr.order_id = o.id) AS refunded,
            u.email, p.name AS plan_name
       FROM orders o
       INNER JOIN users u ON u.id = o.user_id
       INNER JOIN plans p ON p.id = o.plan_id
       LEFT JOIN coupons c ON c.id = o.coupon_id
       ${where} ORDER BY o.id DESC${limitClause}`,
    params,
  );
  // 同理：无搜索词时不 JOIN users。orders.user_id 是非空外键，JOIN 不会改变计数，
  // 但会让优化器误从 users 起手，扫完用户表再回查订单（实测 11.2ms → 走覆盖索引后约 3ms）。
  const total = await countTotal(
    q
      ? `SELECT COUNT(*) AS total FROM orders o INNER JOIN users u ON u.id = o.user_id ${where}`
      : `SELECT COUNT(*) AS total FROM orders o`,
    params,
  );
  // 改单表单需要在切换套餐后同步可选的付款周期，因此把每个套餐的可售周期一并带出。
  const [planRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, name, ${[...RECURRING_PERIODS, ONETIME_PERIOD].join(", ")}
       FROM plans ORDER BY sort_order ASC, id ASC`,
  );
  return {
    section: "orders",
    plans: planRows.map((row) => ({
      id: asNumber(row.id),
      name: String(row.name),
      periods: [...RECURRING_PERIODS, ONETIME_PERIOD].filter(
        (period) => row[period] !== null && row[period] !== undefined,
      ),
    })),
    page: {
      total, page, pageSize,
      rows: rows.map((row) => ({
        id: asNumber(row.id),
        tradeNo: String(row.trade_no),
        email: String(row.email),
        planId: asNumber(row.plan_id),
        planName: String(row.plan_name),
        orderType: asNumber(row.order_type),
        period: String(row.period),
        // 原价 = 应付 + 优惠 + 折抵
        subtotalAmount: asNumber(row.total_amount) + asNumber(row.discount_amount) + asNumber(row.surplus_amount),
        totalAmount: asNumber(row.total_amount),
        discountAmount: asNumber(row.discount_amount),
        status: asNumber(row.status),
        couponCode: row.coupon_code === null ? "" : String(row.coupon_code),
        adminRemark: row.admin_remark === null ? "" : String(row.admin_remark),
        fulfillmentSource: row.fulfillment_source === null ? null : String(row.fulfillment_source),
        paymentProvider: row.payment_provider === null ? null : String(row.payment_provider),
        paymentTransactionId: row.payment_transaction_id === null ? null : asNumber(row.payment_transaction_id),
        refunded: Boolean(row.refunded),
        createdAt: asDate(row.created_at as Date),
        paidAt: asDate(row.paid_at as Date | null),
      })),
    },
  };
}

export type AdminTicketMessage = {
  id: number;
  senderRole: string;
  userId: number | null;
  message: string;
  createdAt: string;
};

/** 按需加载工单会话，避免列表页一次性把全部消息带出来。 */
export async function getAdminTicketMessages(ticketId: number): Promise<{
  ticket: { id: number; subject: string; email: string; level: number; status: number; replyStatus: number };
  messages: AdminTicketMessage[];
}> {
  await requireAdminUser();
  if (!Number.isInteger(ticketId) || ticketId < 1) throw badRequest("工单编号不正确");

  const pool = getDbPool();
  const [tickets] = await pool.execute<RowDataPacket[]>(
    `SELECT t.id, t.subject, t.level, t.status, t.reply_status, u.email
       FROM tickets t INNER JOIN users u ON u.id = t.user_id
      WHERE t.id = ? LIMIT 1`,
    [ticketId],
  );
  const ticket = tickets[0];
  if (!ticket) throw notFound("工单不存在");

  const [messages] = await pool.execute<RowDataPacket[]>(
    `SELECT id, user_id, sender_role, message, created_at
       FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC, id ASC`,
    [ticketId],
  );

  return {
    ticket: {
      id: asNumber(ticket.id),
      subject: String(ticket.subject),
      email: String(ticket.email),
      level: asNumber(ticket.level),
      status: asNumber(ticket.status),
      replyStatus: asNumber(ticket.reply_status),
    },
    messages: messages.map((row) => ({
      id: asNumber(row.id),
      senderRole: String(row.sender_role),
      userId: row.user_id === null ? null : asNumber(row.user_id),
      message: String(row.message),
      createdAt: asDate(row.created_at as Date),
    })),
  };
}

export type AdminKnowledgeArticle = {
  id: number; language: string; category: string; title: string;
  body: string; sortOrder: number; isVisible: boolean;
};

/** 按需加载文档正文，避免列表页把 MEDIUMTEXT 整列拉出来。 */
export async function getAdminKnowledgeArticle(articleId: number): Promise<AdminKnowledgeArticle> {
  await requireAdminUser();
  if (!Number.isInteger(articleId) || articleId < 1) throw badRequest("文档编号不正确");

  const [rows] = await getDbPool().execute<RowDataPacket[]>(
    `SELECT id, language, category, title, body, sort_order, is_visible
       FROM knowledge_articles WHERE id = ? LIMIT 1`,
    [articleId],
  );
  const row = rows[0];
  if (!row) throw notFound("文档不存在");

  return {
    id: asNumber(row.id),
    language: String(row.language),
    category: String(row.category),
    title: String(row.title),
    body: row.body ? String(row.body) : "",
    sortOrder: asNumber(row.sort_order),
    isVisible: Boolean(row.is_visible),
  };
}

/**
 * 卡密批次明细按需读取。批次列表不携带卡密行，避免一次把大批量卡密渲染到后台页面。
 */
export async function getAdminRechargeCardBatchDetails(batchId: number, requestedPage = 1): Promise<AdminRechargeCardBatchDetails> {
  await requireAdminUser();
  if (!Number.isInteger(batchId) || batchId < 1) throw badRequest("卡密批次编号不正确");

  const pageSize = 50;
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const offset = (page - 1) * pageSize;
  const pool = getDbPool();
  const [batchRows] = await pool.execute<RowDataPacket[]>(
    `SELECT b.id, b.batch_no, b.name, b.amount, b.quantity, b.expires_at, b.created_at,
            COUNT(c.id) AS total_count,
            COALESCE(SUM(c.status = 'unused'), 0) AS unused_count,
            COALESCE(SUM(c.status = 'disabled'), 0) AS disabled_count,
            COALESCE(SUM(c.status = 'redeemed'), 0) AS redeemed_count
       FROM recharge_card_batches b
       LEFT JOIN recharge_cards c ON c.batch_id = b.id
      WHERE b.id = ?
      GROUP BY b.id`,
    [batchId],
  );
  const batchRow = batchRows[0];
  if (!batchRow) throw notFound("卡密批次不存在");

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT c.id, c.code_tail, c.amount, c.status, c.redeemed_at, c.created_at,
            b.batch_no, b.name AS batch_name, b.expires_at, u.email AS redeemed_email
       FROM recharge_cards c
       INNER JOIN recharge_card_batches b ON b.id = c.batch_id
       LEFT JOIN users u ON u.id = c.redeemed_by
      WHERE c.batch_id = ?
      ORDER BY c.id DESC
      LIMIT ? OFFSET ?`,
    [batchId, pageSize, offset],
  );
  const total = await countTotal("SELECT COUNT(*) AS total FROM recharge_cards WHERE batch_id = ?", [batchId]);

  return {
    batch: mapRechargeCardBatch(batchRow),
    page: { rows: rows.map(mapRechargeCard), total, page, pageSize },
  };
}
