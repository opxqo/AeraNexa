import type { AuditAction } from "./server/audit";

/** 后台与导出共用的事件说明；事件代码仍保留以便精确检索。 */
const AUDIT_DESCRIPTIONS = {
  "auth.register": "用户注册账号",
  "auth.login": "用户登录成功",
  "auth.login_failed": "用户登录失败",
  "auth.logout": "用户退出登录",
  "auth.password_changed": "用户修改密码",
  "auth.security_reset": "用户重置安全信息",
  "auth.email_verification_sent": "发送邮箱验证码",
  "auth.email_verification_failed": "发送邮箱验证码失败",
  "order.created": "创建订单",
  "order.cancelled": "取消订单",
  "order.paid": "订单支付成功",
  "order.fulfilled": "订单完成履约",
  "wallet.recharged": "余额充值成功",
  "ticket.created": "创建工单",
  "ticket.replied": "回复工单",
  "ticket.closed": "关闭工单",
  "invite.created": "创建邀请码",
  "invite.enabled": "启用邀请码",
  "invite.disabled": "停用邀请码",
  "admin.user_updated": "管理员修改用户资料",
  "admin.plan_saved": "管理员保存套餐",
  "admin.plan_deleted": "管理员删除套餐",
  "admin.coupon_saved": "管理员保存优惠券",
  "admin.coupon_deleted": "管理员删除优惠券",
  "admin.payment_saved": "管理员修改支付配置",
  "admin.node_saved": "管理员保存节点",
  "admin.nodes_imported": "管理员导入节点",
  "admin.access_group_saved": "管理员保存权限组",
  "admin.access_group_deleted": "管理员删除权限组",
  "admin.user_devices_cleared": "管理员清除用户设备记录",
  "admin.user_resynced": "管理员重新同步用户节点权限",
  "admin.sync_failures_retried": "管理员重试同步失败任务",
  "admin.settings_saved": "管理员保存系统或日志设置",
  "admin.logs_exported": "管理员导出日志",
  "admin.ticket_updated": "管理员更新工单",
  "admin.ticket_replied": "管理员回复工单",
  "admin.order_status_changed": "管理员修改订单状态",
  "admin.order_updated": "管理员修改订单",
  "admin.order_manually_fulfilled": "管理员人工履约订单",
  "admin.order_remark_saved": "管理员保存订单备注",
  "admin.recharge_cards_created": "管理员生成充值卡",
  "admin.recharge_batch_cleared": "管理员清理充值卡批次",
  "admin.recharge_card_disabled": "管理员停用充值卡",
  "admin.recharge_card_enabled": "管理员启用充值卡",
  "admin.notice_saved": "管理员保存公告",
  "admin.notice_deleted": "管理员删除公告",
  "admin.knowledge_saved": "管理员保存文档",
  "admin.knowledge_deleted": "管理员删除文档",
  "admin.smtp_saved": "管理员保存邮件配置",
  "admin.smtp_toggled": "管理员切换邮件服务状态",
  "admin.smtp_tested": "管理员测试邮件服务",
  "admin.payment_refunded": "管理员发起退款",
  "admin.payment_sandbox_callback": "管理员模拟支付回调",
  "admin.payment_epay_test_created": "管理员创建易支付测试单",
  "payment.epay_test_notified": "易支付测试单收到通知",
  "admin.reconciliation_imported": "管理员导入对账数据",
  "admin.reconciliation_resolved": "管理员处理对账差异",
  "telegram.bind_code_created": "创建 Telegram 绑定码",
  "telegram.bound": "绑定 Telegram 账号",
  "telegram.unbound": "解除 Telegram 绑定",
} satisfies Record<AuditAction, string>;

const RUNTIME_DESCRIPTIONS: Record<string, string> = {
  "http.request": "应用请求已完成",
  "http.slow": "请求处理超过 1 秒",
  "http.handler_error": "请求处理器发生异常",
  "next.request_error": "Next.js 请求处理发生异常",
  "api.error": "接口处理发生异常",
  "log.retention": "清理过期运行日志",
  "worker.lifecycle": "Worker 运行状态变化",
  "worker.event": "Worker 执行事件同步",
  "worker.reconcile": "Worker 执行节点对账",
  "worker.traffic": "Worker 采集流量",
  "worker.import": "Worker 导入节点",
  "worker.payments": "Worker 处理订单和支付",
  "bot.started": "Telegram Bot 启动",
  "bot.poll_failed": "Telegram Bot 拉取消息失败",
  "bot.update_processed": "Telegram Bot 处理一条消息",
  "bot.fatal": "Telegram Bot 异常退出",
  "payment.callback": "处理支付渠道回调",
  "payment.callback_failed": "支付渠道回调处理失败",
  "payment.epay_notify": "处理易支付异步通知",
  "payment.epay_notify_failed": "易支付异步通知处理失败",
  "payment.epay_return": "处理易支付收银台返回",
  "payment.epay_return_failed": "易支付收银台返回处理失败",
};

export const LOG_LEVEL_LABELS: Record<string, string> = { info: "信息", warn: "警告", error: "错误" };
export const LOG_CATEGORY_LABELS_ZH: Record<string, string> = {
  audit: "操作审计", access: "请求访问", slow: "慢请求", error: "应用错误",
  worker: "Worker 运行", bot: "Bot 运行", payment: "支付运行",
};

export function describeLogEvent(code: string, category: string, status?: number | null): string {
  if (category === "audit") return AUDIT_DESCRIPTIONS[code as AuditAction] ?? "其他业务操作（请查看事件代码和详情）";
  if (code === "http.request" && status !== null && status !== undefined) {
    if (status >= 500) return `请求已完成，服务器返回 ${status} 错误`;
    if (status >= 400) return `请求已完成，返回 ${status} 错误`;
    if (status >= 300) return `请求已完成，返回 ${status} 跳转`;
    return `请求已完成，返回 ${status}`;
  }
  return RUNTIME_DESCRIPTIONS[code] ?? "其他运行事件（请查看事件代码和详情）";
}
