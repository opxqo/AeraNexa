import "server-only";

import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { loadAdminDashboard } from "./admin-stats";
import { getDbPool } from "./db";
import { loadLogAlerts } from "./log-query";
import { getEpayKeepaliveOverview } from "./payments/epay-keepalive";
import { closeTicketAsStaff, replyTicketAsStaff, TicketActionError } from "./tickets-admin";
import { loadSyncOverview } from "./worker-status";

/**
 * AeraNexaBot 的管理员功能：查询（概览、系统状态、工单、订单、用户）、工单回复与关闭、主动通知。
 * 管理员 = Telegram 已绑定、role = 'admin' 且启用中的账户；只在私聊里生效（由调用方判断 chat.type）。
 * 本文件会被 bot 进程引用（Node 剥离类型运行），只能使用可擦除的 TS 语法、不能引入 next/*。
 */

export type TelegramAdmin = { id: number; email: string };

export const ADMIN_MENU_ROWS = [["📈 运营概览", "🩺 系统状态"], ["🎫 待处理工单", "🧾 最新订单"]];

const BUTTON_COMMANDS: Record<string, string> = {
  "📈 运营概览": "/stats",
  "🩺 系统状态": "/status",
  "🎫 待处理工单": "/tickets",
  "🧾 最新订单": "/orders",
};

export const ADMIN_HELP = [
  "🛠 管理员命令",
  "/stats 运营概览",
  "/status 系统状态（worker、商户保活、最近报错）",
  "/tickets 待处理工单",
  "/orders 最新订单",
  "/user <邮箱或ID> 查用户",
  "/ticket <编号> 工单详情",
  "/reply <编号> <内容> 回复工单（也可以直接回复机器人推送的工单消息）",
  "/close <编号> 关闭工单",
].join("\n");

const ORDER_STATUS = ["待支付", "开通中", "已取消", "已完成", "已折抵", "已退款"];
const TICKET_LEVEL = ["低", "中", "高"];
/** 推送的工单消息里固定带这个标记，管理员「回复」这条消息时据此识别工单编号 */
const TICKET_MARK = /工单 #(\d+)/;

const money = (cents: unknown) => `¥${(Number(cents ?? 0) / 100).toFixed(2)}`;
const bytes = (n: unknown) => {
  const v = Number(n ?? 0);
  return v >= 1073741824 ? `${(v / 1073741824).toFixed(2)} GB` : `${(v / 1048576).toFixed(2)} MB`;
};
const time = (value: unknown) => value
  ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(new Date(value as string))
  : "—";
