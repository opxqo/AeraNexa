// Mock data for the account panel demo (/demo/panel). Shapes follow what the real panel shows
// (src/lib/api/types.ts), but nothing here talks to a backend.

const GB = 1024 ** 3;

export const PANEL_USER = { name: "alex.smith", email: "alex.smith@example.com", avatar: "ash" as const };

export const SUBSCRIPTION = {
  planName: "专业版",
  periodLabel: "季付",
  expiredAt: new Date(2026, 3, 24),
  daysRemaining: 29,
  resetInDays: 7,
  usedBytes: 127.43 * GB,
  totalBytes: 500 * GB,
  subscribeUrl: "https://panel.example.com/api/v1/client/subscribe?token=demo0123456789abcdef",
  queuedPlans: [{ tradeNo: "2026031800013", planName: "入门版", periodLabel: "月付" }],
};

export const PANEL_STAT = { unpaidOrders: 1, openTickets: 1 };

export const RESET_QUOTE = { planName: "专业版", priceCents: 1290, percent: 30 };

export const NOTICES = [
  {
    id: 1,
    title: "东京线路扩容完成",
    date: "2026-03-24 10:30",
    content: "东京 02、东京 03 两条线路已完成带宽升级，高峰时段延迟与丢包明显改善。如遇连接不稳，请在客户端重新更新订阅后再试。",
  },
  {
    id: 2,
    title: "3 月 28 日凌晨例行维护",
    date: "2026-03-22 18:00",
    content: "我们将于 3 月 28 日 02:00–03:00（UTC+8）进行例行维护，期间订阅服务可能短暂中断，已建立的连接不受影响。",
  },
  {
    id: 3,
    title: "新增 Stash 与 Surfboard 一键导入",
    date: "2026-03-10 09:00",
    content: "一键订阅现已支持 Stash 与 Surfboard，在仪表盘点击「一键订阅」即可导入。",
  },
];

export const CLIENTS = [
  { name: "Clash For Windows", icon: "/assets/icon/Clash For Windows.png" },
  { name: "Clash For Android", icon: "/assets/icon/Clash For Android.png" },
  { name: "ClashX", icon: "/assets/icon/ClashX.png" },
  { name: "Shadowrocket", icon: "/assets/icon/Shadowrocket.png" },
  { name: "QuantumultX", icon: "/assets/icon/QuantumultX.png" },
  { name: "Surge", icon: "/assets/icon/Surge.png" },
  { name: "Stash", icon: "/assets/icon/Stash.png" },
  { name: "Surfboard", icon: "/assets/icon/Surfboard.png" },
];

/** The demo's "today" (the subscription expires 29 days later), and when the current cycle began. */
export const PANEL_TODAY = new Date(2026, 2, 26);
/** The day the current billing cycle began (the traffic counter resets on it). */
export const CYCLE_START = "2026-01-24";

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type TrafficDay = { date: string; mb: number; level: 0 | 1 | 2 | 3 | 4 };

/**
 * Daily traffic for a year, from the Sunday 52 weeks back up to PANEL_TODAY, in MB. Busier on weekdays,
 * with quiet days and the odd spike. Scaled so this cycle's total equals the dashboard's "used" figure.
 */
export const TRAFFIC_DAYS: TrafficDay[] = (() => {
  const random = seeded(11);
  const start = new Date(PANEL_TODAY);
  start.setDate(start.getDate() - start.getDay() - 52 * 7);
  const raw: { date: string; value: number }[] = [];
  for (const day = new Date(start); day <= PANEL_TODAY; day.setDate(day.getDate() + 1)) {
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    const quiet = random() < 0.12;
    const spike = random() < 0.05 ? 3.5 : 1;
    raw.push({ date: isoDay(day), value: quiet ? 0 : (0.2 + random() * 1.6) * (weekend ? 0.6 : 1) * spike });
  }
  const cycle = raw.filter((d) => d.date >= CYCLE_START).reduce((sum, d) => sum + d.value, 0);
  const k = (SUBSCRIPTION.usedBytes / 1024 ** 2) / cycle;
  const mbs = raw.map((d) => ({ date: d.date, mb: Math.round(d.value * k) }));
  const top = Math.max(...mbs.map((d) => d.mb));
  return mbs.map(({ date, mb }) => ({ date, mb, level: (mb === 0 ? 0 : Math.min(4, 1 + Math.floor((mb / top) * 4 * 1.15))) as TrafficDay["level"] }));
})();

