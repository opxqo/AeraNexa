"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { recordAudit, type AuditAction } from "@/lib/server/audit";
import { requireAdminUser } from "@/lib/server/admin";
import { getAdminKnowledgeArticle, getAdminRechargeCardBatchDetails, getAdminTicketMessages } from "@/lib/server/admin-editor";
import {
  fulfillOrderByAdmin,
  updateOrderRemark,
  updatePendingOrder,
} from "@/lib/server/client-portal";
import { getDbPool } from "@/lib/server/db";
import { adjustUserBalance, createRechargeCardBatch, disableRechargeCard, enableRechargeCard } from "@/lib/server/recharge-cards";
import { hasVisibleContent, sanitizeRichText } from "@/lib/server/sanitize";
import { sendSmtpTestEmail } from "@/lib/server/mailer";
import { saveSmtpSettings } from "@/lib/server/smtp-settings";
import { gbToBytes, ORDER_STATUS } from "@/lib/server/subscription";
import { refundBalanceOrder } from "@/lib/server/payment-refunds";
import { dispatchSandboxPaymentCallback } from "@/lib/server/payment-callbacks";
import { importReconciliationCsv, resolveReconciliationRow } from "@/lib/server/reconciliation";
import { savePaymentCallbackSecret } from "@/lib/server/payment-credentials";
import { importInbounds } from "@/lib/server/panel/import-inbounds";
import { getServerStatus, PanelError } from "@/lib/server/panel/client";
import { markAllPanelClientsDirty, markPanelClientDirty } from "@/lib/server/node-sync";
import { removeUserDevices } from "@/lib/server/devices";
import { saveSettings } from "@/lib/server/settings";
import { findSettingDef, SETTING_DEFS } from "@/lib/server/settings-schema";

type ActionResult = { ok: true; message: string } | { ok: false; message: string };

const ok = (message: string): ActionResult => ({ ok: true, message });
const fail = (message: string): ActionResult => ({ ok: false, message });

// ---------------------------------------------------------------------------
// 解析与校验工具
// ---------------------------------------------------------------------------

function intValue(value: FormDataEntryValue | null, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function optionalInt(value: FormDataEntryValue | null, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | null | undefined {
  if (value === null || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : undefined;
}

/** 元 → 分。返回 null 表示"留空"，undefined 表示"非法"。 */
function moneyToCents(value: FormDataEntryValue | null): number | null | undefined {
  if (value === null || String(value).trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10_000_000) return undefined;
  return Math.round(parsed * 100);
}

function text(value: FormDataEntryValue | null, max = 255): string {
  return String(value ?? "").trim().slice(0, max);
}

function optionalText(value: FormDataEntryValue | null, max = 255): string | null {
  const parsed = text(value, max);
  return parsed ? parsed : null;
}

function checkbox(value: FormDataEntryValue | null): number {
  return value === "on" || value === "1" ? 1 : 0;
}

/** 把 YYYY-MM-DD 解析为东八区当日 23:59:59 的秒级时间戳；留空返回 null（长期有效）。 */
function dateToEpochSeconds(value: FormDataEntryValue | null): number | null | undefined {
  const raw = text(value, 32);
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const parsed = new Date(`${raw}T23:59:59+08:00`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return Math.floor(parsed.getTime() / 1000);
}

function refreshAdmin() {
  for (const path of ["/admin", "/admin/users", "/admin/plans", "/admin/orders", "/admin/refunds", "/admin/reconciliation", "/admin/coupons", "/admin/payments", "/admin/recharge-cards", "/admin/nodes", "/admin/tickets", "/admin/notices", "/admin/knowledge", "/admin/mail", "/admin/settings"]) {
    revalidatePath(path);
  }
}

// ---------------------------------------------------------------------------
// 系统设置
// ---------------------------------------------------------------------------

/**
 * 表单字段名即设置 key。敏感项留空 = 保持不变；勾选 `clear:<key>` = 清除后台值（回退环境变量）。
 * 非敏感项留空 = 清除后台值。
 */
export async function saveSystemSettingsAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const values: Record<string, string> = {};
    for (const def of SETTING_DEFS) {
      const raw = formData.get(def.key);
      if (raw !== null) values[def.key] = String(raw);
    }
    const clearSecrets = SETTING_DEFS
      .filter((def) => def.kind === "secret" && checkbox(formData.get(`clear:${def.key}`)) === 1)
      .map((def) => def.key);
    const changed = await saveSettings({ values, clearSecrets }, admin.id);
    if (!changed.length) return ok("没有需要保存的变更");
    // 审计只记录改了哪些项，不记录值（其中可能有密钥）。
    await audit("admin.settings_saved", "system_settings", changed.join(","), {
      changed: changed.map((key) => findSettingDef(key)?.label ?? key),
    }, admin.id);
    refreshAdmin();
    return ok(`已保存 ${changed.length} 项设置，数秒内生效`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "保存系统设置失败");
  }
}

/** 用当前生效的 3x-ui 设置发一次只读请求（server/status），验证地址与 token。 */
export async function testPanelConnectionAction(): Promise<ActionResult> {
  try {
    await requireAdminUser();
    const status = await getServerStatus();
    return ok(`连接成功：3x-ui ${status.panelVersion}，Xray ${status.xrayVersion}（${status.xrayState === "running" ? "运行中" : status.xrayState}）`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "连接 3x-ui 失败");
  }
}

// ---------------------------------------------------------------------------
// 邮件服务
// ---------------------------------------------------------------------------

export async function saveSmtpSettingsAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const host = text(formData.get("host"), 255);
    const portRaw = text(formData.get("port"), 16);
    const port = portRaw ? intValue(portRaw, 1, 65535) : 0;
    const username = text(formData.get("username"), 255);
    const password = text(formData.get("password"), 1000);
    const fromName = text(formData.get("fromName"), 100);
    const fromEmail = text(formData.get("fromEmail"), 255).toLowerCase();
    const enabled = checkbox(formData.get("enabled")) === 1;
    if (host && !/^[a-zA-Z0-9.-]+$/.test(host)) return fail("SMTP 主机格式不正确");
    if (port === null) return fail("SMTP 端口需为 1-65535 的整数");
    if (fromEmail && !/^\S+@\S+\.\S+$/.test(fromEmail)) return fail("发件邮箱格式不正确");
    const settings = await saveSmtpSettings({ enabled, host, port: port ?? 0, secure: checkbox(formData.get("secure")) === 1, username, password: password || undefined, fromName, fromEmail }, admin.id);
    await audit("admin.smtp_saved", "smtp_settings", 1, { enabled: settings.enabled, host: settings.host, port: settings.port, secure: settings.secure, username: settings.username, fromEmail: settings.fromEmail, passwordUpdated: Boolean(password) }, admin.id);
    if (enabled) await audit("admin.smtp_toggled", "smtp_settings", 1, { enabled: true }, admin.id);
    refreshAdmin();
    return ok(settings.enabled ? "SMTP 配置已保存并启用" : "SMTP 配置已保存，当前保持停用");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "保存 SMTP 配置失败");
  }
}

