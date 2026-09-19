// V2Board 原生 REST API 响应封包与业务数据类型定义

export interface ApiResponse<T = unknown> {
  data: T;
  message?: string;
  errors?: Record<string, string[]>;
}

// ==================== 用户认证与账户 ====================

// AeraNexa 使用 HttpOnly Cookie 保存会话，不再把 V2Board auth_data 暴露给浏览器。
export type AuthData = UserInfo;

export interface UserInfo {
  id?: number;
  email: string;
  role: string;
  transfer_enable: number; // 字节数
  last_login_at: number | null;
  created_at: number | string;
  banned: number;
  remind_expire: number;
  remind_traffic: number;
  expired_at: number | null; // 毫秒或秒时间戳，null 表示长期有效
  balance: number; // 分为单位或元为单位 (V2Board 数据库以分为单位)
  commission_balance: number;
  plan_id: number | null;
  discount: number | null;
  commission_rate: number | null;
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
  transfer_enable: number; // 总流量字节
  email: string;
  uuid: string;
  plan?: Plan;
  subscribe_url: string;
  reset_day?: number;
}

export type UserStat = [number, number, number]; // [未支付订单数, 待处理工单数, 累计邀请人数]

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
  content?: string | null; // HTML 或描述
  month_price?: number | null; // 分
  quarter_price?: number | null;
  half_year_price?: number | null;
  year_price?: number | null;
  two_year_price?: number | null;
  three_year_price?: number | null;
  onetime_price?: number | null;
  reset_price?: number | null;
  capacity_limit?: number | null;
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
  type: number; // 1 新购, 2 续费, 3 升级, 4 重置包
  period: PlanPeriod | string;
  trade_no: string;
  callback_no?: string | null;
  total_amount: number; // 分
  handling_amount?: number | null;
  discount_amount?: number | null;
  surplus_amount?: number | null;
  refund_amount?: number | null;
  balance_amount?: number | null;
  surplus_order_ids?: number[] | null;
  status: number; // 0 待支付, 1 开通中, 2 已取消, 3 已完成, 4 折抵已完成
  commission_status?: number;
  commission_balance?: number;
  actual_commission_balance?: number;
  paid_at?: number | null;
  created_at: number;
  updated_at: number;
  plan?: Plan;
}

export interface PaymentMethod {
  id: number;
  name: string;
  payment: string; // 如 AlipayF2F, Epay, Stripe, etc.
  icon?: string | null;
  handling_fee_fixed?: number | null;
  handling_fee_percent?: number | null;
}

export interface CheckoutResult {
  type: 0 | 1; // 0 二维码扫码, 1 外部跳转 URL
  data: string; // 二维码地址或跳转链接
}

export interface CouponVerifyResult {
  id: number;
  code: string;
  name: string;
  type: 1 | 2; // 1 金额抵扣, 2 百分比折扣
  value: number;
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
  status: 0 | 1; // 0 待处理, 1 已关闭
  reply_status: 0 | 1; // 0 待回复, 1 已回复
  created_at: number;
  updated_at: number;
  message?: TicketMessage[];
}

export interface TicketMessage {
  id: number;
  user_id: number;
  ticket_id: number;
  message: string;
  created_at: number;
  updated_at: number;
  is_me?: boolean;
}

// ==================== 邀请返佣 ====================

export interface InviteFetch {
  codes: InviteCode[];
  stat: [number, number, number]; // [邀请人数, 产生佣金, 累计提现]
}

export interface InviteCode {
  id: number;
  user_id: number;
  code: string;
  status: 0 | 1;
  pv: number;
  created_at: number;
  updated_at: number;
}

export interface InviteDetailItem {
  id: number;
  user_id: number;
  order_amount: number;
  get_amount: number;
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