// ------------------------------------------------------------------ plans on sale (购买订阅)

export type PlanPeriodKey = "month_price" | "quarter_price" | "half_year_price" | "year_price";

export const PERIOD_LABELS: Record<PlanPeriodKey, string> = { month_price: "月付", quarter_price: "季付", half_year_price: "半年付", year_price: "年付" };
export const PERIOD_MONTHS: Record<PlanPeriodKey, number> = { month_price: 1, quarter_price: 3, half_year_price: 6, year_price: 12 };

export type SalePlan = {
  id: number;
  name: string;
  tagline: string;
  /** GB per cycle */
  transfer_enable: number;
  /** Mbps; null = unlimited */
  speed_limit: number | null;
  /** One feature per line, as the admin types them. */
  content: string[];
  /** Prices in cents; a missing period is not for sale. */
  prices: Partial<Record<PlanPeriodKey, number>>;
  recommended?: boolean;
  /** The plan whose features this one builds on, for the "All X features plus" line. */
  extends?: string;
};

/** Yearly costs 10 months of the monthly price, so the page can say "2 months free" honestly. */
export const SALE_PLANS: SalePlan[] = [
  {
    id: 1,
    name: "入门版",
    tagline: "个人日常使用",
    transfer_enable: 200,
    speed_limit: 100,
    content: ["全部基础线路", "最多 3 台设备同时在线", "全平台客户端", "流媒体基础解锁", "工单支持（48 小时内回复）"],
    prices: { month_price: 1500, quarter_price: 4200, half_year_price: 8000, year_price: 15000 },
  },
  {
    id: 2,
    name: "专业版",
    tagline: "高频使用与多设备",
    transfer_enable: 500,
    speed_limit: 300,
    content: ["高级专线线路", "最多 5 台设备同时在线", "流媒体与 AI 服务解锁", "优先工单支持", "流量用尽可购买重置"],
    prices: { month_price: 3000, quarter_price: 8400, half_year_price: 16000, year_price: 30000 },
    recommended: true,
    extends: "入门版",
  },
  {
    id: 3,
    name: "旗舰版",
    tagline: "团队与大流量场景",
    transfer_enable: 1000,
    speed_limit: null,
    content: ["独享专线与低延迟线路", "最多 10 台设备同时在线", "不限速", "1 对 1 技术支持", "新线路优先体验"],
    prices: { month_price: 6000, quarter_price: 16800, half_year_price: 32000, year_price: 60000 },
    extends: "专业版",
  },
];

export const ENTERPRISE = {
  name: "企业定制",
  tagline: "为团队与大用量准备",
  extends: "旗舰版",
  content: ["独立线路与专属 IP", "不限设备数", "按需定制合同与发票", "专属客户经理", "SLA 可用性保障"],
};

/** The subscription the user holds, for the "when does this take effect" hint. */
export const CURRENT_SUBSCRIPTION = { planId: 2, planName: "专业版", expiresOn: "2026 年 4 月 24 日", queued: 1 };

/** Coupon codes the demo accepts (cents off). */
export const COUPONS: Record<string, number> = { WELCOME10: 1000 };

// ------------------------------------------------------------------ orders (我的订单)

/** The demo's wall clock, so orders created in the session carry a believable time. */
export const PANEL_NOW = new Date(2026, 2, 26, 10, 30);

export type OrderStatus = 0 | 1 | 2 | 3 | 4 | 5;

export const ORDER_STATUS: Record<OrderStatus, string> = { 0: "待支付", 1: "待生效", 2: "已取消", 3: "已完成", 4: "已折抵", 5: "已退款" };

