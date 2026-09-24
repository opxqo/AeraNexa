// AeraNexa REST API 响应封包与业务数据类型定义
// 约定：所有金额单位为「分」，所有流量单位为「字节」，套餐额度单位为「GB」。

export interface ApiResponse<T = unknown> {
  data: T;
  meta?: Record<string, unknown>;
  message?: string;
  code?: string;
  errors?: Record<string, string[]>;
}

/** 分页响应封包，配合 localApiRequestFull 使用。 */
export interface PagedMeta {
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

// ==================== 用户认证与账户 ====================

// AeraNexa 使用 HttpOnly Cookie 保存会话，不再把 V2Board auth_data 暴露给浏览器。
export type AuthData = UserInfo;

export interface UserInfo {
  id: number;
  email: string;
  nickname?: string;
  role: string;
  is_active?: boolean;
  transfer_enable: number; // 套餐额度，字节
  used_bytes?: number; // 已用流量，字节
  remain_bytes?: number; // 剩余流量，字节
  usage_percent?: number; // 0-100
  last_login_at: number | null;
  created_at: number | string;
  email_verified_at?: number | null;
  banned: number;
  remind_expire: number;
  remind_traffic: number;
  expired_at: number | null; // 秒级时间戳，null 表示长期有效
  is_permanent?: boolean;
  is_expired?: boolean;
  balance: number; // 分
  commission_balance: number; // 分
  plan_id: number | null;
  discount?: number | null;
  commission_rate?: number | null;
  telegram_id: number | null;
  uuid: string;
  avatar_url?: string;
}

export interface UserSubscribe {
  plan_id: number | null;
  token: string;
  expired_at: number | null;
  u: number; // 上行已用字节
  d: number; // 下行已用字节
  transfer_enable: number; // 套餐额度字节
  used_bytes?: number;
  remain_bytes?: number;
  usage_percent?: number;
  /** 服务端当前时间（秒），用于计算倒计时而不依赖本地时钟。 */
  server_time?: number;
  /** 距离到期的剩余天数，null 表示长期有效。 */
  days_remaining?: number | null;
  email: string;
  uuid: string;
  plan?: Plan;
  subscribe_url: string;
  reset_day?: number;
  /** 已付款、排队等当前套餐到期后依次生效的套餐。 */
  queued_plans?: QueuedPlan[];
}

export interface QueuedPlan {
  trade_no: string;
  plan_name: string;
  period: string;
  period_label: string;
  paid_at: number | null;
}

/** 流量重置报价：当前套餐月付价 × 后台比例。 */
export interface ResetTrafficQuote {
  plan_id: number;
  plan_name: string;
  period: string;
  price: number; // 分
  percent: number;
}

export interface UserStat {
  unpaid_orders: number;
  open_tickets: number;
  referrals: number;
}

// ==================== 订阅套餐 ====================

export interface Plan {
  id: number;
  group_id: number;
  transfer_enable: number; // GB
  name: string;
  speed_limit?: number | null; // Mbps
  show: number;
  sort?: number;
  renew: number;
  content?: string | null;
  month_price?: number | null; // 分
  quarter_price?: number | null;
  half_year_price?: number | null;
  year_price?: number | null;
  two_year_price?: number | null;
  three_year_price?: number | null;
  onetime_price?: number | null;
  reset_price?: number | null;
  capacity_limit?: number | null;
  /** 服务端计算的可售周期，前端应据此渲染周期选择器。 */
  available_periods?: string[];
  created_at?: number;
  updated_at?: number;
}

export type PlanPeriod =
  | "month_price"
  | "quarter_price"
  | "half_year_price"
  | "year_price"
  | "two_year_price"
  | "three_year_price"
  | "onetime_price"
  | "reset_price";

// ==================== 订单与收银台 ====================

export interface OrderItem {
  id: number;
  invite_user_id?: number | null;
  user_id?: number;
  plan_id: number;
  coupon_id?: number | null;
  payment_id?: number | null;
  type: number; // 1 新购, 2 续费, 3 升级, 4 流量重置
  type_label?: string;
  period: PlanPeriod | string;
  period_label?: string;
  trade_no: string;
  callback_no?: string | null;
  subtotal_amount?: number; // 周期原价，分
  total_amount: number; // 应付金额，分
  payable_amount?: number;
  payable?: boolean;
  /** 待支付订单的自动关闭时间（Unix 秒）；非待支付为 null。 */
  pay_deadline?: number | null;
  handling_amount?: number | null;
  discount_amount?: number | null;
  surplus_amount?: number | null;
  refund_amount?: number | null;
  balance_amount?: number | null;
  surplus_order_ids?: number[] | null;
  status: number; // 0 待支付, 1 开通中, 2 已取消, 3 已完成, 4 已折抵, 5 已退款
  status_label?: string;
  commission_status?: number;
  commission_balance?: number;
  actual_commission_balance?: number;
  paid_at?: number | null;
  cancelled_at?: number | null;
  /** 取消原因：user 用户取消，timeout 超时关闭，admin 后台取消。 */
  cancel_reason?: "user" | "timeout" | "admin" | null;
  completed_at?: number | null;
  created_at: number;
  updated_at: number;
  plan?: Plan;
}

export interface PaymentMethod {
  id: number;
  name: string;
  payment: string; // 如 mock, epay, Stripe
  icon?: string | null;
  handling_fee_fixed?: number | null;
  handling_fee_percent?: number | null;
}

export interface CheckoutResult {
  type: 0 | 1; // 0 二维码/本地收银台, 1 外部跳转 URL
  data: string; // 二维码地址或跳转链接
  provider?: string;
  transaction_id?: number;
  amount?: number;
  /** 余额支付无需跳转或异步回调，服务端已完成扣款与履约。 */
  completed?: boolean;
}

export interface WalletTransaction {
  id: number;
  wallet_type: "balance";
  transaction_type: string;
  amount: number;
  balance_after: number;
  reference_type: string | null;
  reference_id: number | null;
  description: string | null;
  created_at: number;
}

export interface CouponVerifyResult {
  id: number;
  code: string;
  name: string;
  type: 1 | 2; // 1 金额抵扣, 2 百分比折扣
  value: number;
  /** 实际可抵扣金额（分），前端应直接使用此值而非 value。 */
  discount_amount?: number;
  subtotal_amount?: number;
  total_amount?: number;
  limit_use?: number;
}

// ==================== 节点服务器 ====================

export interface ServerNode {
  id: number;
  group_id: number[];
  name: string;
  parent_id?: number | null;
  host: string;
  port: number;
  server_port: number;
  tags?: string[] | null;
  rate: string | number;
  type: "shadowsocks" | "vmess" | "trojan" | "vless" | string;
  show: number;
  sort?: number;
  is_online?: number;
  last_check_at?: number;
}

// ==================== 工单 ====================

export interface Ticket {
  id: number;
  user_id?: number;
  subject: string;
  level: 0 | 1 | 2; // 0 低, 1 中, 2 高
  status: 0 | 1; // 0 处理中, 1 已关闭
  reply_status: 0 | 1; // 0 待回复, 1 已回复
  created_at: number;
  updated_at: number;
  message?: TicketMessage[];
  staff_ids?: number[];
}

export interface TicketMessage {
  id: number;
  user_id: number;
  ticket_id: number;
  message: string;
  sender_role?: "user" | "staff";
  created_at: number;
  updated_at: number;
  is_me?: boolean;
}

// ==================== 邀请返佣 ====================

export interface InviteFetch {
  codes: InviteCode[];
  /** [邀请人数, 累计佣金（分）, 已划转（分）, 待结算（分）] */
  stat: [number, number, number, number];
  available_commission: number;
  commission_rate: number;
  available_after_days: number;
  referrals: InviteReferral[];
}

export interface InviteReferral {
  id: number;
  user_id: number;
  email: string;
  is_active: boolean;
  invite_code: string | null;
  completed_orders: number;
  paid_amount: number;
  commission_amount: number;
  created_at: number;
}

export interface InviteCode {
  id: number;
  user_id: number;
  code: string;
  status: 0 | 1;
  pv: number;
  max_uses?: number | null;
  used_count?: number;
  expires_at?: number | null;
  /** 服务端判定的过期状态，前端直接使用以避免渲染期调用不纯函数。 */
  expired?: boolean;
  created_at: number;
  updated_at: number;
}

export interface InviteDetailItem {
  id: number;
  user_id: number;
  order_amount: number;
  get_amount: number;
  status?: string;
  invitee_email?: string | null;
  created_at: number;
}

// ==================== 公告与知识库 ====================

export interface Notice {
  id: number;
  title: string;
  content: string;
  img_url?: string | null;
  created_at: number;
  updated_at: number;
}

export interface KnowledgeArticle {
  id: number;
  category: string;
  title: string;
  body: string;
  updated_at: number;
}

export interface KnowledgeCategory {
  category: string;
  list: KnowledgeArticle[];
}

// ==================== 流量明细 ====================

export interface TrafficRecord {
  record_at: number; // 秒时间戳
  u: number; // 上行字节
  d: number; // 下行字节
}
