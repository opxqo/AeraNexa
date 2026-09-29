// Content of the /pricing page and of the plan cards at the bottom of the home
// page, in both languages (laid out after lightdash.com/pricing). Like
// home-copy.ts, the two entries share one type, so TypeScript flags anything
// missing from either. Edit the prices, quotas and features here; the numbers
// are still placeholders, not real offers.

import type { HomeLocale } from "@/lib/home-copy";

export type SceneName = "earthMoon" | "solar" | "galaxy";

export type PlanCopy = {
  label: string;
  scene: SceneName;
  headline: string;
  price?: { amount: string; unit: string };
  blurb: string;
  lead?: string; // a bold first sentence, ahead of the blurb
  cta: { label: string; href: string };
  eyebrow: string;
  features: string[];
  featured?: boolean;
  tone?: "night"; // a deep indigo card instead of white
};

// A table cell: true is a tick, false is empty, a string is shown as text.
// A run of text: [text, bold] pairs; "\n" starts a new line.
export type Rich = { rich: [string, boolean?][] };
export type Cell = boolean | string | Rich;
export type TableRow = { name: string; tip?: string; cells: [Cell, Cell, Cell] };
export type TableIcon = "cursor" | "puzzle" | "support" | "shield";
export type TableCopy = { title: string; icon: TableIcon; rows: TableRow[] };

export type PricingCopy = {
  lang: string;
  meta: { title: string; description: string };
  hero: { lead: string; tail: string };
  plans: PlanCopy[];
  compare: { title: string; planNames: [string, string, string]; tables: TableCopy[] };
  home: { title: string; lead: string; more: string };
};