export type OrderType = "新购" | "续费" | "升级" | "流量重置";

export type Order = {
  tradeNo: string;
  planId: number | null;
  planName: string;
  /** GB of the plan, for the product block. */
  transferGb: number;
  type: OrderType;
  periodLabel: string;
  status: OrderStatus;
  /** Cents. */
  subtotal: number;
  discount: number;
  surplus: number;
  refund: number;
  total: number;
  createdAt: number;
  paidAt?: number;
  cancelReason?: "timeout" | "user" | "admin";
  cancelledAt?: number;
  /** Payment must be made before this (ms); only for pending orders. */
  payDeadline?: number;
};

/** Month/day of an order in the demo's year-and-a-half: Jun-Dec 2025, Jan-Mar 2026. */
const at = (month: number, day: number, hour = 10, minute = 0) => new Date(month >= 6 ? 2025 : 2026, month - 1, day, hour, minute).getTime();

type Seed = Partial<Order> & Pick<Order, "tradeNo" | "planId" | "planName" | "transferGb" | "type" | "periodLabel" | "status" | "subtotal" | "total" | "createdAt">;
const order = (seed: Seed): Order => ({ discount: 0, surplus: 0, refund: 0, ...seed });

/** Newest first. The first is pending, the second is the queued plan shown on the dashboard. */
export const ORDERS: Order[] = [
  order({ tradeNo: "2026032600021", planId: 2, planName: "专业版", transferGb: 500, type: "续费", periodLabel: "季付", status: 0, subtotal: 8400, total: 8400, createdAt: PANEL_NOW.getTime() - 10 * 60_000, payDeadline: PANEL_NOW.getTime() + 20 * 60_000 }),
  order({ tradeNo: "2026031800013", planId: 1, planName: "入门版", transferGb: 200, type: "新购", periodLabel: "月付", status: 1, subtotal: 1500, total: 1500, createdAt: at(3, 18, 21, 5), paidAt: at(3, 18, 21, 7) }),
  order({ tradeNo: "2026030500010", planId: 2, planName: "专业版", transferGb: 500, type: "续费", periodLabel: "月付", status: 2, subtotal: 3000, total: 3000, createdAt: at(3, 5, 9, 12), cancelReason: "user", cancelledAt: at(3, 5, 9, 14) }),
  order({ tradeNo: "2026030100011", planId: 2, planName: "专业版", transferGb: 500, type: "续费", periodLabel: "月付", status: 3, subtotal: 3000, discount: 1000, total: 2000, createdAt: at(3, 1, 20, 40), paidAt: at(3, 1, 20, 42) }),
  order({ tradeNo: "2026022000008", planId: 3, planName: "旗舰版", transferGb: 1000, type: "新购", periodLabel: "月付", status: 2, subtotal: 6000, total: 6000, createdAt: at(2, 20, 14, 30), cancelReason: "timeout", cancelledAt: at(2, 20, 15, 0) }),
  order({ tradeNo: "2026021500009", planId: 2, planName: "专业版", transferGb: 500, type: "流量重置", periodLabel: "流量重置", status: 3, subtotal: 900, total: 900, createdAt: at(2, 15, 18, 8), paidAt: at(2, 15, 18, 9) }),
  order({ tradeNo: "2026012400004", planId: 2, planName: "专业版", transferGb: 500, type: "新购", periodLabel: "季付", status: 3, subtotal: 8400, total: 8400, createdAt: at(1, 24, 10, 2), paidAt: at(1, 24, 10, 4) }),
  order({ tradeNo: "2025122000005", planId: 2, planName: "专业版", transferGb: 500, type: "升级", periodLabel: "月付", status: 4, subtotal: 3000, surplus: 1000, total: 2000, createdAt: at(12, 20, 16, 20), paidAt: at(12, 20, 16, 22) }),
  order({ tradeNo: "2025112000006", planId: 2, planName: "专业版", transferGb: 500, type: "新购", periodLabel: "月付", status: 5, subtotal: 3000, refund: 3000, total: 3000, createdAt: at(11, 20, 11, 45), paidAt: at(11, 20, 11, 47) }),
  order({ tradeNo: "2025102400003", planId: 2, planName: "专业版", transferGb: 500, type: "新购", periodLabel: "季付", status: 3, subtotal: 8400, total: 8400, createdAt: at(10, 24, 10, 5), paidAt: at(10, 24, 10, 6) }),
  order({ tradeNo: "2025072400002", planId: 1, planName: "入门版", transferGb: 200, type: "续费", periodLabel: "季付", status: 3, subtotal: 4200, total: 4200, createdAt: at(7, 24, 9, 30), paidAt: at(7, 24, 9, 31) }),
  order({ tradeNo: "2025062400001", planId: 1, planName: "入门版", transferGb: 200, type: "新购", periodLabel: "月付", status: 3, subtotal: 1500, total: 1500, createdAt: at(6, 24, 22, 15), paidAt: at(6, 24, 22, 16) }),
];

