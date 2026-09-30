import { BugOff, ChartNoAxesColumn, Cloud, CreditCard, Gauge, GitFork, House, Blocks, Settings2, Users } from "lucide-react";
import type { NavItem } from "@/components/aera/app-shell";

export const BASE = "/demo/cursor-dashboard";

export const NAV_GROUPS: NavItem[][] = [
  [
    { href: "overview", label: "Overview", icon: House },
    { href: "settings", label: "Settings", icon: Settings2 },
  ],
  [
    { href: "cloud-agents", label: "Cloud Agents", icon: Cloud },
    { href: "bugbot", label: "Bugbot", icon: BugOff },
  ],
  [
    { href: "plugins", label: "Plugins", icon: Blocks },
    { href: "integrations", label: "Integrations", icon: GitFork },
  ],
  [
    { href: "members", label: "Members", icon: Users },
    { href: "usage", label: "Usage", icon: ChartNoAxesColumn },
    { href: "spending", label: "Spending", icon: Gauge },
    { href: "billing", label: "Billing & Invoices", icon: CreditCard },
  ],
];

export const NAV_ITEMS = NAV_GROUPS.flat();
