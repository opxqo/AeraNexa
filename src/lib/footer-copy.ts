// Content of the site footer (src/components/footer), in both languages. Like
// home-copy.ts, the two entries share one type, so TypeScript flags anything
// missing from either. Contact details, social accounts and the legal pages
// are placeholders (marked TODO): fill them in before the footer goes live.

import type { HomeLocale } from "@/lib/home-copy";

export type FooterLink = { label: string; href: string };
export type TickerTab = { label: string; items: FooterLink[] };

export type FooterCopy = {
  lang: string;
  tagline: [string, string];
  labels: { socials: string; product: string; worksWith: string; network: string; operating: string; email: string; telegram: string; hours: string };
  socials: { name: string; href: string; icon: "telegram" | "mail" | "github" }[];
  menu: FooterLink[];
  worksWith: { text: [string, string]; clients: string[] };
  tabs: [TickerTab, TickerTab];
  network: { lines: [string, string]; link: FooterLink };
  operating: string[];
  contact: { email: FooterLink; telegram: FooterLink; hours: string };
  legal: { copyright: string; links: FooterLink[]; note: string };
};

// The cities and services of the home page's "unlock" block.
const CITIES = ["Tokyo", "Singapore", "Sydney", "Mumbai", "London", "Frankfurt", "Johannesburg", "Los Angeles", "New York", "São Paulo"];
const SERVICES = ["ChatGPT", "Claude", "Gemini", "Perplexity", "GitHub Copilot", "Grok", "Midjourney", "Netflix", "YouTube", "Disney+", "Prime Video", "HBO Max", "Spotify", "TikTok"];
const CLIENTS = ["Clash Verge", "Clash Meta", "Shadowrocket", "Stash", "v2rayN"];

export const footerCopy: Record<HomeLocale, FooterCopy> = {
  zh: {
    lang: "zh-CN",
    tagline: ["一个订阅，", "全球网络随时可用。"],
    labels: { socials: "社交", product: "产品", worksWith: "支持的客户端", network: "网络", operating: "覆盖区域", email: "邮箱", telegram: "Telegram", hours: "服务时间" },
    // TODO: real accounts.
    socials: [
      { name: "Telegram", href: "#", icon: "telegram" },
      { name: "Email", href: "#", icon: "mail" },
      { name: "GitHub", href: "#", icon: "github" },
    ],
    menu: [
      { label: "首页", href: "/" },
      { label: "节点", href: "/node" },
      { label: "套餐价格", href: "/pricing" },
      { label: "帮助中心", href: "/knowledge" },
      { label: "创建账户", href: "/register" },
      { label: "登录", href: "/login" },
      { label: "我的订阅", href: "/plan" },
      { label: "工单", href: "/ticket" },
      { label: "用户中心", href: "/dashboard" },
    ],
    worksWith: { text: ["订阅格式按客户端自动适配，", "配置不需要手动转换。"], clients: CLIENTS },
    tabs: [
      { label: "节点区域", items: CITIES.map((name) => ({ label: name, href: "/node" })) },
      { label: "已测服务", items: SERVICES.map((name) => ({ label: name, href: "/pricing" })) },
    ],
    network: { lines: ["亚太、欧洲、北美和非洲的多条线路，", "节点状态实时可见。"], link: { label: "查看节点状态", href: "/node" } },
    operating: ["亚太", "欧洲", "北美", "非洲"],
    // TODO: real contact details.
    contact: { email: { label: "support@example.com", href: "mailto:support@example.com" }, telegram: { label: "@example_support", href: "#" }, hours: "每天 · 工单 24 小时内回复" },
    // TODO: the legal pages do not exist yet.
    legal: {
      copyright: "© 2026 AeraNexa. 保留所有权利。",
      links: [
        { label: "隐私政策", href: "#privacy" },
        { label: "服务条款", href: "#terms" },
        { label: "退款政策", href: "#refund" },
        { label: "Cookie 设置", href: "#cookies" },
      ],
      note: "流量按节点统计。",
    },
  },
  en: {
    lang: "en",
    tagline: ["One subscription,", "the whole world online."],
    labels: { socials: "Socials", product: "Product", worksWith: "Works with", network: "Network", operating: "Operating across", email: "Email", telegram: "Telegram", hours: "Support hours" },
    socials: [
      { name: "Telegram", href: "#", icon: "telegram" },
      { name: "Email", href: "#", icon: "mail" },
      { name: "GitHub", href: "#", icon: "github" },
    ],
    menu: [
      { label: "Home", href: "/" },
      { label: "Nodes", href: "/node" },
      { label: "Pricing", href: "/pricing" },
      { label: "Help center", href: "/knowledge" },
      { label: "Create account", href: "/register" },
      { label: "Sign in", href: "/login" },
      { label: "My plan", href: "/plan" },
      { label: "Tickets", href: "/ticket" },
      { label: "Dashboard", href: "/dashboard" },
    ],
    worksWith: { text: ["The subscription format is picked for each client,", "so there is nothing to convert by hand."], clients: CLIENTS },
    tabs: [
      { label: "Regions", items: CITIES.map((name) => ({ label: name, href: "/node" })) },
      { label: "Services", items: SERVICES.map((name) => ({ label: name, href: "/pricing" })) },
    ],
    network: { lines: ["Lines across Asia-Pacific, Europe, North America", "and Africa, with live node status."], link: { label: "View node status", href: "/node" } },
    operating: ["Asia-Pacific", "Europe", "North America", "Africa"],
    contact: { email: { label: "support@example.com", href: "mailto:support@example.com" }, telegram: { label: "@example_support", href: "#" }, hours: "Every day / ticket replies within 24 hours" },
    legal: {
      copyright: "© 2026 AeraNexa. All rights reserved.",
      links: [
        { label: "Privacy Policy", href: "#privacy" },
        { label: "Terms of Service", href: "#terms" },
        { label: "Refund Policy", href: "#refund" },
        { label: "Cookie Settings", href: "#cookies" },
      ],
      note: "Traffic is counted per node.",
    },
  },
};