export type PaymentMethod = { id: number; name: string; icon: "alipay" | "wechat" | "balance" };

export const PAYMENT_METHODS: PaymentMethod[] = [
  { id: 1, name: "支付宝", icon: "alipay" },
  { id: 2, name: "微信支付", icon: "wechat" },
  { id: 3, name: "账户余额", icon: "balance" },
];

// ------------------------------------------------------------------ account (个人中心)

export const PANEL_ACCOUNT = {
  email: "alex.smith@example.com",
  role: "普通用户",
  uuid: "5b1d9c1e-8a3f-4c57-9e0a-2f6d7b4c31a8",
  telegramId: "912345678",
  /** Cents. */
  balance: 7450,
  commission: 1280,
  /** Device slots the plan allows; 0 would mean unlimited. */
  deviceLimit: 5,
  expiresOn: "2026-04-24",
};

export type WalletTx = { id: number; at: number; description: string; amount: number; balanceAfter: number };

const tx = (month: number, day: number, hour: number, minute: number, description: string, amount: number) => ({ at: new Date(month >= 6 ? 2025 : 2026, month - 1, day, hour, minute).getTime(), description, amount });

/** Oldest first here; the running balance is worked out from it, ends at PANEL_ACCOUNT.balance, and the list is exported newest first. */
const HISTORY = [
  tx(11, 2, 19, 5, "卡密充值", 3000),
  tx(11, 20, 11, 47, "订单支付：专业版 月付", -3000),
  tx(11, 21, 8, 10, "订单退款：专业版 月付", 3000),
  tx(12, 30, 16, 22, "订单折抵：升级专业版", 1000),
  tx(1, 24, 10, 4, "订单退回差额", 350),
  tx(2, 15, 18, 9, "订单支付：流量重置", -900),
  tx(2, 28, 12, 0, "卡密充值", 5000),
  tx(3, 1, 20, 42, "订单支付：专业版 月付", -2000),
  tx(3, 22, 9, 30, "佣金划转到余额", 1000),
];

export const WALLET_TXS: WalletTx[] = (() => {
  let running = 0;
  return HISTORY.map((item, index) => ({ ...item, id: index + 1, balanceAfter: (running += item.amount) })).reverse();
})();

export type Device = { id: number; model: string; os: string; userAgent: string; firstSeen: number; lastSeen: number };

const when = (month: number, day: number, hour: number, minute: number) => new Date(2026, month - 1, day, hour, minute).getTime();

export const DEVICES: Device[] = [
  { id: 1, model: "MacBook Pro", os: "macOS 15.3", userAgent: "Clash-verge/2.0.3", firstSeen: when(1, 24, 10, 6), lastSeen: when(3, 26, 9, 12) },
  { id: 2, model: "iPhone 16", os: "iOS 18.3", userAgent: "Shadowrocket/2.2.58", firstSeen: when(1, 25, 8, 40), lastSeen: when(3, 26, 7, 55) },
  { id: 3, model: "Pixel 9", os: "Android 15", userAgent: "Happ/1.4.2", firstSeen: when(2, 9, 21, 15), lastSeen: when(3, 24, 22, 30) },
];

