import { BookOpen, ChartNoAxesColumn, Gift, Home, LifeBuoy, Receipt, Server, ShoppingCart, UserRound } from "lucide-react";
import type { NavItem } from "@/components/aera/app-shell";
import { DEMO_SITE } from "@/lib/demo-site/flag";

/** Where the panel pages are mounted: under /demo/panel in the app, at the site root in the static demo site. */
export const BASE = process.env.NEXT_PUBLIC_PANEL_BASE ?? "/demo/panel";

// A static export cannot prerender an order or ticket number that only exists at run time, so the detail pages
// are one page each and take the number from the query string.
export const orderHref = (tradeNo: string) => `${BASE}/order/view?no=${encodeURIComponent(tradeNo)}`;
export const ticketHref = (id: number) => `${BASE}/ticket/view?id=${id}`;

/** The same nine pages and groups as the live panel (src/lib/navigation.ts). */
const ALL_GROUPS: NavItem[][] = [
  [
    { href: "dashboard", label: "仪表盘", icon: Home },
    { href: "knowledge", label: "使用文档", icon: BookOpen },
  ],
  [
    { href: "plan", label: "购买订阅", icon: ShoppingCart },
    { href: "node", label: "节点状态", icon: Server },
  ],
  [
    { href: "order", label: "我的订单", icon: Receipt },
    { href: "invite", label: "我的邀请", icon: Gift },
  ],
  [
    { href: "profile", label: "个人中心", icon: UserRound },
    { href: "ticket", label: "我的工单", icon: LifeBuoy },
    { href: "traffic", label: "流量明细", icon: ChartNoAxesColumn },
  ],
];

/** The demo site leaves the node status page out until it is done. */
export const NAV_GROUPS: NavItem[][] = DEMO_SITE ? ALL_GROUPS.map((group) => group.filter((item) => item.href !== "node")).filter((group) => group.length > 0) : ALL_GROUPS;