export async function testSmtpSettingsAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const to = text(formData.get("to"), 255).toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(to)) return fail("请输入有效的测试收件邮箱");
    await sendSmtpTestEmail(to);
    await audit("admin.smtp_tested", "smtp_settings", 1, { to }, admin.id);
    return ok("测试邮件已发送，请检查收件箱和垃圾邮件箱");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "SMTP 测试失败");
  }
}

async function audit(action: AuditAction, resourceType: string, resourceId: number | string, context: Record<string, unknown>, adminId: number) {
  await recordAudit({ action, userId: adminId, resourceType, resourceId, context });
}

// ---------------------------------------------------------------------------
// 用户
// ---------------------------------------------------------------------------

export async function saveUserAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const id = intValue(formData.get("id"), 1);
    const nickname = text(formData.get("nickname"), 50);
    const role = text(formData.get("role"), 20);
    const isActive = checkbox(formData.get("isActive"));
    const transferEnableGb = intValue(formData.get("transferEnableGb"), 0, 1_000_000);
    const expiredAt = dateToEpochSeconds(formData.get("expiredAt"));
    const balance = moneyToCents(formData.get("balance"));
    const commissionBalance = moneyToCents(formData.get("commissionBalance"));
    const deviceLimitOverride = optionalInt(formData.get("deviceLimitOverride"), 0, 1000);

    if (!id) return fail("用户信息不完整");
    if (deviceLimitOverride === undefined) return fail("设备数需为 0 到 1000 的整数，留空跟随套餐");
    if (!nickname) return fail("请填写昵称");
    if (!["admin", "user"].includes(role)) return fail("身份标签不正确");
    if (transferEnableGb === null) return fail("流量额度需为 0 到 1000000 之间的整数（GB）");
    if (expiredAt === undefined) return fail("到期时间格式不正确，请使用日期选择器");
    if (balance === undefined || balance === null) return fail("余额需为非负金额");
    if (commissionBalance === undefined || commissionBalance === null) return fail("佣金余额需为非负金额");

    // 自锁保护：不允许管理员把自己降级或停用，否则会失去唯一的后台入口。
    if (id === admin.id && (role !== "admin" || !isActive)) {
      return fail("不能撤销当前登录管理员的权限或停用该账户");
    }

    const pool = getDbPool();
    if (role === "user") {
      const [rows] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'");
      if (Number(rows[0]?.count) <= 1) return fail("至少需要保留一个管理员账户");
    }

    const connection = await pool.getConnection();
    let previousBalance = 0;
    try {
      await connection.beginTransaction();
      const [users] = await connection.execute<RowDataPacket[]>("SELECT balance FROM users WHERE id = ? LIMIT 1 FOR UPDATE", [id]);
      if (!users[0]) throw new Error("用户不存在");
      previousBalance = Number(users[0].balance ?? 0);
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE users SET nickname = ?, role = ?, is_active = ?, transfer_enable = ?, expired_at = ?,
          balance = ?, commission_balance = ?, device_limit_override = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [nickname, role, isActive, gbToBytes(transferEnableGb), expiredAt, balance, commissionBalance, deviceLimitOverride, id],
      );
      if (result.affectedRows !== 1) throw new Error("用户不存在或未发生变更");
      await adjustUserBalance(connection, id, previousBalance, balance, admin.id);
      // 停用 / 额度 / 到期都会影响 3x-ui 客户端，与本次修改同事务标脏。
      await markPanelClientDirty(connection, id);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await audit("admin.user_updated", "user", id, { nickname, role, isActive, transferEnableGb, balance, previousBalance, commissionBalance }, admin.id);
    refreshAdmin();
    return ok("用户已保存");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "保存用户失败");
  }
}

export async function clearUserDevicesAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const id = intValue(formData.get("id"), 1);
    if (!id) return fail("用户编号不正确");
    const removed = await removeUserDevices(id);
    await audit("admin.user_devices_cleared", "user", id, { removed }, admin.id);
    refreshAdmin();
    return ok(`已清空 ${removed} 台设备`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "清空设备失败");
  }
}

export type CreateRechargeCardsResult = ActionResult & { cards?: string[]; batchNo?: string; amount?: number };

/** 卡密明文只作为这一次 Server Action 的返回值给浏览器下载，不写入数据库或审计上下文。 */
export async function createRechargeCardsAction(formData: FormData): Promise<CreateRechargeCardsResult> {
  try {
    const admin = await requireAdminUser();
    const name = text(formData.get("name"), 100);
    const amount = moneyToCents(formData.get("amount"));
    const quantity = intValue(formData.get("quantity"), 1, 5_000);
    const expiresAt = dateToMysqlBoundary(formData.get("expiresAt"), "end");
    if (!name) return fail("请填写批次名称");
    if (amount === undefined || amount === null || amount <= 0) return fail("请填写大于零的卡密面额");
    if (!quantity) return fail("生成数量需在 1 到 5000 之间");
    if (expiresAt === undefined) return fail("有效期格式不正确");
    const created = await createRechargeCardBatch(admin.id, { name, amount, quantity, expiresAt });
    await audit("admin.recharge_cards_created", "recharge_card_batch", created.id, { batchNo: created.batchNo, name, amount, quantity, expiresAt }, admin.id);
    refreshAdmin();
    return { ok: true, message: `已生成 ${quantity} 张卡密，请立即下载 CSV`, cards: created.cards, batchNo: created.batchNo, amount };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "生成卡密失败");
  }
}

export async function disableRechargeCardAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const id = intValue(formData.get("id"), 1);
    if (!id) return fail("卡密编号不正确");
    await disableRechargeCard(id);
    await audit("admin.recharge_card_disabled", "recharge_card", id, {}, admin.id);
    refreshAdmin();
    return ok("卡密已停用");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "停用卡密失败");
  }
}

export async function enableRechargeCardAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const id = intValue(formData.get("id"), 1);
    if (!id) return fail("卡密编号不正确");
    await enableRechargeCard(id);
    await audit("admin.recharge_card_enabled", "recharge_card", id, {}, admin.id);
    refreshAdmin();
    return ok("卡密已恢复启用");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "恢复卡密失败");
  }
}

