import "server-only";

import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { recordAudit } from "./audit";
import { getDbPool } from "./db";
import { enqueueTelegramNotification } from "./telegram-notify";

/**
 * 管理员处理工单：后台（src/app/admin/actions.ts）和 Telegram 机器人共用同一套逻辑。
 * 本文件会被 bot 进程引用（Node 剥离类型运行），只能使用可擦除的 TS 语法、不能引入 next/*。
 */

export type TicketActionSource = "admin" | "telegram";

export class TicketActionError extends Error {}

/** 客服回复：写消息、标记已回复并保持处理中、记审计、给用户推送「工单有回复」。 */
export async function replyTicketAsStaff(ticketId: number, adminId: number, message: string, source: TicketActionSource): Promise<void> {
  const body = message.trim().slice(0, 10000);
  if (!body) throw new TicketActionError("回复内容不能为空");

  const connection = await getDbPool().getConnection();
  let ticketUserId = 0;
  try {
    await connection.beginTransaction();
    const [tickets] = await connection.execute<RowDataPacket[]>(
      "SELECT id, user_id, status FROM tickets WHERE id = ? LIMIT 1 FOR UPDATE",
      [ticketId],
    );
    const ticket = tickets[0];
    if (!ticket) throw new TicketActionError("工单不存在");
    if (Number(ticket.status) !== 0) throw new TicketActionError("工单已关闭，请先恢复为「处理中」再回复");
    ticketUserId = Number(ticket.user_id);

    await connection.execute(
      `INSERT INTO ticket_messages (ticket_id, user_id, sender_role, message) VALUES (?, ?, 'staff', ?)`,
      [ticketId, adminId, body],
    );
    // 客服回复后标记为「已回复」，并把工单置为处理中。
    await connection.execute(
      `UPDATE tickets SET reply_status = 1, status = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [ticketId],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  await recordAudit({ action: "admin.ticket_replied", userId: adminId, resourceType: "ticket", resourceId: ticketId, context: { length: body.length, source } });
  if (ticketUserId) await enqueueTelegramNotification(ticketUserId, `ticket-reply:${ticketId}:${Date.now()}`, "ticket_reply");
}

/** 关闭工单（保留原优先级）。 */
export async function closeTicketAsStaff(ticketId: number, adminId: number, source: TicketActionSource): Promise<void> {
  const [result] = await getDbPool().execute<ResultSetHeader>(
    `UPDATE tickets SET status = 1, closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [ticketId],
  );
  if (result.affectedRows !== 1) throw new TicketActionError("工单不存在");
  await recordAudit({ action: "admin.ticket_updated", userId: adminId, resourceType: "ticket", resourceId: ticketId, context: { status: 1, source } });
}
