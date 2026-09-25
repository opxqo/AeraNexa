import "server-only";

import type { RowDataPacket } from "mysql2";
import { getDbPool } from "./db";
import { safeLogPath, safeError, safeLogMessage } from "./runtime-logs";

export type AuditAction =
  | "auth.register"
  | "auth.login"
  | "auth.login_failed"
  | "auth.logout"
  | "auth.password_changed"
  | "auth.security_reset"
  | "auth.email_verification_sent"
  | "auth.email_verification_failed"
  | "order.created"
  | "order.cancelled"
  | "order.paid"
  | "order.fulfilled"
  | "wallet.recharged"
  | "ticket.created"
  | "ticket.replied"
  | "ticket.closed"
  | "invite.created"
  | "invite.enabled"
  | "invite.disabled"
  | "admin.user_updated"
  | "admin.plan_saved"
  | "admin.plan_deleted"
  | "admin.coupon_saved"
  | "admin.coupon_deleted"
  | "admin.payment_saved"
  | "admin.node_saved"
  | "admin.nodes_imported"
  | "admin.access_group_saved"
  | "admin.access_group_deleted"
  | "admin.user_devices_cleared"
  | "admin.user_resynced"
  | "admin.sync_failures_retried"
  | "admin.settings_saved"
  | "admin.logs_exported"
  | "admin.backup_exported"
  | "admin.backup_restored"
  | "admin.ticket_updated"
  | "admin.ticket_replied"
  | "admin.order_status_changed"
  | "admin.order_updated"
  | "admin.order_manually_fulfilled"
  | "admin.order_remark_saved"
  | "admin.recharge_cards_created"
  | "admin.recharge_batch_cleared"
  | "admin.recharge_card_disabled"
  | "admin.recharge_card_enabled"
  | "admin.notice_saved"
  | "admin.notice_deleted"
  | "admin.knowledge_saved"
  | "admin.knowledge_deleted"
  | "admin.smtp_saved"
  | "admin.smtp_toggled"
  | "admin.smtp_tested"
  | "admin.payment_refunded"
  | "admin.payment_sandbox_callback"
  | "admin.payment_epay_test_created"
  | "payment.epay_test_notified"
  | "payment.epay_keepalive_created"
  | "admin.reconciliation_imported"
  | "admin.reconciliation_resolved"
  | "telegram.bind_code_created"
  | "telegram.bound"
  | "telegram.unbound";

export type AuditInput = {
  action: AuditAction;
  userId?: number | null;
  resourceType?: string;
  resourceId?: string | number;
  request?: Request;
  context?: Record<string, unknown>;
};

/** 客户端 IP：优先取反向代理透传头，其次取 x-real-ip。 */
function resolveIp(request?: Request): string | null {
  if (!request) return null;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 45);
  }
  return request.headers.get("x-real-ip")?.slice(0, 45) ?? null;
}

function safeAuditContext(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => safeAuditContext(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, item]) => [
      key.slice(0, 80),
      /password|passwd|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key/i.test(key)
        ? "[redacted]" : safeAuditContext(item, depth + 1),
    ]));
  }
  return typeof value === "string" ? safeLogMessage(value) : value;
}

/**
 * 写入审计日志。
 * 审计失败绝不能影响主业务，因此这里吞掉异常并只记录日志。
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const url = input.request ? new URL(input.request.url) : null;
    let requestId = input.request?.headers.get("x-request-id") ?? null;
    if (!requestId) {
      try {
        const { headers } = await import("next/headers");
        requestId = (await headers()).get("x-request-id");
      } catch { /* Worker 和 Bot 没有 HTTP 请求上下文。 */ }
    }
    if (requestId && !/^[0-9a-f-]{36}$/i.test(requestId)) requestId = null;
    await getDbPool().execute(
      `INSERT INTO audit_logs
        (user_id, request_id, action, resource_type, resource_id, request_method, request_path, ip_address, user_agent, context)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.userId ?? null,
        requestId,
        input.action,
        input.resourceType ?? null,
        input.resourceId === undefined ? null : String(input.resourceId).slice(0, 128),
        input.request?.method ?? null,
        url ? safeLogPath(url.pathname) : null,
        resolveIp(input.request),
        input.request?.headers.get("user-agent") ? safeLogMessage(input.request.headers.get("user-agent")).slice(0, 500) : null,
        input.context ? JSON.stringify(safeAuditContext(input.context)) : null,
      ],
    );
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ event: "audit.write_failed", error: safeError(error) })}\n`);
  }
}

/** 统计窗口内匹配某个 context 字段值的审计条数，用于登录防爆破与限流。 */
export async function countRecentAuditsByContext(
  action: AuditAction,
  contextKey: string,
  contextValue: string,
  windowMinutes: number,
): Promise<number> {
  try {
    const [rows] = await getDbPool().execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM audit_logs
        WHERE action = ?
          AND created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? MINUTE)
          AND JSON_UNQUOTE(JSON_EXTRACT(context, ?)) = ?`,
      [action, windowMinutes, `$.${contextKey}`, contextValue],
    );
    return Number(rows[0]?.total ?? 0);
  } catch {
    // 审计表不可用时不应阻断登录，退化为"不限流"。
    return 0;
  }
}