const clip = (text: unknown, max: number) => {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
};
const ago = (seconds: number | null) => {
  if (seconds === null) return "从未";
  if (seconds < 60) return `${seconds} 秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
};

export async function findAdminByChat(chatId: number): Promise<TelegramAdmin | null> {
  const [rows] = await getDbPool().execute<RowDataPacket[]>(
    "SELECT id, email FROM users WHERE telegram_id = ? AND role = 'admin' AND is_active = 1 LIMIT 1",
    [chatId],
  );
  return rows[0] ? { id: Number(rows[0].id), email: String(rows[0].email) } : null;
}

/**
 * 处理管理员消息。返回要回复的文本；不是管理员命令时返回 null，由调用方按普通用户处理。
 * replyToText：管理员「回复」的那条机器人消息的原文，用来识别工单编号。
 */
export async function handleAdminMessage(admin: TelegramAdmin, rawText: string, replyToText?: string): Promise<string | null> {
  const text = BUTTON_COMMANDS[rawText] ?? rawText;
  const replyTo = replyToText?.match(TICKET_MARK);
  if (replyTo && !text.startsWith("/")) return replyTicket(admin, Number(replyTo[1]), text);

  const [command, ...rest] = text.split(/\s+/);
  const arg = rest.join(" ").trim();
  switch (command) {
    case "/admin": return ADMIN_HELP;
    case "/stats": return statsText();
    case "/status": return statusText();
    case "/tickets": return ticketsText();
    case "/orders": return ordersText();
    case "/user": return arg ? userText(arg) : "用法：/user <邮箱或用户ID>";
    case "/ticket": return /^\d+$/.test(arg) ? ticketText(Number(arg)) : "用法：/ticket <工单编号>";
    case "/reply": {
      const match = text.match(/^\/reply\s+(\d+)\s+([\s\S]+)$/);
      return match ? replyTicket(admin, Number(match[1]), match[2]) : "用法：/reply <工单编号> <回复内容>";
    }
    case "/close": return /^\d+$/.test(arg) ? closeTicket(admin, Number(arg)) : "用法：/close <工单编号>";
    default: return null;
  }
}

async function statsText(): Promise<string> {
  const { stats: s } = await loadAdminDashboard();
  return [
    "📈 运营概览",
    `用户：${s.totalUsers}（正常 ${s.activeUsers}，今日新增 ${s.newUsersToday}）`,
    `收入：今日 ${money(s.revenueToday)} · 累计 ${money(s.revenue)}`,
    `订单：共 ${s.totalOrders}，已支付 ${s.paidOrders}，待支付 ${s.pendingOrders}`,
    `节点：在线 ${s.onlineNodes} / ${s.totalNodes}`,
    `工单：处理中 ${s.openTickets}，待回复 ${s.awaitingReplyTickets}`,
  ].join("\n");
}

async function statusText(): Promise<string> {
  const lines = ["🩺 系统状态"];
  try {
    const sync = await loadSyncOverview();
    lines.push(sync.workerAlive ? `✅ worker 在线（最近 ${ago(sync.lastSeenAgoSeconds)}）` : `❌ worker 失联（最近一次 ${ago(sync.lastSeenAgoSeconds)}）`);
    for (const run of sync.runs) {
      if (run.finishedAgoSeconds === null) continue;
      lines.push(`  ${run.ok ? "·" : "✗"} ${run.label}：${run.ok ? clip(run.summary || "无变更", 60) : clip(run.error, 80)}`);
    }
    if (sync.counts.failed) lines.push(`  ⚠️ 3x-ui 同步失败的用户：${sync.counts.failed}`);
  } catch (error) {
    lines.push(`worker 状态读取失败：${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const k = await getEpayKeepaliveOverview();
    if (k.channel && !k.configError) {
      const state = !k.enabled ? "已停用" : k.worker.lastCheckAgoSeconds !== null && !k.worker.ok ? `失败：${clip(k.worker.error, 80)}` : "正常";
      const deadline = k.banDeadlineInSeconds === null ? "未知" : k.banDeadlineInSeconds <= 0 ? "已超期" : `剩余 ${Math.floor(k.banDeadlineInSeconds / 3600)} 小时`;
      lines.push(`${state === "正常" ? "✅" : "⚠️"} 商户保活：${state}；上一张账单 ${ago(k.lastBillAgoSeconds)}，距封号期限${deadline}`);
    }
  } catch { /* 未配置易支付时忽略 */ }
  try {
    const a = await loadLogAlerts();
    lines.push(`最近 15 分钟：应用错误 ${a.errors}，支付错误 ${a.payment}，慢请求 ${a.slow}，Bot 错误 ${a.bot}`);
  } catch { /* 日志表不可用时忽略 */ }
  return lines.join("\n");
}

async function ticketsText(): Promise<string> {
  const [rows] = await getDbPool().query<RowDataPacket[]>(
    `SELECT t.id, t.subject, t.level, t.reply_status, t.updated_at, u.email
       FROM tickets t INNER JOIN users u ON u.id = t.user_id
      WHERE t.status = 0 ORDER BY t.reply_status ASC, t.updated_at DESC LIMIT 15`,
  );
  if (!rows.length) return "🎫 没有处理中的工单";
  return ["🎫 处理中的工单（待回复在前）", ...rows.map((t) =>
    `#${t.id} [${TICKET_LEVEL[Number(t.level)] ?? "中"}] ${clip(t.subject, 30)} · ${t.email} · ${Number(t.reply_status) ? "已回复" : "待回复"} · ${time(t.updated_at)}`),
  "", "查看：/ticket <编号>　回复：/reply <编号> <内容>"].join("\n");
}