export const pricingCopy: Record<HomeLocale, PricingCopy> = {
  zh: {
    lang: "zh-CN",
    meta: { title: "套餐价格", description: "AeraNexa 套餐价格：地月系、太阳系、银河系三档，按流量和同时在线设备选择，附完整功能对比。" },
    home: { title: "选择适合你的套餐", lead: "三档套餐，流量与设备数依次增加，所有套餐都包含全部基础节点。", more: "查看完整套餐对比" },
    hero: { lead: "一个订阅，", tail: "全球网络随时可用。" },
    plans: [
      {
        label: "地月系",
        scene: "earthMoon",
        headline: "轻量使用",
        price: { amount: "¥19", unit: "/ 月" },
        blurb: "满足日常浏览和办公，价格友好。",
        cta: { label: "立即开始", href: "/register" },
        eyebrow: "适合个人",
        features: ["每月 100 GB 流量", "同时在线 3 台设备", "全部基础节点", "VLESS · VMess · Trojan", "订阅格式自动适配", "工单支持"],
      },
      {
        label: "太阳系",
        scene: "solar",
        headline: "多设备畅连",
        price: { amount: "¥39", unit: "/ 月" },
        lead: "没有隐藏费用。",
        blurb: "多设备同时在线，流量更充裕，适合每天都用。",
        cta: { label: "选择标准版", href: "/register" },
        eyebrow: "最受欢迎",
        features: ["每月 300 GB 流量", "同时在线 5 台设备", "全部节点，含高速线路", "AI 与国际流媒体已实测可用", "可购买流量重置", "详细用量统计", "优先工单支持", "节点状态实时可见"],
        featured: true,
      },
      {
        label: "银河系",
        scene: "galaxy",
        headline: "全家共享",
        price: { amount: "¥89", unit: "/ 月" },
        blurb: "大流量、多设备，适合家庭或小团队共用。",
        cta: { label: "选择旗舰版", href: "/register" },
        eyebrow: "包含标准版全部功能，另有",
        features: ["每月 1 TB 流量", "同时在线 10 台设备", "全部节点，专属线路优先", "用量统计可导出", "设备管理与一键移除", "8 小时内响应的支持", "新线路优先体验"],
        tone: "night",
      },
    ],
    compare: {
      title: "对比套餐",
      planNames: ["地月系", "太阳系", "银河系"],
      tables: [
        {
          title: "套餐功能",
          icon: "cursor",
          rows: [
            { name: "每月流量", cells: ["100 GB", "300 GB", "1 TB"] },
            { name: "同时在线设备", tip: "按设备登记（HWID）计入名额", cells: ["3 台", "5 台", "10 台"] },
            { name: "可用节点", cells: ["基础节点", "全部节点", "全部 + 专属"] },
            { name: "VLESS + REALITY", cells: [true, true, true] },
            { name: "VMess / Trojan", cells: [true, true, true] },
            { name: "订阅格式自动适配", tip: "Clash 系客户端下发 Clash 配置，其余下发 Base64", cells: [true, true, true] },
            { name: "流量重置", tip: "用完后可付费重置已用流量，到期时间不变", cells: [false, true, true] },
            { name: "用量统计", cells: ["基础", "详细", "详细，可导出"] },
            { name: "超额流量", tip: "两种方式任选，随时可改", cells: [false, { rich: [["按量付费", true], [" （每 GB ¥0.5）\n或\n"], ["固定加油包", true], [" （50 GB ¥19）"]] }, "按用量计费"] },
            { name: "设备管理", cells: [true, true, true] },
            { name: "节点状态实时推送", cells: [false, true, true] },
            { name: "到期提醒", cells: [true, true, true] },
          ],
        },
        {
          title: "线路与解锁",
          icon: "puzzle",
          rows: [
            { name: "地区覆盖", cells: ["亚太", "亚太 + 欧美", "亚太 + 欧美 + 专属"] },
            { name: "主流 AI 服务", tip: "ChatGPT、Claude、Gemini 等，已实测可用", cells: [false, true, true] },
            { name: "国际流媒体", tip: "Netflix、YouTube、Disney+ 等，已实测可用", cells: [false, true, true] },
            { name: "高速线路", cells: [false, true, true] },
            { name: "专属线路", cells: [false, false, true] },
          ],
        },
        {
          title: "支持与服务",
          icon: "support",
          rows: [
            { name: "支持渠道", cells: ["工单", "工单，优先处理", "工单，专属通道"] },
            { name: "响应时间", cells: ["48 小时", "24 小时", "8 小时"] },
            { name: "使用教程", cells: [true, true, true] },
            { name: "客户端配置协助", cells: [false, true, true] },
            { name: "新线路优先体验", cells: [false, false, true] },
          ],
        },
        {
          title: "安全与账户",
          icon: "shield",
          rows: [
            { name: "订阅链接重置", tip: "链接泄露后一键生成新链接，旧链接失效", cells: [true, true, true] },
            { name: "设备登记与移除", cells: [true, true, true] },
            { name: "登录保护", cells: ["密码", "密码", "密码"] },
            { name: "流量按节点上报", cells: [true, true, true] },
          ],
        },
      ],
    },
  },
  en: {
    lang: "en",
    meta: { title: "Pricing", description: "AeraNexa plans: Earth–Moon, Solar System and Galaxy, by traffic and devices online, with a full feature comparison." },
    home: { title: "Pick the plan that fits", lead: "Three plans, with more traffic and devices at each step. Every plan includes all standard nodes.", more: "See the full plan comparison" },
    hero: { lead: "One subscription,", tail: "the whole world online." },
    plans: [
      {
        label: "Earth–Moon",
        scene: "earthMoon",
        headline: "Light use",
        price: { amount: "$3", unit: "/ month" },
        blurb: "Everyday browsing and work, at a friendly price.",
        cta: { label: "Get started", href: "/register" },
        eyebrow: "For one person",
        features: ["100 GB of traffic a month", "3 devices online at once", "All standard nodes", "VLESS · VMess · Trojan", "Subscription format picked for you", "Ticket support"],
      },
      {
        label: "Solar System",
        scene: "solar",
        headline: "Every device",
        price: { amount: "$6", unit: "/ month" },
        lead: "No hidden fees.",
        blurb: "More devices at once and more traffic, for people who use it daily.",
        cta: { label: "Choose Standard", href: "/register" },
        eyebrow: "Most popular",
        features: ["300 GB of traffic a month", "5 devices online at once", "All nodes, fast lines included", "AI tools and streaming, tested", "Traffic reset on request", "Detailed usage stats", "Priority ticket support", "Live node status"],
        featured: true,
      },
      {
        label: "Galaxy",
        scene: "galaxy",
        headline: "The whole family",
        price: { amount: "$14", unit: "/ month" },
        blurb: "Lots of traffic and devices, for a family or a small team.",
        cta: { label: "Choose Flagship", href: "/register" },
        eyebrow: "Everything in Standard, plus",
        features: ["1 TB of traffic a month", "10 devices online at once", "All nodes, dedicated lines first", "Exportable usage stats", "Device management, one-click remove", "Support that answers within 8 hours", "First access to new lines"],
        tone: "night",
      },
    ],
    compare: {
      title: "Compare our plans",
      planNames: ["Earth–Moon", "Solar System", "Galaxy"],
      tables: [
        {
          title: "Plan features",
          icon: "cursor",
          rows: [
            { name: "Traffic per month", cells: ["100 GB", "300 GB", "1 TB"] },
            { name: "Devices online", tip: "Counted by registered device (HWID)", cells: ["3", "5", "10"] },
            { name: "Nodes", cells: ["Standard", "All", "All + dedicated"] },
            { name: "VLESS + REALITY", cells: [true, true, true] },
            { name: "VMess / Trojan", cells: [true, true, true] },
            { name: "Subscription format", tip: "Clash-family clients get a Clash config, the rest get Base64", cells: [true, true, true] },
            { name: "Traffic reset", tip: "Pay to zero the used traffic; the expiry date stays", cells: [false, true, true] },
            { name: "Usage stats", cells: ["Basic", "Detailed", "Detailed, exportable"] },
            { name: "Extra traffic", tip: "Pick either way, change any time", cells: [false, { rich: [["Pay as you go", true], [" ($0.07/GB)\nor\n"], ["Predictable", true], [" ($3 for 50 GB top-ups)"]] }, "Usage based pricing"] },
            { name: "Device management", cells: [true, true, true] },
            { name: "Live node status", cells: [false, true, true] },
            { name: "Expiry reminders", cells: [true, true, true] },
          ],
        },
        {
          title: "Lines and unlocking",
          icon: "puzzle",
          rows: [
            { name: "Regions", cells: ["Asia-Pacific", "Asia-Pacific + West", "Asia-Pacific + West + dedicated"] },
            { name: "Mainstream AI tools", tip: "ChatGPT, Claude, Gemini and more, tested", cells: [false, true, true] },
            { name: "Global streaming", tip: "Netflix, YouTube, Disney+ and more, tested", cells: [false, true, true] },
            { name: "Fast lines", cells: [false, true, true] },
            { name: "Dedicated lines", cells: [false, false, true] },
          ],
        },
        {
          title: "Support and service",
          icon: "support",
          rows: [
            { name: "Support channel", cells: ["Tickets", "Tickets, priority", "Tickets, dedicated"] },
            { name: "Response time", cells: ["48 hours", "24 hours", "8 hours"] },
            { name: "Guides", cells: [true, true, true] },
            { name: "Client setup help", cells: [false, true, true] },
            { name: "First access to new lines", cells: [false, false, true] },
          ],
        },
        {
          title: "Security and account",
          icon: "shield",
          rows: [
            { name: "Subscription link reset", tip: "One click makes a new link; the old one stops working", cells: [true, true, true] },
            { name: "Device check-in and removal", cells: [true, true, true] },
            { name: "Sign-in protection", cells: ["Password", "Password", "Password"] },
            { name: "Traffic reported per node", cells: [true, true, true] },
          ],
        },
      ],
    },
  },
};
