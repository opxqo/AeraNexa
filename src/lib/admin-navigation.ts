import {
  BookOpen,
  Boxes,
  CreditCard,
  Gauge,
  KeyRound,
  ListOrdered,
  Megaphone,
  Network,
  Percent,
  TicketCheck,
  Users,
  Activity,
  type LucideIcon,
} from "lucide-react";

export type AdminSectionKey =
  | "users"
  | "plans"
  | "orders"
  | "coupons"
  | "payments"
  | "recharge-cards"
  | "nodes"
  | "tickets"
  | "notices"
  | "knowledge"
  | "traffic";

export type AdminSection = {
  href: string;
  key?: AdminSectionKey;
  label: string;
  description: string;
  icon: LucideIcon;
  group?: "业务管理" | "资源与支持" | "系统";
};

export const adminSections: AdminSection[] = [
  { href: "/admin", label: "管理概览", description: "业务与系统状态", icon: Gauge },
  { href: "/admin/users", key: "users", label: "用户管理", description: "账户与订阅状态", icon: Users, group: "业务管理" },
  { href: "/admin/plans", key: "plans", label: "套餐管理", description: "套餐与售卖状态", icon: Boxes, group: "业务管理" },
  { href: "/admin/orders", key: "orders", label: "订单管理", description: "订单与履约状态", icon: ListOrdered, group: "业务管理" },
  { href: "/admin/coupons", key: "coupons", label: "优惠券管理", description: "折扣码与核销统计", icon: Percent, group: "业务管理" },
  { href: "/admin/payments", key: "payments", label: "支付管理", description: "渠道与交易记录", icon: CreditCard, group: "业务管理" },
  { href: "/admin/recharge-cards", key: "recharge-cards", label: "卡密管理", description: "余额充值卡与核销状态", icon: KeyRound, group: "业务管理" },
  { href: "/admin/nodes", key: "nodes", label: "节点管理", description: "3x-ui 节点状态", icon: Network, group: "资源与支持" },
  { href: "/admin/tickets", key: "tickets", label: "工单管理", description: "用户支持工单", icon: TicketCheck, group: "资源与支持" },
  { href: "/admin/notices", key: "notices", label: "公告管理", description: "门户公告与发布排期", icon: Megaphone, group: "资源与支持" },
  { href: "/admin/knowledge", key: "knowledge", label: "文档管理", description: "使用文档与分类", icon: BookOpen, group: "资源与支持" },
  { href: "/admin/traffic", key: "traffic", label: "流量统计", description: "节点上报的流量汇总", icon: Activity, group: "资源与支持" },
];

export const adminSectionKeys = new Set<AdminSectionKey>([
  "users",
  "plans",
  "orders",
  "coupons",
  "payments",
  "recharge-cards",
  "nodes",
  "tickets",
  "notices",
  "knowledge",
  "traffic",
]);