async function ordersText(): Promise<string> {
  const [rows] = await getDbPool().query<RowDataPacket[]>(
    `SELECT o.trade_no, o.total_amount, o.status, o.created_at, u.email, p.name AS plan_name
       FROM orders o INNER JOIN users u ON u.id = o.user_id LEFT JOIN plans p ON p.id = o.plan_id
      ORDER BY o.id DESC LIMIT 10`,
  );
  if (!rows.length) return "🧾 暂无订单";
  return ["🧾 最新订单", ...rows.map((o) =>
    `${time(o.created_at)} ${ORDER_STATUS[Number(o.status)] ?? "未知"} ${money(o.total_amount)} · ${o.plan_name ?? "—"} · ${o.email}\n  ${o.trade_no}`)].join("\n");
}

async function userText(query: string): Promise<string> {
  const pool = getDbPool();
  const byId = /^\d+$/.test(query);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT u.id, u.email, u.nickname, u.role, u.is_active, u.balance, u.commission_balance, u.transfer_enable,
            u.upload_bytes, u.download_bytes, u.expired_at, u.telegram_id, u.created_at, p.name AS plan_name,
            pc.sync_status
       FROM users u LEFT JOIN plans p ON p.id = u.plan_id LEFT JOIN panel_clients pc ON pc.user_id = u.id
      WHERE ${byId ? "u.id = ?" : "u.email = ?"} LIMIT 1`,
    [byId ? Number(query) : query.toLowerCase()],
  );
  const u = rows[0];
  if (!u) {
    if (byId) return `没有 ID 为 ${query} 的用户`;
    const [similar] = await pool.execute<RowDataPacket[]>("SELECT id, email FROM users WHERE email LIKE ? ORDER BY id DESC LIMIT 5", [`%${query.replace(/[%_\\]/g, "\\$&")}%`]);
    return similar.length ? `没有完全匹配的用户，相近的有：\n${similar.map((s) => `${s.id} · ${s.email}`).join("\n")}` : `没有找到「${query}」`;
  }
  const used = Number(u.upload_bytes) + Number(u.download_bytes);
  const expiry = u.expired_at ? new Date(Number(u.expired_at) * 1000).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "长期";
  const [orders] = await pool.execute<RowDataPacket[]>(
    "SELECT trade_no, total_amount, status, created_at FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 3",
    [u.id],
  );
  return [
    `👤 ${u.email}（ID ${u.id}${u.role === "admin" ? "，管理员" : ""}）`,
    `昵称：${u.nickname}　状态：${Number(u.is_active) ? "正常" : "已停用"}`,
    `套餐：${u.plan_name ?? "未订阅"}　到期：${expiry}`,
    `流量：${bytes(used)} / ${bytes(u.transfer_enable)}`,
    `余额：${money(u.balance)}　佣金：${money(u.commission_balance)}`,
    `节点同步：${u.sync_status ?? "未开通"}　Telegram：${u.telegram_id ? "已绑定" : "未绑定"}`,
    `注册：${time(u.created_at)}`,
    orders.length ? `最近订单：\n${orders.map((o) => `  ${time(o.created_at)} ${ORDER_STATUS[Number(o.status)] ?? "未知"} ${money(o.total_amount)} ${o.trade_no}`).join("\n")}` : "最近订单：无",
  ].join("\n");
}

async function ticketText(id: number): Promise<string> {
  const pool = getDbPool();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT t.id, t.subject, t.level, t.status, t.reply_status, t.created_at, u.email
       FROM tickets t INNER JOIN users u ON u.id = t.user_id WHERE t.id = ? LIMIT 1`,
    [id],
  );
  const t = rows[0];
  if (!t) return `工单 #${id} 不存在`;
  const [messages] = await pool.execute<RowDataPacket[]>(
    "SELECT sender_role, message, created_at FROM ticket_messages WHERE ticket_id = ? ORDER BY id DESC LIMIT 5",
    [id],
  );
  return [
    `🎫 工单 #${t.id} [${TICKET_LEVEL[Number(t.level)] ?? "中"}] ${t.subject}`,
    `用户：${t.email}　状态：${Number(t.status) ? "已关闭" : Number(t.reply_status) ? "已回复" : "待回复"}　创建：${time(t.created_at)}`,
    "",
    ...messages.reverse().map((m) => `${m.sender_role === "staff" ? "🛠 客服" : "👤 用户"} ${time(m.created_at)}\n${clip(m.message, 500)}`),
    "",
    Number(t.status) ? "工单已关闭。" : `回复：/reply ${t.id} <内容>，或直接回复这条消息　关闭：/close ${t.id}`,
  ].join("\n");
}

