import {
  BarChart3,
  BookOpen,
  CircleUserRound,
  FlaskConical,
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

/**
 * `/payment-test` 是**静态原型**：它不发任何请求，只是把「下单 → 回调」的界面过一遍
 * （见 `components/payment-test-page.tsx`，全文件没有任何 fetch）。
 *
 * 开发时用它对齐支付接口的形状，但挂在所有用户的「财务」导航里时，点进去毫无反应，
 * 用户只会以为系统坏了。所以生产环境直接不放进导航，路由也一并 404（见该页）。
 */
const DEMO_ONLY_SECTIONS = new Set(["/payment-test"]);

const allPortalSections: PortalSection[] = [
  { href: "/dashboard", label: "仪表盘", description: "订阅与账户概览", icon: Gauge },
  { href: "/knowledge", label: "使用文档", description: "客户端配置指引", icon: BookOpen },
  { href: "/plan", label: "购买订阅", description: "选择套餐与周期", icon: ShoppingBag, group: "订阅" },
  { href: "/node", label: "节点状态", description: "可用线路与倍率", icon: BadgeCheck, group: "订阅" },
  { href: "/order", label: "我的订单", description: "订单与支付状态", icon: List, group: "财务" },
  { href: "/payment-test", label: "支付测试", description: "模拟下单与回调流程", icon: FlaskConical, group: "财务" },
  { href: "/invite", label: "我的邀请", description: "邀请码与佣金", icon: Gift, group: "财务" },
  { href: "/profile", label: "个人中心", description: "安全与偏好设置", icon: CircleUserRound, group: "用户" },
  { href: "/ticket", label: "我的工单", description: "联系技术支持", icon: LifeBuoy, group: "用户" },
  { href: "/traffic", label: "流量明细", description: "近期开销记录", icon: BarChart3, group: "用户" },
];

export const portalSections: PortalSection[] = allPortalSections.filter(
  (section) => process.env.NODE_ENV !== "production" || !DEMO_ONLY_SECTIONS.has(section.href),
);

export const migratableSections = new Map(
  portalSections
    .filter((section) => section.href !== "/dashboard")
    .map((section) => [section.href.slice(1), section]),
);