/** 卡密明细只在管理员展开一个批次时加载，每页固定 50 条。 */
export async function getRechargeCardBatchDetailsAction(batchId: number, page = 1) {
  return getAdminRechargeCardBatchDetails(batchId, page);
}

// ---------------------------------------------------------------------------
// 套餐
// ---------------------------------------------------------------------------

const PLAN_PRICE_FIELDS = [
  "monthPrice", "quarterPrice", "halfYearPrice", "yearPrice",
  "twoYearPrice", "threeYearPrice", "onetimePrice", "resetPrice",
] as const;

const PLAN_PRICE_COLUMNS: Record<(typeof PLAN_PRICE_FIELDS)[number], string> = {
  monthPrice: "month_price",
  quarterPrice: "quarter_price",
  halfYearPrice: "half_year_price",
  yearPrice: "year_price",
  twoYearPrice: "two_year_price",
  threeYearPrice: "three_year_price",
  onetimePrice: "onetime_price",
  resetPrice: "reset_price",
};

export async function savePlanAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const id = intValue(formData.get("id"), 1);
    const name = text(formData.get("name"));
    const transferEnable = intValue(formData.get("transferEnable"), 0, 1_000_000);
    const speedLimit = optionalInt(formData.get("speedLimit"), 0, 1_000_000);
    const capacityLimit = optionalInt(formData.get("capacityLimit"), 0, 1_000_000);
    const sortOrder = intValue(formData.get("sortOrder"), 0, 100_000);
    const content = optionalText(formData.get("content"), 5000);
    const groupId = optionalInt(formData.get("groupId"), 1);
    const deviceLimit = optionalInt(formData.get("deviceLimit"), 0, 1000);

    if (!name) return fail("请填写套餐名称");
    if (groupId === undefined) return fail("节点权限组不正确");
    if (deviceLimit === undefined) return fail("设备数上限需为 0 到 1000 的整数，留空或 0 表示不限");
    if (transferEnable === null) return fail("流量需为 0 到 1000000 之间的整数（GB）");
    if (speedLimit === undefined) return fail("限速需为非负整数（Mbps），留空表示不限速");
    if (capacityLimit === undefined) return fail("人数上限需为非负整数，留空表示不限");
    if (sortOrder === null) return fail("排序值不正确");

    // 至少配置一个可售周期，否则套餐在前台无法下单。
    const prices: Record<string, number | null> = {};
    for (const field of PLAN_PRICE_FIELDS) {
      const cents = moneyToCents(formData.get(field));
      if (cents === undefined) return fail(`价格「${field}」格式不正确，请填写非负金额或留空`);
      prices[field] = cents;
    }
    if (Object.values(prices).every((value) => value === null)) {
      return fail("至少需要配置一个付款周期的价格，否则该套餐无法售卖");
    }

    const pool = getDbPool();
    const columns = ["name", "group_id", "device_limit", "transfer_enable", "speed_limit", "capacity_limit", "content", "sort_order", "is_visible", "is_renewable"];
    const values: Array<string | number | null> = [
      name, groupId, deviceLimit, transferEnable, speedLimit ?? null, capacityLimit ?? null, content, sortOrder,
      checkbox(formData.get("isVisible")), checkbox(formData.get("isRenewable")),
    ];
    for (const field of PLAN_PRICE_FIELDS) {
      columns.push(PLAN_PRICE_COLUMNS[field]);
      values.push(prices[field]);
    }

    if (id) {
      await pool.execute(
        `UPDATE plans SET ${columns.map((column) => `${column} = ?`).join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [...values, id],
      );
      // 改权限组会改变持有该套餐的用户能用的节点。
      await markAllPanelClientsDirty(pool);
      await audit("admin.plan_saved", "plan", id, { name, groupId, transferEnable, updated: true }, admin.id);
      refreshAdmin();
      return ok("套餐已保存");
    }

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO plans (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      values,
    );
    await audit("admin.plan_saved", "plan", result.insertId, { name, transferEnable, created: true }, admin.id);
    refreshAdmin();
    return ok("套餐已创建");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "保存套餐失败");
  }
}

export async function deletePlanAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const id = intValue(formData.get("id"), 1);
    if (!id) return fail("套餐编号不正确");

    const pool = getDbPool();
    const [orders] = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM orders WHERE plan_id = ?",
      [id],
    );
    if (Number(orders[0]?.total) > 0) {
      return fail("该套餐已有历史订单，无法删除；请改为「前台隐藏」以停止售卖");
    }
    const [users] = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM users WHERE plan_id = ?",
      [id],
    );
    if (Number(users[0]?.total) > 0) {
      return fail("仍有用户订阅该套餐，无法删除；请改为「前台隐藏」");
    }

    const [result] = await pool.execute<ResultSetHeader>("DELETE FROM plans WHERE id = ?", [id]);
    if (result.affectedRows !== 1) return fail("套餐不存在");

    await audit("admin.plan_deleted", "plan", id, {}, admin.id);
    refreshAdmin();
    return ok("套餐已删除");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "删除套餐失败");
  }
}

// ---------------------------------------------------------------------------
// 优惠券
// ---------------------------------------------------------------------------

/** 逗号或空格分隔的 ID / 周期串 → JSON 数组；留空表示不限。 */
function csvToJsonArray(value: FormDataEntryValue | null, mode: "number" | "text"): string | null | undefined {
  const raw = text(value, 1000);
  if (!raw) return null;
  const parts = raw.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean);
  if (!parts.length) return null;
  if (mode === "number") {
    const numbers: number[] = [];
    for (const part of parts) {
      const parsed = Number(part);
      if (!Number.isInteger(parsed) || parsed < 1) return undefined;
      numbers.push(parsed);
    }
    return JSON.stringify(numbers);
  }
  return JSON.stringify(parts);
}

/** YYYY-MM-DD → 当日 00:00:00+08:00（起点）/ 23:59:59+08:00（终点）的本地时间串。 */
function dateToMysqlBoundary(value: FormDataEntryValue | null, edge: "start" | "end"): string | null | undefined {
  const raw = text(value, 32);
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const time = edge === "start" ? "00:00:00" : "23:59:59";
  const parsed = new Date(`${raw}T${time}+08:00`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  // 转成 MySQL DATETIME 字面量（东八区挂钟时间），与 CURRENT_TIMESTAMP 的时区设置保持一致。
  const shifted = new Date(parsed.getTime() + 8 * 3600 * 1000);
  return shifted.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * YYYY-MM-DDTHH:mm（datetime-local，按东八区理解）→ MySQL DATETIME 字面量，但存 UTC 挂钟时间。
 *
 * 与 dateToMysqlBoundary 的区别在于「谁来比较这个时间」：
 * 优惠券的起止时间由前端拿本地时间比对，所以按东八区挂钟存；
 * 公告的 published_at 是 listNotices 在 SQL 里直接与 CURRENT_TIMESTAMP 比（会话时区为 UTC），
 * 因此必须存 UTC，否则排期会整体差 8 小时。
 */
function dateTimeToMysqlUtc(value: FormDataEntryValue | null): string | null | undefined {
  const raw = text(value, 32);
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return undefined;
  const parsed = new Date(`${raw}:00+08:00`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 19).replace("T", " ");
}

export async function saveCouponAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const id = intValue(formData.get("id"), 1);
    const code = text(formData.get("code"), 64).toUpperCase();
    const name = text(formData.get("name"), 255);
    const discountType = intValue(formData.get("discountType"), 1, 2);
    const discountValue = intValue(formData.get("discountValue"), 1, 100_000_000);
    const maxUses = optionalInt(formData.get("maxUses"), 1, 1_000_000);
    const maxUsesPerUser = optionalInt(formData.get("maxUsesPerUser"), 1, 1_000_000);
    const planIds = csvToJsonArray(formData.get("planIds"), "number");
    const periods = csvToJsonArray(formData.get("periods"), "text");
    const startsAt = dateToMysqlBoundary(formData.get("startsAt"), "start");
    const endsAt = dateToMysqlBoundary(formData.get("endsAt"), "end");

    if (!/^[A-Z0-9_-]{3,64}$/.test(code)) return fail("优惠码只能包含 3-64 位大写字母、数字、下划线或连字符");
    if (!name) return fail("请填写优惠券名称");
    if (discountType === null) return fail("折扣类型不正确");
    if (discountValue === null) return fail("请填写有效的折扣值");
    if (discountType === 2 && discountValue > 100) return fail("百分比折扣不能大于 100");
    if (maxUses === undefined) return fail("总发行量需为正整数，留空表示不限");
    if (maxUsesPerUser === undefined) return fail("每人限用次数需为正整数，留空表示不限");
    if (planIds === undefined) return fail("适用套餐需填写逗号分隔的套餐 ID");
    if (periods === undefined) return fail("适用周期格式不正确");
    if (startsAt === undefined) return fail("开始时间格式不正确，请使用日期选择器");
    if (endsAt === undefined) return fail("结束时间格式不正确，请使用日期选择器");
    if (startsAt && endsAt && startsAt > endsAt) return fail("结束时间不能早于开始时间");
    if (maxUsesPerUser !== null && maxUsesPerUser !== undefined && maxUses !== null && maxUses !== undefined && maxUsesPerUser > maxUses) {
      return fail("每人限用次数不能大于总发行量");
    }

    const pool = getDbPool();
    const columns = [
      "code", "name", "discount_type", "discount_value", "max_uses", "max_uses_per_user",
      "plan_ids", "periods", "starts_at", "ends_at", "is_visible", "is_active",
    ];
    const values: Array<string | number | null> = [
      code, name, discountType, discountValue,
      maxUses ?? null, maxUsesPerUser ?? null,
      planIds, periods, startsAt, endsAt,
      checkbox(formData.get("isVisible")), checkbox(formData.get("isActive")),
    ];

    if (id) {
      // 优惠码唯一，改码时先确认没有撞上别的券。
      const [conflict] = await pool.execute<RowDataPacket[]>(
        "SELECT id FROM coupons WHERE code = ? AND id <> ? LIMIT 1",
        [code, id],
      );
      if (conflict[0]) return fail(`优惠码 ${code} 已被占用`);

      const [result] = await pool.execute<ResultSetHeader>(
        `UPDATE coupons SET ${columns.map((column) => `${column} = ?`).join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [...values, id],
      );
      if (result.affectedRows !== 1) return fail("优惠券不存在或未发生变更");

      await audit("admin.coupon_saved", "coupon", id, { code, discountType, discountValue, updated: true }, admin.id);
      refreshAdmin();
      return ok("优惠券已保存");
    }

    const [existing] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM coupons WHERE code = ? LIMIT 1",
      [code],
    );
    if (existing[0]) return fail(`优惠码 ${code} 已存在`);

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO coupons (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      values,
    );
    await audit("admin.coupon_saved", "coupon", result.insertId, { code, discountType, discountValue, created: true }, admin.id);
    refreshAdmin();
    return ok("优惠券已创建");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "保存优惠券失败");
  }
}