async function replyTicket(admin: TelegramAdmin, id: number, message: string): Promise<string> {
  try {
    await replyTicketAsStaff(id, admin.id, message, "telegram");
    return `✅ 已回复工单 #${id}，用户会收到通知。`;
  } catch (error) {
    if (error instanceof TicketActionError) return `❌ ${error.message}`;
    throw error;
  }
}

async function closeTicket(admin: TelegramAdmin, id: number): Promise<string> {
  try {
    await closeTicketAsStaff(id, admin.id, "telegram");
    return `✅ 工单 #${id} 已关闭`;
  } catch (error) {
    if (error instanceof TicketActionError) return `❌ ${error.message}`;
    throw error;
  }
}

// ============================================================================ 主动通知

const SCAN_INTERVAL_MS = 30_000;
/** 每轮往前多看这么久，配合去重键，避免两轮之间的事件因时钟边界漏掉 */
const LOOKBACK_SECONDS = 120;
let watermark: Date | null = null;
let lastScanAt = 0;

async function listAdminRecipients(): Promise<number[]> {
  const [rows] = await getDbPool().query<RowDataPacket[]>(
    "SELECT id FROM users WHERE role = 'admin' AND is_active = 1 AND telegram_id IS NOT NULL",
  );
  return rows.map((row) => Number(row.id));
}

/** 给每个已绑定的管理员排队一条通知；key 相同的通知每人只发一次。返回新排队的条数。 */
export async function enqueueAdminNotification(admins: number[], key: string, message: string): Promise<number> {
  let added = 0;
  for (const adminId of admins) {
    const [result] = await getDbPool().execute<ResultSetHeader>(
      "INSERT IGNORE INTO telegram_notification_deliveries (user_id, notification_key, kind, message) VALUES (?, ?, 'admin', ?)",
      [adminId, `admin:${key}:${adminId}`.slice(0, 128), message.slice(0, 3900)],
    );
    added += result.affectedRows;
  }
  return added;
}

/**
 * 扫描最近发生的事件并给管理员排队通知（bot 进程的循环调用，自带 30 秒节流）。
 * 起点取进程启动时的数据库时间：停机期间的事件不补发，避免重启后刷屏。
 */
