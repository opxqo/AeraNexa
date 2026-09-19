"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { RowDataPacket } from "mysql2";
import { getDbPool } from "@/lib/server/db";
import { requireAdminUser } from "@/lib/server/admin";

type ActionResult = { ok: true; message: string } | { ok: false; message: string };

function intValue(value: FormDataEntryValue | null, minimum = 0): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : null;
}

function moneyToCents(value: FormDataEntryValue | null): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000) return null;
  return Math.round(parsed * 100);
}

function text(value: FormDataEntryValue | null, max = 255): string {
  return String(value ?? "").trim().slice(0, max);
}

function refreshAdmin() {
  revalidatePath("/admin");
  revalidatePath("/admin/users");
  revalidatePath("/admin/plans");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/payments");
  revalidatePath("/admin/nodes");
  revalidatePath("/admin/tickets");
}

export async function saveUserAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdminUser();
  const id = intValue(formData.get("id"), 1);
  const nickname = text(formData.get("nickname"), 50);
  const role = text(formData.get("role"), 20);
  const isActive = formData.get("isActive") === "on" ? 1 : 0;
  if (!id || !nickname || !["admin", "user"].includes(role)) return { ok: false, message: "用户信息不完整" };
  if (id === admin.id && (role !== "admin" || !isActive)) return { ok: false, message: "不能撤销当前登录管理员的权限或停用该账户" };
  const pool = getDbPool();
  if (role === "user") {
    const [rows] = await pool.query<(RowDataPacket & { count: number })[]>("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'");
    if (Number(rows[0]?.count) <= 1) return { ok: false, message: "至少需要保留一个管理员账户" };
  }
  const [result] = await pool.execute("UPDATE users SET nickname = ?, role = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [nickname, role, isActive, id]);
  if (!("affectedRows" in result) || result.affectedRows !== 1) return { ok: false, message: "用户不存在或未发生变更" };
  refreshAdmin();
  return { ok: true, message: "用户已保存" };
}