export type Pull = { client: string; userAgent: string; ip: string; lastPulled: number; times: number };

export const PULLS: Pull[] = [
  { client: "Clash Verge", userAgent: "Clash-verge/2.0.3", ip: "203.0.113.24", lastPulled: when(3, 26, 9, 12), times: 41 },
  { client: "Shadowrocket", userAgent: "Shadowrocket/2.2.58", ip: "203.0.113.24", lastPulled: when(3, 26, 7, 55), times: 23 },
  { client: "Shadowrocket", userAgent: "Shadowrocket/2.2.58", ip: "198.51.100.77", lastPulled: when(3, 21, 18, 3), times: 6 },
  { client: "Happ", userAgent: "Happ/1.4.2", ip: "198.51.100.12", lastPulled: when(3, 24, 22, 30), times: 14 },
];

/** Card codes the demo accepts, and what they credit (cents). */
export const RECHARGE_CODES: Record<string, number> = { "ANX-DEMO-0000-1111-2222-3333": 5000 };

// ------------------------------------------------------------------ invites (我的邀请)

export const INVITE = {
  /** Percent of each paid order the inviter earns; 0 would mean commissions are off. */
  rate: 10,
  /** Days after payment before a commission can be moved to the balance. */
  availableAfterDays: 7,
  /** Cents already moved to the balance (the 佣金划转到余额 line in the statement). */
  transferred: 1000,
};

export type InviteCode = { id: number; code: string; pv: number; used: number; maxUses: number | null; expiresAt: number | null; status: 0 | 1; createdAt: number };

const day = (year: number, month: number, date: number, hour = 10, minute = 0) => new Date(year, month - 1, date, hour, minute).getTime();

export const INVITE_CODES: InviteCode[] = [
  { id: 1, code: "K7M2QX9P", pv: 128, used: 3, maxUses: null, expiresAt: null, status: 0, createdAt: day(2025, 12, 2, 9, 14) },
  { id: 2, code: "H4T8LC2N", pv: 40, used: 1, maxUses: 10, expiresAt: day(2026, 4, 30, 23, 59), status: 0, createdAt: day(2026, 2, 10, 16, 30) },
  { id: 3, code: "Z9W3RD5F", pv: 22, used: 2, maxUses: 2, expiresAt: null, status: 0, createdAt: day(2026, 1, 8, 11, 2) },
  { id: 4, code: "P6B1VY8S", pv: 5, used: 0, maxUses: null, expiresAt: null, status: 1, createdAt: day(2025, 11, 19, 20, 45) },
];

export type Referral = { id: number; email: string; code: string; orders: number; paid: number; commission: number; joinedAt: number; active: boolean };

export const REFERRALS: Referral[] = [
  { id: 1, email: "lin***@example.com", code: "K7M2QX9P", orders: 1, paid: 15000, commission: 1500, joinedAt: day(2026, 1, 12, 21, 3), active: true },
  { id: 2, email: "zhou***@example.com", code: "K7M2QX9P", orders: 1, paid: 7800, commission: 780, joinedAt: day(2026, 2, 3, 8, 41), active: true },
  { id: 3, email: "wang***@example.com", code: "H4T8LC2N", orders: 1, paid: 6000, commission: 600, joinedAt: day(2026, 3, 18, 19, 27), active: true },
  { id: 4, email: "chen***@example.com", code: "Z9W3RD5F", orders: 0, paid: 0, commission: 0, joinedAt: day(2026, 3, 20, 14, 9), active: false },
];

export type Commission = { id: number; invitee: string; orderAmount: number; amount: number; settled: boolean; at: number };