export async function scanAdminEvents(options: { force?: boolean } = {}): Promise<number> {
  if (!options.force && Date.now() - lastScanAt < SCAN_INTERVAL_MS) return 0;
  lastScanAt = Date.now();
  const pool = getDbPool();
  const [[clock]] = await pool.query<RowDataPacket[]>("SELECT CURRENT_TIMESTAMP AS now");
  const now = new Date(clock.now);
  if (!watermark) {
    watermark = now;
    return 0;
  }
  const since = new Date(watermark.getTime() - LOOKBACK_SECONDS * 1000);
  watermark = now;

  const admins = await listAdminRecipients();
  if (!admins.length) return 0;
  let added = 0;

  const [orders] = await pool.execute<RowDataPacket[]>(
    `SELECT o.id, o.trade_no, o.total_amount, u.email, p.name AS plan_name
       FROM orders o INNER JOIN users u ON u.id = o.user_id LEFT JOIN plans p ON p.id = o.plan_id
      WHERE o.paid_at >= ? ORDER BY o.paid_at ASC LIMIT 50`,
    [since],
  );
  for (const o of orders) {
    added += await enqueueAdminNotification(admins, `order-paid:${o.id}`,
      `💰 新订单付款 ${money(o.total_amount)}\n套餐：${o.plan_name ?? "—"}\n用户：${o.email}\n单号：${o.trade_no}`);
  }

  const [tickets] = await pool.execute<RowDataPacket[]>(
    `SELECT t.id, t.subject, t.level, u.email,
            (SELECT m.message FROM ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.id ASC LIMIT 1) AS first_message
       FROM tickets t INNER JOIN users u ON u.id = t.user_id
      WHERE t.created_at >= ? ORDER BY t.id ASC LIMIT 50`,
    [since],
  );
  for (const t of tickets) {
    added += await enqueueAdminNotification(admins, `ticket-new:${t.id}`,
      `🎫 新工单 #${t.id} [${TICKET_LEVEL[Number(t.level)] ?? "中"}] ${t.subject}\n用户：${t.email}\n\n${clip(t.first_message, 500)}\n\n直接回复这条消息即可回复工单 #${t.id}`);
  }

  // 用户追加的回复：跳过每个工单的第一条（那是建工单时的内容，已随「新工单」通知）
  const [replies] = await pool.execute<RowDataPacket[]>(
    `SELECT m.id, m.ticket_id, m.message, t.subject, u.email
       FROM ticket_messages m
       INNER JOIN tickets t ON t.id = m.ticket_id
       INNER JOIN users u ON u.id = t.user_id
      WHERE m.sender_role = 'user' AND m.created_at >= ?
        AND m.id > (SELECT MIN(f.id) FROM ticket_messages f WHERE f.ticket_id = m.ticket_id)
      ORDER BY m.id ASC LIMIT 50`,
    [since],
  );
  for (const m of replies) {
    added += await enqueueAdminNotification(admins, `ticket-msg:${m.id}`,
      `💬 工单 #${m.ticket_id} 有用户新回复：${clip(m.subject, 30)}\n用户：${m.email}\n\n${clip(m.message, 500)}\n\n直接回复这条消息即可回复工单 #${m.ticket_id}`);
  }

  // 系统告警：同一类每小时最多一条
  const hour = now.toISOString().slice(0, 13).replace(/\D/g, "");
  try {
    const alerts = await loadLogAlerts();
    if (alerts.workerStale) {
      added += await enqueueAdminNotification(admins, `alert-worker:${hour}`,
        `⚠️ worker 已失联（超过 ${alerts.workerStaleAfter} 秒没有完成任务）\n用户开通、续费、到期不会同步到 3x-ui，请检查服务器：systemctl status aeranexa-worker`);
    }
    if (alerts.payment > 0) {
      added += await enqueueAdminNotification(admins, `alert-payment:${hour}`,
        `⚠️ 最近 15 分钟有 ${alerts.payment} 条支付错误\n请到后台「日志中心 → 运行事件」按「支付」筛选查看。`);
    }
  } catch { /* 日志表不可用时跳过告警 */ }
  const [keepalive] = await pool.query<RowDataPacket[]>("SELECT last_ok, last_error FROM worker_runs WHERE task = 'epay_keepalive' LIMIT 1");
  if (keepalive[0] && !Number(keepalive[0].last_ok)) {
    added += await enqueueAdminNotification(admins, `alert-keepalive:${hour}`,
      `⚠️ 易支付商户保活失败：${clip(keepalive[0].last_error, 200)}\n连续 5 天没有账单商户号会被封，请到后台「支付管理 → 商户保活」处理。`);
  }
  return added;
}

/** 仅供测试：重置扫描状态 */
export function resetAdminScanState(): void {
  watermark = null;
  lastScanAt = 0;
}
