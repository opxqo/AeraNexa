import "server-only";

import type { RowDataPacket } from "mysql2";
import type { AdminSectionKey } from "@/lib/admin-navigation";
import { getDbPool } from "./db";
import { requireAdminUser } from "./admin";

type EditorUser = { id: number; email: string; nickname: string; role: "admin" | "user"; isActive: boolean; planName: string; createdAt: string };
type EditorPlan = { id: number; name: string; transferEnable: number; speedLimit: number | null; monthPrice: number | null; isVisible: boolean; isRenewable: boolean };
type EditorPayment = { id: number; provider: string; name: string; isEnabled: boolean; handlingFeeFixed: number; handlingFeePercent: number; notifyDomain: string };
type EditorNode = { id: number; name: string; protocol: string; host: string; port: number; rate: number; isVisible: boolean; isOnline: boolean; externalPanel: string };
type EditorTicket = { id: number; subject: string; email: string; level: number; status: number; replyStatus: number; updatedAt: string };
type EditorOrder = { id: number; tradeNo: string; email: string; planName: string; totalAmount: number; status: number; createdAt: string };

export type AdminEditorData =
  | { section: "users"; rows: EditorUser[] }
  | { section: "plans"; rows: EditorPlan[] }
  | { section: "payments"; rows: EditorPayment[] }
  | { section: "nodes"; rows: EditorNode[] }
  | { section: "tickets"; rows: EditorTicket[] }
  | { section: "orders"; rows: EditorOrder[] };

function asNumber(value: number | string | null): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asDate(value: Date | string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(new Date(value));
}

export async function getAdminEditorData(section: Exclude<AdminSectionKey, "settings">): Promise<AdminEditorData> {
  await requireAdminUser();
  const pool = getDbPool();

  if (section === "users") {
    const [rows] = await pool.query<RowDataPacket[]>(`SELECT u.id, u.email, u.nickname, u.role, u.is_active, p.name AS plan_name, u.created_at FROM users u LEFT JOIN plans p ON p.id = u.plan_id ORDER BY u.id DESC LIMIT 100`);
    return { section, rows: rows.map((row) => ({ id: asNumber(row.id), email: String(row.email), nickname: String(row.nickname), role: row.role === "admin" ? "admin" : "user", isActive: Boolean(row.is_active), planName: row.plan_name ? String(row.plan_name) : "未订阅", createdAt: asDate(row.created_at as Date) })) };
  }

  if (section === "plans") {
    const [rows] = await pool.query<RowDataPacket[]>(`SELECT id, name, transfer_enable, speed_limit, month_price, is_visible, is_renewable FROM plans ORDER BY sort_order, id DESC LIMIT 100`);
    return { section, rows: rows.map((row) => ({ id: asNumber(row.id), name: String(row.name), transferEnable: asNumber(row.transfer_enable), speedLimit: row.speed_limit === null ? null : asNumber(row.speed_limit), monthPrice: row.month_price === null ? null : asNumber(row.month_price), isVisible: Boolean(row.is_visible), isRenewable: Boolean(row.is_renewable) })) };
  }

  if (section === "payments") {
    const [rows] = await pool.query<RowDataPacket[]>(`SELECT id, provider, name, is_enabled, handling_fee_fixed, handling_fee_percent, notify_domain FROM payment_methods ORDER BY sort_order, id DESC LIMIT 100`);
    return { section, rows: rows.map((row) => ({ id: asNumber(row.id), provider: String(row.provider), name: String(row.name), isEnabled: Boolean(row.is_enabled), handlingFeeFixed: asNumber(row.handling_fee_fixed), handlingFeePercent: asNumber(row.handling_fee_percent), notifyDomain: row.notify_domain ? String(row.notify_domain) : "" })) };
  }

  if (section === "nodes") {
    const [rows] = await pool.query<RowDataPacket[]>(`SELECT id, name, protocol, host, port, rate, is_visible, is_online, external_panel FROM nodes ORDER BY sort_order, id DESC LIMIT 100`);
    return { section, rows: rows.map((row) => ({ id: asNumber(row.id), name: String(row.name), protocol: String(row.protocol), host: String(row.host), port: asNumber(row.port), rate: asNumber(row.rate), isVisible: Boolean(row.is_visible), isOnline: Boolean(row.is_online), externalPanel: String(row.external_panel) })) };
  }

  if (section === "tickets") {
    const [rows] = await pool.query<RowDataPacket[]>(`SELECT t.id, t.subject, u.email, t.level, t.status, t.reply_status, t.updated_at FROM tickets t INNER JOIN users u ON u.id = t.user_id ORDER BY t.updated_at DESC LIMIT 100`);
    return { section, rows: rows.map((row) => ({ id: asNumber(row.id), subject: String(row.subject), email: String(row.email), level: asNumber(row.level), status: asNumber(row.status), replyStatus: asNumber(row.reply_status), updatedAt: asDate(row.updated_at as Date) })) };
  }

  const [rows] = await pool.query<RowDataPacket[]>(`SELECT o.id, o.trade_no, u.email, p.name AS plan_name, o.total_amount, o.status, o.created_at FROM orders o INNER JOIN users u ON u.id = o.user_id INNER JOIN plans p ON p.id = o.plan_id ORDER BY o.id DESC LIMIT 100`);
  return { section: "orders", rows: rows.map((row) => ({ id: asNumber(row.id), tradeNo: String(row.trade_no), email: String(row.email), planName: String(row.plan_name), totalAmount: asNumber(row.total_amount), status: asNumber(row.status), createdAt: asDate(row.created_at as Date) })) };
}
