import {
  BarChart3,
  BookOpen,
  CircleUserRound,
  Gauge,
  Gift,
  LifeBuoy,
  List,
  ShoppingBag,
  BadgeCheck,
  type LucideIcon,
} from "lucide-react";

export type PortalSection = {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  group?: "订阅" | "财务" | "用户";
};

const allPortalSections: PortalSection[] = [
  { href: "/dashboard", label: "仪表盘", description: "订阅与账户概览", icon: Gauge },
  { href: "/knowledge", label: "使用文档", description: "客户端配置指引", icon: BookOpen },
  { href: "/plan", label: "购买订阅", description: "选择套餐与周期", icon: ShoppingBag, group: "订阅" },
  { href: "/node", label: "节点状态", description: "可用线路与倍率", icon: BadgeCheck, group: "订阅" },
  { href: "/order", label: "我的订单", description: "订单与支付状态", icon: List, group: "财务" },
  { href: "/invite", label: "我的邀请", description: "邀请码与佣金", icon: Gift, group: "财务" },
  { href: "/profile", label: "个人中心", description: "安全与偏好设置", icon: CircleUserRound, group: "用户" },
  { href: "/ticket", label: "我的工单", description: "联系技术支持", icon: LifeBuoy, group: "用户" },
  { href: "/traffic", label: "流量明细", description: "近期开销记录", icon: BarChart3, group: "用户" },
];

export const portalSections: PortalSection[] = allPortalSections;

export const migratableSections = new Map(
  portalSections
    .filter((section) => section.href !== "/dashboard")
    .map((section) => [section.href.slice(1), section]),
);