/** Settled 2280 + pending 600 = 2880 earned; 1000 already moved, so 1280 can be moved (PANEL_ACCOUNT.commission). */
export const COMMISSIONS: Commission[] = [
  { id: 3, invitee: "wang***@example.com", orderAmount: 6000, amount: 600, settled: false, at: day(2026, 3, 19, 10, 5) },
  { id: 2, invitee: "zhou***@example.com", orderAmount: 7800, amount: 780, settled: true, at: day(2026, 2, 4, 9, 30) },
  { id: 1, invitee: "lin***@example.com", orderAmount: 15000, amount: 1500, settled: true, at: day(2026, 1, 13, 20, 12) },
];

// ------------------------------------------------------------------ tickets (我的工单)

export type TicketLevel = 0 | 1 | 2;
export const TICKET_LEVELS: Record<TicketLevel, string> = { 0: "低", 1: "中", 2: "高" };

export type TicketMessage = { id: number; mine: boolean; text: string; at: number };
export type Ticket = { id: number; subject: string; level: TicketLevel; /** 0 open, 1 closed */ status: 0 | 1; /** Staff answered last. */ replied: boolean; createdAt: number; updatedAt: number; messages: TicketMessage[] };

const t = (month: number, date: number, hour: number, minute: number) => new Date(month >= 6 ? 2025 : 2026, month - 1, date, hour, minute).getTime();
const msgs = (list: [boolean, string, number][]): TicketMessage[] => list.map(([mine, text, at], index) => ({ id: index + 1, mine, text, at }));

/** Newest first. One is open and answered: the dashboard's "1 ticket in progress". */
export const TICKETS: Ticket[] = [
  {
    id: 10482,
    subject: "东京节点晚高峰延迟偏高",
    level: 1,
    status: 0,
    replied: true,
    createdAt: t(3, 25, 21, 40),
    updatedAt: t(3, 26, 9, 5),
    messages: msgs([
      [true, "晚上 8 点到 11 点东京 02 的延迟会从 60ms 涨到 200ms 以上，偶尔掉线。其他时段正常。客户端是 Clash Verge，macOS。", t(3, 25, 21, 40)],
      [false, "您好，收到。我们查看了东京 02 的监控，晚高峰确实有拥塞，线路正在扩容（预计本周内完成）。", t(3, 26, 8, 50)],
      [false, "在扩容完成前，建议在客户端里切换到东京 03 或大阪 01，这两条线路目前负载较低。如果仍有问题，请告诉我们具体的掉线时间。", t(3, 26, 9, 5)],
    ]),
  },
  {
    id: 10391,
    subject: "Shadowrocket 导入订阅失败",
    level: 0,
    status: 1,
    replied: true,
    createdAt: t(3, 10, 11, 15),
    updatedAt: t(3, 10, 14, 2),
    messages: msgs([
      [true, "点「一键订阅」跳到 Shadowrocket 后提示订阅地址无效。", t(3, 10, 11, 15)],
      [false, "您好，请先确认 Shadowrocket 是最新版本，并在仪表盘重新复制订阅链接后手动添加（类型选 Subscribe）。", t(3, 10, 11, 48)],
      [true, "手动添加可以了，谢谢。", t(3, 10, 13, 55)],
      [false, "不客气，工单将关闭，有问题随时联系我们。", t(3, 10, 14, 2)],
    ]),
  },
  {
    id: 10256,
    subject: "发票开具咨询",
    level: 0,
    status: 1,
    replied: true,
    createdAt: t(2, 2, 15, 30),
    updatedAt: t(2, 2, 17, 10),
    messages: msgs([
      [true, "请问可以开具电子发票吗？抬头是公司。", t(2, 2, 15, 30)],
      [false, "可以的。请提供公司全称、税号和接收邮箱，我们会在 3 个工作日内开具并发送。", t(2, 2, 17, 10)],
    ]),
  },
  {
    id: 10077,
    subject: "支付宝支付后订单未生效",
    level: 2,
    status: 1,
    replied: true,
    createdAt: t(12, 20, 16, 25),
    updatedAt: t(12, 20, 18, 40),
    messages: msgs([
      [true, "支付宝已经扣款了，但订单一直显示待支付，订阅也没有开通。订单号 2025122000005。", t(12, 20, 16, 25)],
      [false, "非常抱歉给您带来不便。我们正在核对这笔支付，请稍等。", t(12, 20, 16, 50)],
      [false, "已确认到账，支付通知延迟导致订单状态没有更新，已为您手动开通，请刷新订阅后重试。", t(12, 20, 17, 30)],
      [true, "看到了，已经可以用了。", t(12, 20, 18, 20)],
      [false, "好的，工单将关闭。", t(12, 20, 18, 40)],
    ]),
  },
];

