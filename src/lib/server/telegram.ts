import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getDbPool } from "./db";
import { getSetting } from "./settings";
import { recordAudit } from "./audit";
import { ADMIN_HELP, ADMIN_MENU_ROWS, findAdminByChat, handleAdminMessage } from "./telegram-admin";

// TELEGRAM_API_BASE 仅供测试替换成本地假服务
const API = () => process.env.TELEGRAM_API_BASE?.trim() || "https://api.telegram.org";
/** Telegram 单条消息上限 4096 字 */
const MAX_MESSAGE = 4000;
const CODE_TTL_SECONDS = 600;
const pepper = () => process.env.TELEGRAM_BINDING_PEPPER?.trim() || process.env.AUTH_SESSION_SECRET?.trim() || "aeranexa-local-telegram-pepper";
const hash = (value: string) => createHmac("sha256", pepper()).update(value).digest("hex");
const formatBytes = (n: number) => n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : `${(n / 1048576).toFixed(2)} MB`;

export type TelegramSettings = { enabled: boolean; mode: "polling" | "webhook"; username: string; token: string; webhookUrl: string; webhookSecret: string };
export async function getTelegramSettings(): Promise<TelegramSettings> {
  const [enabled, mode, username, token, webhookUrl, webhookSecret] = await Promise.all(["telegram.enabled", "telegram.mode", "telegram.username", "telegram.token", "telegram.webhook_url", "telegram.webhook_secret"].map(getSetting));
  return { enabled: enabled === "true", mode: mode === "webhook" ? "webhook" : "polling", username, token, webhookUrl, webhookSecret };
}

