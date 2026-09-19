import {
  Boxes,
  CreditCard,
  Gauge,
  ListOrdered,
  Network,
  TicketCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

export type AdminSectionKey =
  | "users"
  | "plans"
  | "orders"
  | "payments"
  | "nodes"
  | "tickets";

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
  { href: "/admin/payments", key: "payments", label: "支付管理", description: "渠道与交易记录", icon: CreditCard, group: "业务管理" },
  { href: "/admin/nodes", key: "nodes", label: "节点管理", description: "3x-ui 节点状态", icon: Network, group: "资源与支持" },
  { href: "/admin/tickets", key: "tickets", label: "工单管理", description: "用户支持工单", icon: TicketCheck, group: "资源与支持" },
];

export const adminSectionKeys = new Set<AdminSectionKey>([
  "users",
  "plans",
  "orders",
  "payments",
  "nodes",
  "tickets",
]);