export async function deleteCouponAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const id = intValue(formData.get("id"), 1);
    if (!id) return fail("优惠券编号不正确");

    const pool = getDbPool();
    // 已有核销记录的券不能删，否则历史订单的优惠信息会失去引用。
    const [usages] = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM coupon_usages WHERE coupon_id = ?",
      [id],
    );
    if (Number(usages[0]?.total) > 0) {
      return fail("该优惠券已有核销记录，无法删除；请改为「停用」以停止发放");
    }

    const [result] = await pool.execute<ResultSetHeader>("DELETE FROM coupons WHERE id = ?", [id]);
    if (result.affectedRows !== 1) return fail("优惠券不存在");

    await audit("admin.coupon_deleted", "coupon", id, {}, admin.id);
    refreshAdmin();
    return ok("优惠券已删除");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "删除优惠券失败");
  }
}

// ---------------------------------------------------------------------------
// 支付渠道
// ---------------------------------------------------------------------------

export async function savePaymentMethodAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const id = intValue(formData.get("id"), 1);
    const provider = text(formData.get("provider"), 50).toLowerCase();
    const name = text(formData.get("name"));
    const feeFixed = moneyToCents(formData.get("handlingFeeFixed"));
    const feePercent = Number(formData.get("handlingFeePercent"));
    const notifyDomain = optionalText(formData.get("notifyDomain"), 255);
    const sortOrder = intValue(formData.get("sortOrder"), 0, 100_000);
    const callbackSecret = text(formData.get("callbackSecret"), 1000);

    if (!provider || !/^[a-z0-9_-]{2,50}$/.test(provider)) return fail("Provider 标识只能包含小写字母、数字、下划线和短横线");
    if (provider === "balance") return fail("余额支付为系统内置渠道，不能手工修改");
    if (!name) return fail("请填写渠道名称");
    if (feeFixed === undefined || feeFixed === null) return fail("固定手续费需为非负金额");
    if (!Number.isFinite(feePercent) || feePercent < 0 || feePercent > 100) return fail("比例手续费需在 0 到 100 之间");
    if (sortOrder === null) return fail("排序值不正确");
    if (notifyDomain && !/^https?:\/\/.+/i.test(notifyDomain)) return fail("回调域名需以 http:// 或 https:// 开头");

    const pool = getDbPool();
    const values = [provider, name, feeFixed, Math.round(feePercent * 100) / 100, notifyDomain, checkbox(formData.get("isEnabled")), sortOrder];

    if (id) {
      await pool.execute(
        `UPDATE payment_methods SET provider = ?, name = ?, handling_fee_fixed = ?, handling_fee_percent = ?,
           notify_domain = ?, is_enabled = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [...values, id],
      );
      if (callbackSecret) await savePaymentCallbackSecret(id, callbackSecret, admin.id);
      await audit("admin.payment_saved", "payment_method", id, { provider, name, updated: true }, admin.id);
      refreshAdmin();
      return ok("支付渠道已保存");
    }

    const [created] = await pool.execute<ResultSetHeader>(
      `INSERT INTO payment_methods (uuid, provider, name, config, handling_fee_fixed, handling_fee_percent, notify_domain, is_enabled, sort_order)
       VALUES (?, ?, ?, JSON_OBJECT(), ?, ?, ?, ?, ?)`,
      [randomUUID().replaceAll("-", ""), ...values],
    );
    if (callbackSecret) await savePaymentCallbackSecret(Number(created.insertId), callbackSecret, admin.id);
    await audit("admin.payment_saved", "payment_method", provider, { provider, name, created: true, callbackSecretUpdated: Boolean(callbackSecret) }, admin.id);
    refreshAdmin();
    return ok("支付渠道已创建");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "保存支付渠道失败");
  }
}

export async function deletePaymentMethodAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const id = intValue(formData.get("id"), 1);
    if (!id) return fail("渠道编号不正确");

    const pool = getDbPool();
    const [methods] = await pool.execute<RowDataPacket[]>("SELECT provider FROM payment_methods WHERE id = ? LIMIT 1", [id]);
    if (methods[0] && String(methods[0].provider) === "balance") return fail("余额支付为系统内置渠道，不能删除");
    const [transactions] = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM payment_transactions WHERE payment_method_id = ?",
      [id],
    );
    if (Number(transactions[0]?.total) > 0) {
      return fail("该渠道已有交易流水，无法删除；请改为「停用」");
    }

    const [result] = await pool.execute<ResultSetHeader>("DELETE FROM payment_methods WHERE id = ?", [id]);
    if (result.affectedRows !== 1) return fail("支付渠道不存在");

    await audit("admin.payment_saved", "payment_method", id, { deleted: true }, admin.id);
    refreshAdmin();
    return ok("支付渠道已删除");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "删除支付渠道失败");
  }
}

// ---------------------------------------------------------------------------
// 退款、签名沙箱与对账
// ---------------------------------------------------------------------------

export async function refundBalanceOrderAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const orderId = intValue(formData.get("orderId"), 1);
    const reason = text(formData.get("reason"), 500);
    if (!orderId) return fail("订单编号不正确");
    if (!reason) return fail("请填写退款原因");
    if (checkbox(formData.get("confirmed")) !== 1) return fail("请勾选确认退款后再提交");
    const refund = await refundBalanceOrder(orderId, admin.id, reason);
    await audit("admin.payment_refunded", "payment_refund", refund.id, { orderId, transactionId: refund.transactionId, amount: refund.amount, reason }, admin.id);
    refreshAdmin();
    return ok(`退款完成，已退回 ${(refund.amount / 100).toFixed(2)} 元余额`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "退款失败");
  }
}

export async function sendSandboxPaymentCallbackAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const transactionId = intValue(formData.get("transactionId"), 1);
    if (!transactionId) return fail("支付交易编号不正确");
    const result = await dispatchSandboxPaymentCallback(transactionId);
    await audit("admin.payment_sandbox_callback", "payment_transaction", transactionId, { result }, admin.id);
    refreshAdmin();
    return ok(result.processed ? "签名沙箱回调已完成订单履约" : "签名沙箱回调已接收，等待人工处理");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "签名沙箱回调失败");
  }
}

export async function importReconciliationCsvAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const provider = text(formData.get("provider"), 50).toLowerCase();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return fail("请选择 CSV 账单文件");
    if (file.size > 2_000_000) return fail("CSV 文件不能超过 2MB");
    const result = await importReconciliationCsv({ provider, filename: file.name, csv: await file.text(), adminId: admin.id });
    await audit("admin.reconciliation_imported", "reconciliation_batch", result.batchId, { provider, total: result.total, matched: result.matched, issues: result.issues }, admin.id);
    refreshAdmin();
    return ok(`对账导入完成：${result.matched} 条匹配，${result.issues} 条待处理`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "导入对账账单失败");
  }
}

export async function resolveReconciliationRowAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const rowId = intValue(formData.get("rowId"), 1);
    const note = text(formData.get("note"), 500);
    if (!rowId) return fail("对账明细编号不正确");
    await resolveReconciliationRow(rowId, admin.id, note);
    await audit("admin.reconciliation_resolved", "reconciliation_row", rowId, { resolution: "ignored", note }, admin.id);
    refreshAdmin();
    return ok("差异已标记为已处理，不会自动改账");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "处理对账差异失败");
  }
}

// ---------------------------------------------------------------------------
// 节点
// ---------------------------------------------------------------------------

const PROTOCOL_PATTERN = /^[a-z0-9_-]{2,32}$/;

export async function saveNodeAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const id = intValue(formData.get("id"), 1);
    const name = text(formData.get("name"));
    const protocol = text(formData.get("protocol"), 32).toLowerCase();
    const host = text(formData.get("host"), 255);
    const port = intValue(formData.get("port"), 1, 65535);
    const serverPort = optionalInt(formData.get("serverPort"), 1, 65535);
    const rate = Number(formData.get("rate"));
    const panel = text(formData.get("externalPanel"), 50) || "3x-ui";
    const inboundId = optionalText(formData.get("externalInboundId"), 128);
    const tags = optionalText(formData.get("tags"), 255);
    const sortOrder = intValue(formData.get("sortOrder"), 0, 100_000);
    const groupIds = [...new Set(formData.getAll("groupIds").map((value) => intValue(value, 1)))];
    if (groupIds.some((value) => value === null)) return fail("节点权限组不正确");

    if (!name) return fail("请填写节点名称");
    if (!PROTOCOL_PATTERN.test(protocol)) return fail("协议只能包含小写字母、数字、下划线和短横线");
    if (!host) return fail("请填写节点地址");
    if (port === null) return fail("端口需为 1 到 65535 之间的整数");
    if (serverPort === undefined) return fail("服务端口需为 1 到 65535 之间的整数，留空表示与端口一致");
    if (!Number.isFinite(rate) || rate <= 0 || rate > 100) return fail("倍率需大于 0 且不超过 100");
    if (sortOrder === null) return fail("排序值不正确");

    // tags 以 JSON 数组存储，这里允许逗号分隔输入。
    const tagList = tags ? tags.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 20) : null;

    const pool = getDbPool();
    const values = [
      name, protocol, host, port, serverPort ?? null, rate, panel, inboundId,
      tagList ? JSON.stringify(tagList) : null, checkbox(formData.get("isVisible")),
      checkbox(formData.get("isEnabled")), checkbox(formData.get("isOnline")), sortOrder,
    ];

    if (id) {
      // 从 3x-ui 导入的节点：协议 / 来源面板 / 入站 ID / 服务端口以面板为准，只能靠重新导入刷新，
      // 表单里即使被改动也原样保留（IF 分支按 snapshot_hash 判定是否导入节点）。
      await pool.execute(
        `UPDATE nodes SET name = ?,
           protocol = IF(snapshot_hash IS NULL, ?, protocol),
           host = ?, port = ?,
           server_port = IF(snapshot_hash IS NULL, ?, server_port),
           rate = ?,
           external_panel = IF(snapshot_hash IS NULL, ?, external_panel),
           external_inbound_id = IF(snapshot_hash IS NULL, ?, external_inbound_id),
           tags = ?, is_visible = ?, is_enabled = ?, is_online = ?,
           sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [...values, id],
      );
      await replaceNodeGroups(id, groupIds as number[]);
      await audit("admin.node_saved", "node", id, { name, host, port, groupIds, updated: true }, admin.id);
      refreshAdmin();
      return ok("节点已保存");
    }

    const [created] = await pool.execute<ResultSetHeader>(
      `INSERT INTO nodes (name, protocol, host, port, server_port, rate, external_panel, external_inbound_id, tags, is_visible, is_enabled, is_online, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      values,
    );
    await replaceNodeGroups(created.insertId, groupIds as number[]);
    await audit("admin.node_saved", "node", created.insertId, { name, host, port, groupIds, created: true }, admin.id);
    refreshAdmin();
    return ok("节点已创建");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "保存节点失败");
  }
}

/** 覆盖写节点所属权限组，并让所有用户重新计算可用节点（节点启停也走这里）。 */
async function replaceNodeGroups(nodeId: number, groupIds: number[]): Promise<void> {
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("DELETE FROM node_access_groups WHERE node_id = ?", [nodeId]);
    for (const groupId of groupIds) {
      await connection.execute("INSERT INTO node_access_groups (node_id, group_id) VALUES (?, ?)", [nodeId, groupId]);
    }
    await markAllPanelClientsDirty(connection);
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

export async function saveAccessGroupAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const id = intValue(formData.get("id"), 1);
    const name = text(formData.get("name"), 100);
    if (!name) return fail("请填写权限组名称");
    const pool = getDbPool();
    try {
      if (id) {
        const [result] = await pool.execute<ResultSetHeader>(
          "UPDATE access_groups SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          [name, id],
        );
        if (result.affectedRows !== 1) return fail("权限组不存在");
      } else {
        await pool.execute("INSERT INTO access_groups (name) VALUES (?)", [name]);
      }
    } catch (error) {
      if ((error as { code?: string }).code === "ER_DUP_ENTRY") return fail("已有同名权限组");
      throw error;
    }
    await audit("admin.access_group_saved", "access_group", id ?? name, { name, created: !id }, admin.id);
    refreshAdmin();
    return ok(id ? "权限组已重命名" : "权限组已创建");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "保存权限组失败");
  }
}

export async function deleteAccessGroupAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const id = intValue(formData.get("id"), 1);
    if (!id) return fail("权限组编号不正确");
    const pool = getDbPool();
    const [plans] = await pool.execute<RowDataPacket[]>("SELECT COUNT(*) AS total FROM plans WHERE group_id = ?", [id]);
    if (Number(plans[0]?.total) > 0) {
      return fail("仍有套餐使用该权限组，删除会让这些套餐的用户失去全部节点；请先把套餐改到其他权限组");
    }
    const [result] = await pool.execute<ResultSetHeader>("DELETE FROM access_groups WHERE id = ?", [id]);
    if (result.affectedRows !== 1) return fail("权限组不存在");
    await audit("admin.access_group_deleted", "access_group", id, {}, admin.id);
    refreshAdmin();
    return ok("权限组已删除");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "删除权限组失败");
  }
}

export async function importInboundsAction(): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const result = await importInbounds();
    await audit("admin.nodes_imported", "node", "3x-ui", result, admin.id);
    refreshAdmin();
    const parts = [`新增 ${result.created}`, `更新 ${result.updated}`, `未变 ${result.unchanged}`];
    if (result.restored) parts.push(`恢复 ${result.restored}`);
    if (result.missing) parts.push(`面板中已不存在 ${result.missing}`);
    if (result.skipped) parts.push(`无法识别 ${result.skipped}`);
    return ok(`已从 3x-ui ${result.panelVersion} 同步 ${result.total} 个入站：${parts.join("，")}`);
  } catch (error) {
    if (error instanceof PanelError) return fail(error.message);
    return fail(error instanceof Error ? error.message : "同步 3x-ui 入站失败");
  }
}

export async function deleteNodeAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const id = intValue(formData.get("id"), 1);
    if (!id) return fail("节点编号不正确");

    const pool = getDbPool();
    const [accounts] = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM proxy_accounts WHERE node_id = ?",
      [id],
    );
    if (Number(accounts[0]?.total) > 0) {
      return fail(`该节点仍分配给 ${Number(accounts[0]?.total)} 个用户；请先取消「启用」，等待同步完成（账号数归零）后再删除`);
    }

    const [result] = await pool.execute<ResultSetHeader>("DELETE FROM nodes WHERE id = ?", [id]);
    if (result.affectedRows !== 1) return fail("节点不存在");
    await markAllPanelClientsDirty(pool);

    await audit("admin.node_saved", "node", id, { deleted: true }, admin.id);
    refreshAdmin();
    return ok("节点已删除");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "删除节点失败");
  }
}

// ---------------------------------------------------------------------------
// 工单
// ---------------------------------------------------------------------------

export async function saveTicketAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const id = intValue(formData.get("id"), 1);
    const level = intValue(formData.get("level"), 0, 2);
    const status = intValue(formData.get("status"), 0, 1);
    if (!id) return fail("工单编号不正确");
    if (level === null || ![0, 1, 2].includes(level)) return fail("优先级不正确");
    if (status === null || ![0, 1].includes(status)) return fail("处理状态不正确");

    const [result] = await getDbPool().execute<ResultSetHeader>(
      `UPDATE tickets SET level = ?, status = ?,
         closed_at = IF(? = 1, COALESCE(closed_at, CURRENT_TIMESTAMP), NULL),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [level, status, status, id],
    );
    if (result.affectedRows !== 1) return fail("工单不存在");

    await audit("admin.ticket_updated", "ticket", id, { level, status }, admin.id);
    refreshAdmin();
    return ok(status === 1 ? "工单已关闭" : "工单已更新");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "保存工单失败");
  }
}