/** What the demo's "staff" answers when the user replies. */
export const STAFF_REPLY = "收到，我们已记录您的补充信息，技术同事会尽快跟进，有进展会在这里回复您。（演示自动回复）";

// ------------------------------------------------------------------ traffic breakdowns (流量明细)
// The live API only gives one upload/download pair per day. The hour and node dimensions below are made up
// for the demo, so the page can show them; they need backend support before they can go live.

/** Share of a day's traffic that falls in each hour, 0 to 23: quiet at night, a peak in the evening. */
export const HOUR_WEIGHTS: number[] = (() => {
  const raw = [1.2, 0.8, 0.6, 0.5, 0.5, 0.7, 1.2, 2.0, 2.8, 3.4, 3.6, 3.8, 4.0, 4.0, 4.2, 4.4, 4.8, 5.4, 6.2, 7.4, 8.4, 8.6, 7.0, 3.6];
  const total = raw.reduce((sum, value) => sum + value, 0);
  return raw.map((value) => value / total);
})();

export type TrafficNode = { code: string; name: string; /** ISO country code of public/flags */ flag: string; share: number };

/** Where the traffic goes; shares add up to 1. */
export const TRAFFIC_NODES: TrafficNode[] = [
  { code: "tokyo", name: "东京 02", flag: "jp", share: 0.34 },
  { code: "osaka", name: "大阪 01", flag: "jp", share: 0.18 },
  { code: "singapore", name: "新加坡 01", flag: "sg", share: 0.17 },
  { code: "hongkong", name: "香港 03", flag: "hk", share: 0.14 },
  { code: "losangeles", name: "洛杉矶 01", flag: "us", share: 0.1 },
  { code: "frankfurt", name: "法兰克福 01", flag: "de", share: 0.07 },
];

// ------------------------------------------------------------------ docs (使用文档)

export type Article = { id: number; category: string; title: string; /** HTML, as the admin writes it */ body: string; updatedAt: number };

const doc = (id: number, category: string, title: string, body: string, month: number, day: number): Article => ({ id, category, title, body, updatedAt: new Date(2026, month - 1, day, 10, 0).getTime() });

/** Categories in the order the folders appear; "常见问题" is shown as questions and answers. */
export const DOC_CATEGORIES = ["新手入门", "客户端配置", "常见问题", "账户与支付"] as const;
export const FAQ_CATEGORY = "常见问题";

