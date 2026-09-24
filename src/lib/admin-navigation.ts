export type AdminIcon =
  | "dashboard" | "users" | "plans" | "orders" | "coupons" | "payments" | "refunds"
  | "reconciliation" | "rechargeCards" | "nodes" | "tickets" | "notices" | "knowledge"
  | "traffic" | "mail" | "settings" | "logs";

export type AdminSectionKey =
  | "users"
  | "plans"
  | "orders"
  | "coupons"
  | "payments"
  | "refunds"
  | "reconciliation"
  | "recharge-cards"
  | "nodes"
  | "tickets"
  | "notices"
  | "knowledge"
  | "traffic"
  | "mail"
  | "settings";

export type AdminSection = {
  href: string;
  key?: AdminSectionKey;
  label: string;
  description: string;
  icon: AdminIcon;
  group?: "业务管理" | "资源与支持" | "系统";
};

export const adminSections: AdminSection[] = [
  { href: "/admin", label: "管理概览", description: "业务与系统状态", icon: "dashboard" },
  { href: "/admin/users", key: "users", label: "用户管理", description: "账户与订阅状态", icon: "users", group: "业务管理" },
  { href: "/admin/plans", key: "plans", label: "套餐管理", description: "套餐与售卖状态", icon: "plans", group: "业务管理" },
  { href: "/admin/orders", key: "orders", label: "订单管理", description: "订单与履约状态", icon: "orders", group: "业务管理" },
  { href: "/admin/coupons", key: "coupons", label: "惠券管理", description: "折扣码与核销统计", icon: "coupons", group: "业务管理" },
  { href: "/admin/payments", key: "payments", label: "支付管理", description: "渠道与交易记录", icon: "payments", group: "业务管理" },
  { href: "/admin/refunds", key: "refunds", label: "退款管理", description: "余额退款账本", icon: "refunds", group: "业务管理" },
  { href: "/admin/reconciliation", key: "reconciliation", label: "对账管理", description: "渠道账单与差异", icon: "reconciliation", group: "业务管理" },
  { href: "/admin/recharge-cards", key: "recharge-cards", label: "卡密管理", description: "余额充值卡与核销状态", icon: "rechargeCards", group: "业务管理" },
  { href: "/admin/nodes", key: "nodes", label: "节点管理", description: "3x-ui 节点状态", icon: "nodes", group: "资源与支持" },
  { href: "/admin/tickets", key: "tickets", label: "工单管理", description: "用户支持工单", icon: "tickets", group: "资源与支持" },
  { href: "/admin/notices", key: "notices", label: "公告管理", description: "门户公告与发布排期", icon: "notices", group: "资源与支持" },
  { href: "/admin/knowledge", key: "knowledge", label: "文档管理", description: "使用文档与分类", icon: "knowledge", group: "资源与支持" },
  { href: "/admin/traffic", key: "traffic", label: "流量统计", description: "节点上报的流量汇总", icon: "traffic", group: "资源与支持" },
  { href: "/admin/mail", key: "mail", label: "邮件服务", description: "SMTP 配置与验证码状态", icon: "mail", group: "系统" },
  { href: "/admin/logs", label: "日志中心", description: "审计、访问与运行监控", icon: "logs", group: "系统" },
  { href: "/admin/settings", key: "settings", label: "系统设置", description: "节点、订阅、佣金与 Worker", icon: "settings", group: "系统" },
];

export const adminSectionKeys = new Set<AdminSectionKey>([
  "users",
  "plans",
  "orders",
  "coupons",
  "payments",
  "refunds",
  "reconciliation",
  "recharge-cards",
  "nodes",
  "tickets",
  "notices",
  "knowledge",
  "traffic",
  "mail",
  "settings",
]);
