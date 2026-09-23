/**
 * 订单与支付的衔接规则（纯函数、零依赖，可被测试直接 import）。
 * 本文件会被 worker 引用（Node 剥离类型运行），只能使用可擦除的 TS 语法。
 */

/** 待支付订单无操作多久后自动关闭；以 orders.updated_at 为起点，发起支付、改单、恢复都会刷新它。 */
export const PENDING_ORDER_TIMEOUT_MINUTES = 10;

// 与 subscription.ts 的 ORDER_STATUS / ORDER_TYPE 保持一致；这里不 import，保持纯函数零依赖。
const PENDING = 0;
const CANCELLED = 2;
const COMPLETED = 3;
const UPGRADE = 3;

/**
 * 渠道确认收款后如何处理订单：
 * - settle：订单仍待支付，正常开通；
 * - reopen：订单已取消 / 超时关闭，但付款可以直接兑现 → 恢复为待支付后开通；
 * - confirm：订单已由后台人工补单开通（多半因回调丢失），这笔钱就是它的货款 → 只记账，不再开通也不转余额；
 * - credit：无法按原订单兑现 → 全额转入用户余额。包括：升级单（折抵基于关单前的订阅，
 *   期间订阅可能已变化）、已完成订单的重复付款、已退款等其它状态。
 */
export type ConfirmedPaymentAction = "settle" | "reopen" | "confirm" | "credit";

export function decideConfirmedPayment(order: {
  status: number;
  orderType: number;
  hasSurplus: boolean;
  fulfillmentSource: string | null;
}): ConfirmedPaymentAction {
  if (order.status === PENDING) return "settle";
  if (order.status === COMPLETED && order.fulfillmentSource === "admin") return "confirm";
  if (order.status === CANCELLED && order.orderType !== UPGRADE && !order.hasSurplus) return "reopen";
  return "credit";
}