export const KNOWLEDGE: Article[] = [
  doc(1, "新手入门", "如何开始使用", "<p>三步就能用起来：</p><ol><li>在「购买订阅」选一个套餐并完成支付。</li><li>回到「仪表盘」，点「一键订阅」，选择你使用的客户端。</li><li>客户端导入成功后，选一个节点，打开系统代理即可。</li></ol><p>第一次使用建议先看一遍对应平台的「客户端配置」。</p>", 3, 20),
  doc(2, "新手入门", "订阅与流量说明", "<p>每个套餐包含固定的周期流量（上行与下行合计）和有效期。</p><ul><li>流量用完后，可以在仪表盘<strong>购买流量重置</strong>，到期时间不变。</li><li>周期结束时流量会自动清零。</li><li>「流量明细」页可以看到每天、每个时段、每个节点的用量。</li></ul>", 3, 18),
  doc(3, "新手入门", "节点怎么选", "<p>日常使用选延迟最低、负载不高的节点即可：</p><ul><li>看「节点状态」里的在线状态和倍率。</li><li>晚高峰（20:00–23:00）部分节点会拥塞，可切换到负载较低的线路。</li><li>流媒体和 AI 服务建议使用专业版及以上的高级线路。</li></ul>", 3, 12),
  doc(4, "客户端配置", "Windows：Clash Verge", "<ol><li>下载并安装 Clash Verge（官网或 GitHub Releases）。</li><li>在仪表盘点「一键订阅」→ Clash For Windows，或复制订阅链接。</li><li>打开 Clash Verge →「订阅」→ 粘贴链接 → 导入。</li><li>选择节点，开启「系统代理」。</li></ol><p>如果导入失败，请确认订阅链接末尾带有 <code>flag=clash</code>。</p>", 3, 16),
  doc(5, "客户端配置", "macOS：ClashX / Clash Verge", "<ol><li>安装 ClashX 或 Clash Verge。</li><li>复制订阅链接，在「配置」里选择「托管配置」并粘贴。</li><li>菜单栏图标 → 设置为系统代理。</li></ol><p>首次启动如提示「无法验证开发者」，到「系统设置 → 隐私与安全性」允许打开。</p>", 3, 14),
  doc(6, "客户端配置", "iOS：Shadowrocket", "<ol><li>用海外 Apple ID 下载 Shadowrocket。</li><li>在仪表盘点「一键订阅」→ Shadowrocket，或手动添加订阅（类型选 Subscribe）。</li><li>回到首页，选择节点并打开开关。</li></ol><p>首次连接会要求添加 VPN 配置，允许即可。</p>", 3, 10),
  doc(7, "客户端配置", "Android：Clash Meta / Surfboard", "<ol><li>安装 Clash Meta for Android 或 Surfboard。</li><li>通过一键订阅导入，或在「配置」里新建订阅并粘贴链接。</li><li>选择节点，点启动。</li></ol><p>国产系统请在电池设置里允许应用后台运行，避免连接被系统清理。</p>", 3, 8),
  doc(8, "常见问题", "连不上怎么办？", "<p>按顺序排查：</p><ol><li>先在客户端<strong>更新订阅</strong>，再重新选择节点。</li><li>换一个节点试试；如果全部节点都超时，检查本机网络与系统时间。</li><li>在「我的订单」确认套餐没有到期，在仪表盘确认流量没有用完。</li><li>仍然不行，请提交工单并附上客户端名称与报错截图。</li></ol>", 3, 22),
  doc(9, "常见问题", "订阅更新失败", "<p>常见原因是订阅链接被改动或客户端版本过旧。请重新在仪表盘复制订阅链接，并把客户端升级到最新版本；Clash 系客户端导入时链接需带 <code>flag=clash</code>。</p>", 3, 21),
  doc(10, "常见问题", "如何重置订阅链接？", "<p>订阅链接泄露或想换新链接时，可以在账户设置里重置订阅信息。重置后旧链接立即失效，所有设备需要用新链接重新导入。</p>", 3, 15),
  doc(11, "常见问题", "速度慢怎么排查？", "<ul><li>先用「节点状态」挑选延迟较低的节点。</li><li>晚高峰可切换到负载较低的线路。</li><li>在「流量明细」查看是否有异常高的用量占满了带宽。</li><li>套餐有限速时，速度受套餐上限约束。</li></ul>", 3, 9),
  doc(12, "账户与支付", "如何续费或升级套餐", "<p>在「购买订阅」选择套餐和周期即可。同套餐续费会在当前到期日基础上顺延；购买不同套餐会排队，等当前套餐到期后自动生效，也可以在订单页选择「立即生效」。</p>", 3, 19),
  doc(13, "账户与支付", "支付后没有生效", "<p>支付渠道的通知可能有几分钟延迟：在订单页点「刷新状态」。超过 10 分钟仍未生效，请提交工单并附上订单号，我们会人工核对。</p>", 3, 13),
  doc(14, "账户与支付", "邀请与佣金规则", "<p>好友通过你的邀请码注册并完成支付后，你会获得订单金额一定比例的佣金，结算期后可以划转到账户余额，用于支付订单。</p>", 3, 7),
];