export async function replyTicketAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const id = intValue(formData.get("id"), 1);
    const message = text(formData.get("message"), 10000);
    if (!id) return fail("工单编号不正确");
    if (!message) return fail("回复内容不能为空");

    const pool = getDbPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [tickets] = await connection.execute<RowDataPacket[]>(
        "SELECT id, status FROM tickets WHERE id = ? LIMIT 1 FOR UPDATE",
        [id],
      );
      const ticket = tickets[0];
      if (!ticket) {
        await connection.rollback();
        return fail("工单不存在");
      }
      if (Number(ticket.status) !== 0) {
        await connection.rollback();
        return fail("工单已关闭，请先恢复为「处理中」再回复");
      }

      await connection.execute(
        `INSERT INTO ticket_messages (ticket_id, user_id, sender_role, message) VALUES (?, ?, 'staff', ?)`,
        [id, admin.id, message],
      );
      // 客服回复后标记为「已回复」，并把工单置为处理中。
      await connection.execute(
        `UPDATE tickets SET reply_status = 1, status = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [id],
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await audit("admin.ticket_replied", "ticket", id, { length: message.length }, admin.id);
    refreshAdmin();
    return ok("回复已发送");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "回复工单失败");
  }
}

export async function getTicketMessagesAction(ticketId: number) {
  await requireAdminUser();
  return getAdminTicketMessages(ticketId);
}

// ---------------------------------------------------------------------------
// 订单
// ---------------------------------------------------------------------------

/**
 * 修改待支付订单：套餐 / 周期 / 优惠券。
 * 金额走与用户下单同一套价格链重算，因此续费限制、升级折抵规则一并生效。
 * 已支付订单不允许改金额——那是对账依据。
 */
export async function saveOrderAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const id = intValue(formData.get("id"), 1);
    const planId = intValue(formData.get("planId"), 1);
    const period = text(formData.get("period"), 32);
    const couponCode = text(formData.get("couponCode"), 64);

    if (!id) return fail("订单编号不正确");
    if (!planId) return fail("请选择套餐");
    if (!period) return fail("请选择付款周期");

    const result = await updatePendingOrder(id, { planId, period, couponCode });
    await audit("admin.order_updated", "order", id, {
      planId, period, couponCode: couponCode || null, payable: result.payable,
    }, admin.id);
    refreshAdmin();
    return ok(`订单已更新，应付 ${(result.payable / 100).toFixed(2)} 元`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "更新订单失败");
  }
}

/**
 * 人工补单：把待支付订单直接推进为已完成。
 *
 * 用于线下转账、支付回调丢失等网关覆盖不到的场景。必须填写原因，
 * 订单会标记 fulfillment_source='admin' 并记录操作管理员，与网关回调可区分，
 * 对账时不会把人工开通误算成真实收款。
 */
export async function fulfillOrderAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const id = intValue(formData.get("id"), 1);
    const reason = text(formData.get("reason"), 500);
    if (!id) return fail("订单编号不正确");
    if (!reason) return fail("请填写补单原因，便于事后对账");

    const order = await fulfillOrderByAdmin(id, admin.id, reason);
    await audit("admin.order_manually_fulfilled", "order", id, {
      reason, tradeNo: order?.trade_no ?? null, source: "admin",
    }, admin.id);
    refreshAdmin();
    return ok("补单完成，订阅已开通");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "补单失败");
  }
}

/** 保存订单内部备注（仅后台可见）。 */
export async function saveOrderRemarkAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const id = intValue(formData.get("id"), 1);
    const remark = text(formData.get("remark"), 500);
    if (!id) return fail("订单编号不正确");

    await updateOrderRemark(id, remark);
    await audit("admin.order_remark_saved", "order", id, { remark }, admin.id);
    refreshAdmin();
    return ok(remark ? "备注已保存" : "备注已清空");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "保存备注失败");
  }
}

export async function updateOrderStatusAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const id = intValue(formData.get("id"), 1);
    const status = intValue(formData.get("status"), 0, 5);
    if (!id) return fail("订单编号不正确");
    // 只允许在「待支付」与「已取消」之间切换；已支付订单必须走支付回调履约。
    if (status !== ORDER_STATUS.PENDING && status !== ORDER_STATUS.CANCELLED) {
      return fail("订单只能在待支付和已取消之间切换，已支付订单须经支付回调履约");
    }

    const pool = getDbPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT id, coupon_id, status FROM orders WHERE id = ? LIMIT 1 FOR UPDATE`,
        [id],
      );
      const order = rows[0];
      if (!order) {
        await connection.rollback();
        return fail("订单不存在");
      }
      if (Number(order.status) !== ORDER_STATUS.PENDING && Number(order.status) !== ORDER_STATUS.CANCELLED) {
        await connection.rollback();
        return fail("订单不存在，或已进入不可手动修改的状态");
      }

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE orders SET status = ?, cancelled_at = IF(? = 2, CURRENT_TIMESTAMP, NULL), updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status IN (0, 2)`,
        [status, status, id],
      );
      if (result.affectedRows !== 1) {
        await connection.rollback();
        return fail("订单不存在，或已进入不可手动修改的状态");
      }

      // 后台取消订单时同样释放优惠券占用，保持与用户端取消一致。
      // 核销事实只存在 coupon_usages，删除即完成释放。
      if (status === ORDER_STATUS.CANCELLED && order.coupon_id !== null) {
        await connection.execute(`DELETE FROM coupon_usages WHERE order_id = ?`, [id]);
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await audit("admin.order_status_changed", "order", id, { status }, admin.id);
    refreshAdmin();
    return ok(status === ORDER_STATUS.CANCELLED ? "订单已取消" : "订单已恢复待支付");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "更新订单失败");
  }
}

// ---------------------------------------------------------------------------
// 公告
// ---------------------------------------------------------------------------

/**
 * 正文长度上限。
 *
 * notices.content 是 TEXT（65535 字节），utf8mb4 下一个汉字占 3 字节，
 * 20000 字留出了足够余量；knowledge_articles.body 是 MEDIUMTEXT，放宽到 60000 字。
 */
const NOTICE_CONTENT_MAX = 20_000;
const KNOWLEDGE_BODY_MAX = 60_000;

/** 富文本入库前的统一处理：净化 → 校验确实还有可见内容 → 校验字节长度。 */
function prepareRichText(
  value: FormDataEntryValue | null,
  charLimit: number,
  byteLimit: number,
  label: string,
): { html: string } | { error: string } {
  const raw = String(value ?? "").trim().slice(0, charLimit);
  if (!raw) return { error: `请填写${label}` };
  const html = sanitizeRichText(raw);
  if (!hasVisibleContent(html)) return { error: `${label}在过滤后为空，请检查是否只包含不支持的标签` };
  if (Buffer.byteLength(html, "utf8") > byteLimit) {
    return { error: `${label}超出长度上限，请精简内容后重试` };
  }
  return { html };
}

/** 图片地址只允许站内路径或 http(s) 外链，避免把 data:/javascript: 塞进 <img src>。 */
function imageUrl(value: FormDataEntryValue | null): string | null | undefined {
  const raw = text(value, 255);
  if (!raw) return null;
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  if (/^https?:\/\/[^\s]+$/i.test(raw)) return raw;
  return undefined;
}

export async function saveNoticeAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const id = intValue(formData.get("id"), 1);
    const title = text(formData.get("title"), 255);
    const image = imageUrl(formData.get("imageUrl"));
    const publishedAt = dateTimeToMysqlUtc(formData.get("publishedAt"));
    const isVisible = checkbox(formData.get("isVisible"));

    if (!title) return fail("请填写公告标题");
    if (image === undefined) return fail("封面地址需为站内路径（/ 开头）或 http(s) 外链");
    if (publishedAt === undefined) return fail("发布时间格式不正确，请使用日期时间选择器");

    const prepared = prepareRichText(formData.get("content"), NOTICE_CONTENT_MAX, 65_000, "公告正文");
    if ("error" in prepared) return fail(prepared.error);

    // tags 以 JSON 数组存储，这里允许逗号分隔输入。
    const rawTags = text(formData.get("tags"), 600);
    const tagList = rawTags
      ? rawTags.split(/[,，]/).map((item) => item.trim()).filter(Boolean).slice(0, 20)
      : null;

    const pool = getDbPool();
    if (id) {
      const [result] = await pool.execute<ResultSetHeader>(
        `UPDATE notices SET title = ?, content = ?, image_url = ?, tags = ?, is_visible = ?, published_at = ?
          WHERE id = ?`,
        [title, prepared.html, image, tagList ? JSON.stringify(tagList) : null, isVisible, publishedAt, id],
      );
      if (result.affectedRows !== 1) return fail("公告不存在或未发生变更");

      await audit("admin.notice_saved", "notice", id, { title, isVisible, publishedAt, updated: true }, admin.id);
      refreshAdmin();
      return ok("公告已保存");
    }

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO notices (title, content, image_url, tags, is_visible, published_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [title, prepared.html, image, tagList ? JSON.stringify(tagList) : null, isVisible, publishedAt, admin.id],
    );
    await audit("admin.notice_saved", "notice", result.insertId, { title, isVisible, publishedAt, created: true }, admin.id);
    refreshAdmin();
    return ok("公告已创建");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "保存公告失败");
  }
}

export async function deleteNoticeAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const id = intValue(formData.get("id"), 1);
    if (!id) return fail("公告编号不正确");

    const [result] = await getDbPool().execute<ResultSetHeader>("DELETE FROM notices WHERE id = ?", [id]);
    if (result.affectedRows !== 1) return fail("公告不存在");

    await audit("admin.notice_deleted", "notice", id, {}, admin.id);
    refreshAdmin();
    return ok("公告已删除");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "删除公告失败");
  }
}

// ---------------------------------------------------------------------------
// 使用文档
// ---------------------------------------------------------------------------

/** 与门户语言切换器保持同一套语言码，避免出现前台永远匹配不上的值。 */
const KNOWLEDGE_LANGUAGES = new Set(["zh-CN", "zh-TW", "en-US", "ja-JP", "vi-VN", "ko-KR", "fa-IR"]);

export async function saveKnowledgeAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const id = intValue(formData.get("id"), 1);
    const language = text(formData.get("language"), 10) || "zh-CN";
    const category = text(formData.get("category"), 100);
    const title = text(formData.get("title"), 255);
    const sortOrder = intValue(formData.get("sortOrder"), 0, 100_000);
    const isVisible = checkbox(formData.get("isVisible"));

    if (!KNOWLEDGE_LANGUAGES.has(language)) return fail("语言标签不正确");
    if (!category) return fail("请填写文档分类");
    if (!title) return fail("请填写文档标题");
    if (sortOrder === null) return fail("排序值不正确");

    const prepared = prepareRichText(formData.get("body"), KNOWLEDGE_BODY_MAX, 16_000_000, "文档正文");
    if ("error" in prepared) return fail(prepared.error);

    const pool = getDbPool();
    if (id) {
      const [result] = await pool.execute<ResultSetHeader>(
        `UPDATE knowledge_articles SET language = ?, category = ?, title = ?, body = ?, sort_order = ?, is_visible = ?
          WHERE id = ?`,
        [language, category, title, prepared.html, sortOrder, isVisible, id],
      );
      if (result.affectedRows !== 1) return fail("文档不存在或未发生变更");

      await audit("admin.knowledge_saved", "knowledge_article", id, { title, category, language, isVisible, updated: true }, admin.id);
      refreshAdmin();
      return ok("文档已保存");
    }

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO knowledge_articles (language, category, title, body, sort_order, is_visible, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [language, category, title, prepared.html, sortOrder, isVisible, admin.id],
    );
    await audit("admin.knowledge_saved", "knowledge_article", result.insertId, { title, category, language, isVisible, created: true }, admin.id);
    refreshAdmin();
    return ok("文档已创建");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "保存文档失败");
  }
}

export async function deleteKnowledgeAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requireAdminUser();
    const id = intValue(formData.get("id"), 1);
    if (!id) return fail("文档编号不正确");

    const [result] = await getDbPool().execute<ResultSetHeader>("DELETE FROM knowledge_articles WHERE id = ?", [id]);
    if (result.affectedRows !== 1) return fail("文档不存在");

    await audit("admin.knowledge_deleted", "knowledge_article", id, {}, admin.id);
    refreshAdmin();
    return ok("文档已删除");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "删除文档失败");
  }
}

export async function getKnowledgeArticleAction(articleId: number) {
  await requireAdminUser();
  return getAdminKnowledgeArticle(articleId);
}