async function telegram(method: string, body: Record<string, unknown>) {
  const { token } = await getTelegramSettings();
  if (!token) throw new Error("AeraNexaBot Token 尚未配置");
  const response = await fetch(`${API()}/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  const payload = await response.json().catch(() => null) as { ok?: boolean; description?: string } | null;
  if (!response.ok || !payload?.ok) throw new Error(payload?.description || "Telegram API 请求失败");
}
const USER_MENU_ROWS = [["📦 我的订阅", "📊 流量使用"], ["💰 我的余额", "🧾 最近订单"], ["🎫 我的工单"]];
const mainMenu = { keyboard: USER_MENU_ROWS, resize_keyboard: true };
/** 管理员：上面两行管理功能，下面保留自己的用户功能 */
const adminMenu = { keyboard: [...ADMIN_MENU_ROWS, ...USER_MENU_ROWS], resize_keyboard: true };
export async function sendTelegramMessage(chatId: number, text: string, replyMarkup?: Record<string, unknown>) {
  const body = text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)}\n…（内容过长已截断）` : text;
  await telegram("sendMessage", { chat_id: chatId, text: body, disable_web_page_preview: true, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
}

export async function createBindingCode(userId: number) {
  const code = randomBytes(18).toString("base64url");
  await getDbPool().execute("UPDATE telegram_binding_codes SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL", [userId]);
  await getDbPool().execute("INSERT INTO telegram_binding_codes (user_id, code_hash, expires_at) VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 10 MINUTE))", [userId, hash(code)]);
  await recordAudit({ action: "telegram.bind_code_created", userId, resourceType: "telegram_binding" });
  return { code, expiresAt: Math.floor(Date.now() / 1000) + CODE_TTL_SECONDS };
}

export async function unbindTelegram(userId: number) {
  await getDbPool().execute("UPDATE users SET telegram_id = NULL WHERE id = ?", [userId]);
  await recordAudit({ action: "telegram.unbound", userId, resourceType: "telegram_binding" });
}

// 排队通知放在独立文件里以避免循环依赖；这里转出，保持原有调用方式不变
export { enqueueTelegramNotification } from "./telegram-notify";
export async function deliverTelegramNotifications() {
  const settings = await getTelegramSettings(); if (!settings.enabled) return 0;
  const [rows] = await getDbPool().query<RowDataPacket[]>(`SELECT d.id,d.user_id,d.kind,d.message,u.telegram_id FROM telegram_notification_deliveries d JOIN users u ON u.id=d.user_id WHERE d.status='pending' AND d.next_attempt_at<=CURRENT_TIMESTAMP ORDER BY d.id LIMIT 30`);
  // 有正文（管理员通知）就发正文，否则按 kind 用固定文案
  const fallback = (kind: string) => kind === "ticket_reply" ? "🎫 您的工单收到管理员回复，请登录 AeraNexa 查看详情。" : "🔔 AeraNexa 订阅状态提醒，请在 Bot 中查询详情。";
  for (const row of rows) { try { if (!row.telegram_id) throw new Error("user not bound"); await sendTelegramMessage(Number(row.telegram_id), row.message ? String(row.message) : fallback(String(row.kind))); await getDbPool().execute("UPDATE telegram_notification_deliveries SET status='sent',attempts=attempts+1,sent_at=CURRENT_TIMESTAMP WHERE id=?", [row.id]); } catch (e) { await getDbPool().execute("UPDATE telegram_notification_deliveries SET attempts=attempts+1,status=IF(attempts+1>=3,'failed','pending'),next_attempt_at=DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 5 MINUTE),last_error=? WHERE id=?", [e instanceof Error ? e.message.slice(0,255) : "send failed",row.id]); } }
  return rows.length;
}

export async function bindTelegram(chatId: number, code: string) {
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [codes] = await connection.execute<RowDataPacket[]>("SELECT id, user_id FROM telegram_binding_codes WHERE code_hash = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP LIMIT 1 FOR UPDATE", [hash(code)]);
    const row = codes[0];
    if (!row) throw new Error("绑定码无效或已过期");
    const [owners] = await connection.execute<RowDataPacket[]>("SELECT id FROM users WHERE telegram_id = ? AND id <> ? LIMIT 1 FOR UPDATE", [chatId, row.user_id]);
    if (owners[0]) throw new Error("该 Telegram 账号已绑定其他账户");
    await connection.execute("UPDATE users SET telegram_id = ? WHERE id = ?", [chatId, row.user_id]);
    await connection.execute("UPDATE telegram_binding_codes SET used_at = CURRENT_TIMESTAMP WHERE id = ?", [row.id]);
    await connection.commit();
    await recordAudit({ action: "telegram.bound", userId: Number(row.user_id), resourceType: "telegram_binding", resourceId: chatId });
    return true;
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

async function accountText(chatId: number, section: string) {
  const [rows] = await getDbPool().execute<RowDataPacket[]>(`SELECT u.email,u.nickname,u.balance,u.transfer_enable,u.upload_bytes,u.download_bytes,u.expired_at,u.is_active,p.name AS plan_name,COALESCE(u.device_limit_override,p.device_limit,0) AS device_limit FROM users u LEFT JOIN plans p ON p.id=u.plan_id WHERE u.telegram_id=? LIMIT 1`, [chatId]);
  const u = rows[0]; if (!u) return "尚未绑定 AeraNexa 账户。请在个人中心生成绑定码后发送 /bind 绑定码。";
  const used = Number(u.upload_bytes) + Number(u.download_bytes), total = Number(u.transfer_enable);
  if (section === "余额") return `💰 我的余额\n可用余额：¥${(Number(u.balance) / 100).toFixed(2)}`;
  if (section === "订单") { const [orders] = await getDbPool().execute<RowDataPacket[]>("SELECT trade_no,status,total_amount,created_at FROM orders WHERE user_id=(SELECT id FROM users WHERE telegram_id=?) ORDER BY id DESC LIMIT 5", [chatId]); return `🧾 最近订单\n${orders.length ? orders.map(o => `${o.trade_no} · 状态 ${o.status} · ¥${(Number(o.total_amount)/100).toFixed(2)}`).join("\n") : "暂无订单"}`; }
  if (section === "工单") { const [tickets] = await getDbPool().execute<RowDataPacket[]>("SELECT id,subject,status,updated_at FROM tickets WHERE user_id=(SELECT id FROM users WHERE telegram_id=?) ORDER BY updated_at DESC LIMIT 5", [chatId]); return `🎫 我的工单\n${tickets.length ? tickets.map(t => `#${t.id} ${t.subject} · 状态 ${t.status}`).join("\n") : "暂无工单"}`; }
  if (section === "流量") return `📊 流量使用\n已用：${formatBytes(used)}\n剩余：${formatBytes(Math.max(0,total-used))}\n总额：${formatBytes(total)}\n设备上限：${Number(u.device_limit)||"不限"}`;
  const expiry = u.expired_at ? new Date(Number(u.expired_at)*1000).toLocaleDateString("zh-CN") : "长期";
  return `👤 我的订阅\n套餐：${u.plan_name || "未订阅"}\n到期：${expiry}\n状态：${u.is_active ? "正常" : "已停用"}`;
}

async function isTelegramBound(chatId: number) {
  const [rows] = await getDbPool().execute<RowDataPacket[]>("SELECT 1 FROM users WHERE telegram_id = ? LIMIT 1", [chatId]);
  return Boolean(rows[0]);
}

export type TelegramUpdate = {
  update_id?: number;
  message?: { text?: string; chat?: { id?: number; type?: string }; reply_to_message?: { text?: string } };
};

export async function handleTelegramUpdate(update: TelegramUpdate) {
  const updateId = Number(update.update_id); if (!Number.isSafeInteger(updateId)) return;
  const [dedupe] = await getDbPool().execute<ResultSetHeader>("INSERT IGNORE INTO telegram_updates (update_id) VALUES (?)", [updateId]); if (!dedupe.affectedRows) return;
  const chatId = Number(update.message?.chat?.id), text = update.message?.text?.trim() || ""; if (!Number.isSafeInteger(chatId)) return;
  // 管理员功能只在私聊生效：群里即使有管理员，也不能在群内查询或回复工单
  const admin = update.message?.chat?.type === "private" && text && !text.startsWith("/bind ") ? await findAdminByChat(chatId) : null;
  if (text.startsWith("/bind ")) { try { await bindTelegram(chatId, text.slice(6).trim()); await sendTelegramMessage(chatId, "✅ AeraNexa 账户绑定成功。发送 /start 查看服务菜单。"); } catch { await sendTelegramMessage(chatId, "❌ 绑定码无效、已过期，或该 Telegram 账号已被绑定。"); } return; }
  const map: Record<string,string> = { "📦 我的订阅":"订阅", "📊 流量使用":"流量", "💰 我的余额":"余额", "🧾 最近订单":"订单", "🎫 我的工单":"工单" };
  if (text === "/start" || text === "/help") {
    if (admin) {
      await sendTelegramMessage(chatId, `✅ 已绑定 AeraNexa 管理员账户（${admin.email}）。\n\n${ADMIN_HELP}`, adminMenu);
    } else if (await isTelegramBound(chatId)) {
      await sendTelegramMessage(chatId, "✅ 已绑定 AeraNexa 账户。请选择要查询的服务：", mainMenu);
    } else {
      await sendTelegramMessage(chatId, "AeraNexaBot\n请在 AeraNexa 仪表盘生成绑定码后，发送 /bind <绑定码> 完成绑定。");
    }
    return;
  }
  if (admin) {
    const reply = await handleAdminMessage(admin, text, update.message?.reply_to_message?.text);
    if (reply !== null) { await sendTelegramMessage(chatId, reply); return; }
  }
  await sendTelegramMessage(chatId, await accountText(chatId, map[text] || "订阅"));
}