export async function savePlanAction(formData: FormData): Promise<ActionResult> {
  await requireAdminUser();
  const id = intValue(formData.get("id"), 1);
  const name = text(formData.get("name"));
  const transferEnable = intValue(formData.get("transferEnable"));
  const speedLimitText = text(formData.get("speedLimit"), 12);
  const speedLimit = speedLimitText ? intValue(speedLimitText) : null;
  const monthPrice = moneyToCents(formData.get("monthPrice"));
  if (!name || transferEnable === null || (speedLimitText && speedLimit === null) || monthPrice === null) return { ok: false, message: "请检查套餐名称、流量、限速和价格" };
  const pool = getDbPool();
  const values = [name, transferEnable, speedLimit, monthPrice, formData.get("isVisible") === "on" ? 1 : 0, formData.get("isRenewable") === "on" ? 1 : 0];
  if (id) {
    await pool.execute("UPDATE plans SET name = ?, transfer_enable = ?, speed_limit = ?, month_price = ?, is_visible = ?, is_renewable = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [...values, id]);
  } else {
    await pool.execute("INSERT INTO plans (name, transfer_enable, speed_limit, month_price, is_visible, is_renewable) VALUES (?, ?, ?, ?, ?, ?)", values);
  }
  refreshAdmin();
  return { ok: true, message: id ? "套餐已保存" : "套餐已创建" };
}

export async function savePaymentMethodAction(formData: FormData): Promise<ActionResult> {
  await requireAdminUser();
  const id = intValue(formData.get("id"), 1);
  const provider = text(formData.get("provider"), 50);
  const name = text(formData.get("name"));
  const feeFixed = moneyToCents(formData.get("handlingFeeFixed"));
  const feePercent = Number(formData.get("handlingFeePercent"));
  const notifyDomain = text(formData.get("notifyDomain"));
  if (!provider || !name || feeFixed === null || !Number.isFinite(feePercent) || feePercent < 0 || feePercent > 100) return { ok: false, message: "请检查支付渠道信息" };
  const pool = getDbPool();
  const values = [provider, name, feeFixed, feePercent, notifyDomain || null, formData.get("isEnabled") === "on" ? 1 : 0];
  if (id) {
    await pool.execute("UPDATE payment_methods SET provider = ?, name = ?, handling_fee_fixed = ?, handling_fee_percent = ?, notify_domain = ?, is_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [...values, id]);
  } else {
    await pool.execute("INSERT INTO payment_methods (uuid, provider, name, config, handling_fee_fixed, handling_fee_percent, notify_domain, is_enabled) VALUES (?, ?, ?, JSON_OBJECT(), ?, ?, ?, ?)", [randomUUID().replaceAll("-", ""), ...values]);
  }
  refreshAdmin();
  return { ok: true, message: id ? "支付渠道已保存" : "支付渠道已创建" };
}

export async function saveNodeAction(formData: FormData): Promise<ActionResult> {
  await requireAdminUser();
  const id = intValue(formData.get("id"), 1);
  const name = text(formData.get("name"));
  const protocol = text(formData.get("protocol"), 32).toLowerCase();
  const host = text(formData.get("host"));
  const port = intValue(formData.get("port"), 1);
  const rate = Number(formData.get("rate"));
  const panel = text(formData.get("externalPanel"), 50) || "3x-ui";
  if (!name || !protocol || !host || port === null || port > 65535 || !Number.isFinite(rate) || rate <= 0 || rate > 100) return { ok: false, message: "请检查节点名称、地址、端口、协议和倍率" };
  const pool = getDbPool();
  const values = [name, protocol, host, port, rate, panel, formData.get("isVisible") === "on" ? 1 : 0, formData.get("isOnline") === "on" ? 1 : 0];
  if (id) {
    await pool.execute("UPDATE nodes SET name = ?, protocol = ?, host = ?, port = ?, rate = ?, external_panel = ?, is_visible = ?, is_online = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [...values, id]);
  } else {
    await pool.execute("INSERT INTO nodes (name, protocol, host, port, rate, external_panel, is_visible, is_online) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", values);
  }
  refreshAdmin();
  return { ok: true, message: id ? "节点已保存" : "节点已创建" };
}

export async function saveTicketAction(formData: FormData): Promise<ActionResult> {
  await requireAdminUser();
  const id = intValue(formData.get("id"), 1);
  const level = intValue(formData.get("level"));
  const status = intValue(formData.get("status"));
  if (!id || level === null || ![0, 1, 2].includes(level) || status === null || ![0, 1].includes(status)) return { ok: false, message: "工单状态不正确" };
  const pool = getDbPool();
  await pool.execute("UPDATE tickets SET level = ?, status = ?, closed_at = IF(? = 1, COALESCE(closed_at, CURRENT_TIMESTAMP), NULL), updated_at = CURRENT_TIMESTAMP WHERE id = ?", [level, status, status, id]);
  refreshAdmin();
  return { ok: true, message: "工单已保存" };
}

export async function updateOrderStatusAction(formData: FormData): Promise<ActionResult> {
  await requireAdminUser();
  const id = intValue(formData.get("id"), 1);
  const status = intValue(formData.get("status"));
  if (!id || status === null || ![0, 2].includes(status)) return { ok: false, message: "订单只能在待支付和已取消之间切换，已支付订单须经支付回调履约" };
  const pool = getDbPool();
  const [result] = await pool.execute("UPDATE orders SET status = ?, cancelled_at = IF(? = 2, CURRENT_TIMESTAMP, NULL), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN (0, 2)", [status, status, id]);
  if (!("affectedRows" in result) || result.affectedRows !== 1) return { ok: false, message: "订单不存在，或已进入不可手动修改的状态" };
  refreshAdmin();
  return { ok: true, message: status === 2 ? "订单已取消" : "订单已恢复待支付" };
}
