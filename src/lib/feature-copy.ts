// Copy for the feature blocks (home page and /demo/features) in both
// languages. Like home-copy.ts, the two entries share one type, so TypeScript
// flags any key missing from either. Brand, client, city and host names,
// strategy codes and protocol names stay as they are in both languages.

import type { HomeLocale } from "@/lib/home-copy";

type GroupCopy = { name: string; nodes: string };

export type FeatureCardCopy = { name: string; note: string; figure: string; unit: string; chips: string[]; cta: string; href: string };
type PlanTab = { name: string; tiles: { value: string; label: string }[] };

type FeatureCopy = {
  lang: string;
  sections: { stableTitle: string; stableLead: string; detailTitle: string; detailLead: string };
  unlock: {
    title: string;
    lead: string;
    groupsLabel: string;
    sample: string;
    groups: { ai: GroupCopy; media: GroupCopy; auto: GroupCopy };
    latency: string;
    received: string;
    unlocked: string;
    accelerated: string;
    // Request lines that carry words (the rest are plain HTTP lines).
    calls: Record<string, string>;
    chipIdle: string;
    chip: (service: string, city: string) => string;
    fine: string;
    marqueeLabel: string;
    servicesLabel: string;
    mapLabel: string;
  };
  bento: {
    feed: { title: string; body: string };
    account: { title: string; body: string };
    protocols: { title: string; body: string };
    status: { title: string; body: string };
    devices: { title: string; body: string };
    usage: { title: string; body: string };
    pullStatus: { queued: string; busy: string; done: string };
    pulled: (format: string) => string;
    checking: string;
    online: (count: number) => string;
    sample: string;
    latency: (ms: number) => string;
    load: (percent: number) => string;
    live: string;
    prompt: string;
    enter: string;
    myDevices: string;
    seats: (total: number) => string;
    remove: string;
    restore: string;
    usageTitle: string;
    usageLead: (total: number) => string;
    cycleUsed: (percent: number) => string;
    periods: { "24h": string; "7d": string; "30d": string };
    hourly: string;
    daily: string;
    average: (unit: string, value: string) => string;
    used: (period: string) => string;
    remaining: string;
    validity: string;
    days: string;
    periodsLabel: string;
  };
  tabs: {
    tablistLabel: string;
    tabs: { subscription: string; nodes: string; traffic: string };
    sample: string;
    subscription: { title: string; body: string; cards: FeatureCardCopy[]; steps: string[]; client: string; nodes: string; note: string };
    nodes: { title: string; body: string; cards: FeatureCardCopy[] };
    traffic: {
      title: string;
      body: string;
      idleWord: string;
      idleHours: string;
      idleNight: string;
      counted: string;
      notCounted: string;
      planTitle: string;
      planLead: string;
      samplePlan: string;
      planCta: string;
      planTabs: PlanTab[];
      resetTitle: string;
      resetLead: string;
      resetCta: string;
      resetTabs: PlanTab[];
    };
  };
  clients: {
    title: string;
    lead: string;
    tablistLabel: string;
    pause: string;
    resume: string;
    delivered: (format: string) => string;
    platforms: string;
    steps: Record<string, { lead: string; tail: string }>;
  };
};

export const featureCopy: Record<HomeLocale, FeatureCopy> = {
  zh: {
    lang: "zh-CN",
    sections: {
      stableTitle: "为稳定连接而生",
      stableLead: "从订阅到节点，每一处都替你想好了。",
      detailTitle: "每个细节，都替你想好了",
      detailLead: "订阅、节点、流量，分别是怎么运作的。",
    },
    unlock: {
      title: "顶尖 AI 与国际流媒体，一个订阅全部解锁",
      lead: "请求按类型进入专属节点组，再由最合适的海外节点直连，ChatGPT、Claude、Netflix、YouTube 等开箱即用。",
      groupsLabel: "节点组",
      sample: "示例数据",
      groups: {
        ai: { name: "AI 专线", nodes: "8 个节点" },
        media: { name: "流媒体解锁", nodes: "6 个节点" },
        auto: { name: "自动选择", nodes: "全部节点" },
      },
      latency: "延迟",
      received: "已接入",
      unlocked: "200 · 已解锁",
      accelerated: "200 · 已加速",
      calls: { Gemini: "POST /app · 流式响应", Spotify: "GET /track · 高音质" },
      chipIdle: "请求按类型分组直连",
      chip: (service, city) => `${service} · 经 ${city} 节点直连`,
      fine: "节点可用性以实测为准，平台政策变动时会及时调整。",
      marqueeLabel: "已实测解锁的平台",
      servicesLabel: "支持解锁的平台",
      mapLabel: "点阵地图随滚动卷成地球，各平台请求经节点组分发到海外节点",
    },
    bento: {
      feed: { title: "一条订阅，所有客户端", body: "自动识别客户端：Clash、Mihomo、Stash 下发 Clash 配置，其余客户端下发 Base64，不用手动切换格式。" },
      account: { title: "一个账户，管好一切", body: "节点、订阅、流量和续费都在同一个用户中心里，买完即用，随时查看。" },
      protocols: { title: "主流协议，开箱即用", body: "支持 VLESS + REALITY、VMess 与 Trojan，节点配置自动同步到你的订阅。" },
      status: { title: "节点状态实时可见", body: "状态页实时推送每个节点的在线情况与负载，连接前就知道哪条线路最空闲。" },
      devices: { title: "设备名额，自己掌控", body: "按套餐限制同时使用的设备数；换了手机，在设备页一键移除旧设备即可腾出名额。" },
      usage: { title: "用量一目了然", body: "流量按节点采集汇总，已用、剩余和到期时间随时可查。" },
      pullStatus: { queued: "识别中", busy: "生成中", done: "已下发" },
      pulled: (format) => `订阅已拉取 · 下发 ${format}`,
      checking: "正在检测节点状态…",
      online: (count) => `${count} 个节点在线`,
      sample: "示例数据",
      latency: (ms) => `延迟 ${ms}ms`,
      load: (percent) => `负载 ${percent}%`,
      live: "实时推送中",
      prompt: "打开状态页",
      enter: "回车 ↵",
      myDevices: "我的设备",
      seats: (total) => ` / ${total} 个名额`,
      remove: "移除",
      restore: "恢复演示",
      usageTitle: "流量用量",
      usageLead: (total) => `本周期 ${total} GB · 按节点实时汇总`,
      cycleUsed: (percent) => `本周期已用 ${percent}%`,
      periods: { "24h": "24 小时", "7d": "7 天", "30d": "30 天" },
      hourly: "时",
      daily: "日",
      average: (unit, value) => `${unit}均 ${value} GB`,
      used: (period) => `已用 · ${period}`,
      remaining: "剩余",
      validity: "有效期",
      days: "天",
      periodsLabel: "统计周期",
    },
    tabs: {
      tablistLabel: "功能",
      tabs: { subscription: "订阅", nodes: "节点", traffic: "流量" },
      sample: "示例数据",
      subscription: {
        title: "一条订阅，自动适配",
        body: "客户端拉取订阅时，按客户端类型自动下发对应格式。节点有变动，客户端刷新订阅即可同步，不用重新导入。",
        cards: [
          { name: "Clash 系客户端", note: "自动下发 Clash 配置", figure: "YAML", unit: "格式", chips: ["Clash Verge", "Mihomo", "Stash", "Nyanpasu"], cta: "查看教程", href: "/knowledge" },
          { name: "通用客户端", note: "其余客户端", figure: "Base64", unit: "格式", chips: ["Shadowrocket", "v2rayN"], cta: "查看教程", href: "/knowledge" },
          { name: "设备登记", note: "按设备计入名额", figure: "HWID", unit: "识别", chips: ["设备名额", "一键移除"], cta: "管理设备", href: "/login" },
          { name: "链接重置", note: "链接泄露也不怕", figure: "1 键", unit: "重置", chips: ["生成新链接", "旧链接失效"], cta: "了解更多", href: "/knowledge" },
        ],
        steps: ["识别客户端", "Clash 配置", "Base64", "设备登记", "当前节点"],
        client: "你的客户端",
        nodes: "可用节点",
        note: "每次拉取都按当前节点生成，改动自动生效",
      },
      nodes: {
        title: "节点状态实时可见",
        body: "状态页实时推送每个节点的在线情况、负载与流量。支持 VLESS + REALITY、VMess、Trojan，节点变更会自动同步到订阅。",
        cards: [
          { name: "协议", note: "主流协议全覆盖", figure: "3", unit: "种协议", chips: ["VLESS + REALITY", "VMess", "Trojan"], cta: "查看节点", href: "/login" },
          { name: "实时状态", note: "状态页实时推送", figure: "实时", unit: "推送", chips: ["在线情况", "负载", "流量"], cta: "查看状态", href: "/login" },
          { name: "设备名额", note: "按套餐上限", figure: "5", unit: "台（示例）", chips: ["设备列表", "一键移除"], cta: "管理设备", href: "/login" },
        ],
      },
      traffic: {
        title: "只算真正传输的流量",
        body: "流量按每个节点实际上报的数据汇总。连接空闲、手机待机都不消耗流量，只有看视频、下载这类传输才会计入。",
        idleWord: "不计流量",
        idleHours: "空闲 3 小时",
        idleNight: "待机过夜",
        counted: "计入流量",
        notCounted: "不计流量",
        planTitle: "套餐流量",
        planLead: "按周期购买",
        samplePlan: "示例套餐",
        planCta: "查看套餐",
        planTabs: [
          { name: "月付", tiles: [{ value: "100 GB", label: "流量额度" }, { value: "3 台", label: "设备名额" }, { value: "30 天", label: "有效期" }, { value: "全部", label: "可用节点" }] },
          { name: "季付", tiles: [{ value: "100 GB", label: "流量额度" }, { value: "3 台", label: "设备名额" }, { value: "90 天", label: "有效期" }, { value: "全部", label: "可用节点" }] },
          { name: "年付", tiles: [{ value: "100 GB", label: "流量额度" }, { value: "3 台", label: "设备名额" }, { value: "365 天", label: "有效期" }, { value: "全部", label: "可用节点" }] },
        ],
        resetTitle: "流量重置",
        resetLead: "用完不必等到下个周期",
        resetCta: "去重置",
        resetTabs: [
          { name: "怎么算", tiles: [{ value: "归零", label: "支付后已用流量" }, { value: "月付价 × 比例", label: "重置价格" }] },
          { name: "怎么买", tiles: [{ value: "仪表盘", label: "点「重置流量」" }, { value: "不变", label: "到期时间" }] },
        ],
      },
    },
    clients: {
      title: "主流客户端，一键导入",
      lead: "复制订阅链接，粘贴到常用客户端即可使用。",
      tablistLabel: "客户端",
      pause: "暂停自动切换",
      resume: "继续自动切换",
      delivered: (format) => `下发 ${format}`,
      platforms: "支持的平台",
      steps: {
        "Clash Verge": { lead: "复制订阅链接，在「订阅」页粘贴并导入，客户端会自动拿到 Clash 配置，", tail: "节点即刻可用。" },
        "Clash Meta for Android": { lead: "在配置页新建订阅并粘贴链接，订阅会按 Clash 格式下发，", tail: "刷新即可同步最新节点。" },
        Shadowrocket: { lead: "点右上角加号，类型选「Subscribe」并粘贴链接，订阅会以 Base64 下发，", tail: "下拉刷新就能更新。" },
        Stash: { lead: "在配置里添加「从 URL 下载」，粘贴订阅链接即可，Stash 属于 Clash 系，", tail: "自动获得 Clash 配置。" },
        v2rayN: { lead: "打开「订阅分组」添加订阅地址并更新，订阅内容以 Base64 下发，", tail: "更新后节点列表自动刷新。" },
      },
    },
  },
  en: {
    lang: "en",
    sections: {
      stableTitle: "Built for a steady connection",
      stableLead: "From the subscription to the node, it's all taken care of.",
      detailTitle: "Every detail, thought through",
      detailLead: "How subscriptions, nodes and traffic each work.",
    },
    unlock: {
      title: "Top AI tools and global streaming, all unlocked with one subscription",
      lead: "Each request goes to a node group made for its kind, then straight out through the best node abroad. ChatGPT, Claude, Netflix, YouTube and more just work.",
      groupsLabel: "Node groups",
      sample: "Sample data",
      groups: {
        ai: { name: "AI routes", nodes: "8 nodes" },
        media: { name: "Streaming", nodes: "6 nodes" },
        auto: { name: "Auto select", nodes: "All nodes" },
      },
      latency: "latency",
      received: "Received",
      unlocked: "200 · Unlocked",
      accelerated: "200 · Accelerated",
      calls: { Gemini: "POST /app · streaming", Spotify: "GET /track · high quality" },
      chipIdle: "Requests routed by type",
      chip: (service, city) => `${service} · direct via ${city}`,
      fine: "Availability reflects our own tests; we adjust when platforms change their rules.",
      marqueeLabel: "Platforms tested and unlocked",
      servicesLabel: "Platforms we unlock",
      mapLabel: "The dot map curls into a globe as you scroll; requests from each platform pass through node groups to nodes abroad",
    },
    bento: {
      feed: { title: "One subscription, every client", body: "Clients are detected for you: Clash, Mihomo and Stash get a Clash config, everything else gets Base64. No switching formats by hand." },
      account: { title: "One account for everything", body: "Nodes, subscription, traffic and renewals all live in one dashboard. Ready as soon as you buy, there whenever you look." },
      protocols: { title: "Mainstream protocols, ready to go", body: "VLESS + REALITY, VMess and Trojan, with node settings synced to your subscription automatically." },
      status: { title: "Live node status", body: "The status page streams every node's uptime and load, so you know the quietest route before you connect." },
      devices: { title: "Your devices, your seats", body: "Your plan sets how many devices can connect at once. New phone? Remove the old one on the devices page to free its seat." },
      usage: { title: "Usage at a glance", body: "Traffic is collected per node and added up, so used, remaining and expiry are always a click away." },
      pullStatus: { queued: "Detecting", busy: "Building", done: "Delivered" },
      pulled: (format) => `Subscription pulled · ${format}`,
      checking: "Checking node status…",
      online: (count) => `${count} nodes online`,
      sample: "Sample data",
      latency: (ms) => `${ms}ms latency`,
      load: (percent) => `${percent}% load`,
      live: "Streaming live",
      prompt: "open status page",
      enter: "Enter ↵",
      myDevices: "My devices",
      seats: (total) => ` / ${total} seats`,
      remove: "Remove",
      restore: "Reset demo",
      usageTitle: "Traffic usage",
      usageLead: (total) => `${total} GB this cycle · live per-node totals`,
      cycleUsed: (percent) => `${percent}% used this cycle`,
      periods: { "24h": "24 hours", "7d": "7 days", "30d": "30 days" },
      hourly: "hour",
      daily: "day",
      average: (unit, value) => `Avg ${value} GB / ${unit}`,
      used: (period) => `Used · ${period}`,
      remaining: "Remaining",
      validity: "Valid for",
      days: "days",
      periodsLabel: "Period",
    },
    tabs: {
      tablistLabel: "Features",
      tabs: { subscription: "Subscription", nodes: "Nodes", traffic: "Traffic" },
      sample: "Sample data",
      subscription: {
        title: "One subscription that adapts",
        body: "When a client pulls the subscription, it gets the format made for it. When nodes change, a refresh in the client syncs them; there is nothing to import again.",
        cards: [
          { name: "Clash-family clients", note: "Get a Clash config", figure: "YAML", unit: "format", chips: ["Clash Verge", "Mihomo", "Stash", "Nyanpasu"], cta: "Read the guide", href: "/knowledge" },
          { name: "Other clients", note: "Everything else", figure: "Base64", unit: "format", chips: ["Shadowrocket", "v2rayN"], cta: "Read the guide", href: "/knowledge" },
          { name: "Device check-in", note: "Each device takes a seat", figure: "HWID", unit: "ID", chips: ["Device seats", "One-click remove"], cta: "Manage devices", href: "/login" },
          { name: "Link reset", note: "Leaked link? No problem", figure: "1 click", unit: "reset", chips: ["New link", "Old link revoked"], cta: "Learn more", href: "/knowledge" },
        ],
        steps: ["Detect client", "Clash config", "Base64", "Device check-in", "Current nodes"],
        client: "Your client",
        nodes: "Available nodes",
        note: "Every pull is built from the current nodes, so changes apply on their own",
      },
      nodes: {
        title: "Live node status",
        body: "The status page streams each node's uptime, load and traffic. VLESS + REALITY, VMess and Trojan are supported, and node changes sync to your subscription automatically.",
        cards: [
          { name: "Protocols", note: "The mainstream ones, covered", figure: "3", unit: "protocols", chips: ["VLESS + REALITY", "VMess", "Trojan"], cta: "View nodes", href: "/login" },
          { name: "Live status", note: "Streamed to the status page", figure: "Live", unit: "updates", chips: ["Uptime", "Load", "Traffic"], cta: "View status", href: "/login" },
          { name: "Device seats", note: "Set by your plan", figure: "5", unit: "devices (sample)", chips: ["Device list", "One-click remove"], cta: "Manage devices", href: "/login" },
        ],
      },
      traffic: {
        title: "Only real transfers count",
        body: "Traffic is added up from what each node reports. An idle connection or a phone on standby uses nothing; only transfers like video and downloads count.",
        idleWord: "Not counted",
        idleHours: "Idle 3 hours",
        idleNight: "Standby overnight",
        counted: "Counted",
        notCounted: "Not counted",
        planTitle: "Plan traffic",
        planLead: "Bought per billing cycle",
        samplePlan: "Sample plan",
        planCta: "View plans",
        planTabs: [
          { name: "Monthly", tiles: [{ value: "100 GB", label: "traffic" }, { value: "3", label: "device seats" }, { value: "30 days", label: "validity" }, { value: "All", label: "nodes" }] },
          { name: "Quarterly", tiles: [{ value: "100 GB", label: "traffic" }, { value: "3", label: "device seats" }, { value: "90 days", label: "validity" }, { value: "All", label: "nodes" }] },
          { name: "Yearly", tiles: [{ value: "100 GB", label: "traffic" }, { value: "3", label: "device seats" }, { value: "365 days", label: "validity" }, { value: "All", label: "nodes" }] },
        ],
        resetTitle: "Traffic reset",
        resetLead: "Ran out? No need to wait for the next cycle",
        resetCta: "Reset now",
        resetTabs: [
          { name: "Pricing", tiles: [{ value: "Zeroed", label: "used traffic, once paid" }, { value: "Monthly × rate", label: "reset price" }] },
          { name: "How to", tiles: [{ value: "Dashboard", label: "click “Reset traffic”" }, { value: "Unchanged", label: "expiry date" }] },
        ],
      },
    },
    clients: {
      title: "Popular clients, one-tap import",
      lead: "Copy your subscription link and paste it into the client you already use.",
      tablistLabel: "Clients",
      pause: "Pause auto-rotation",
      resume: "Resume auto-rotation",
      delivered: (format) => `gets ${format}`,
      platforms: "Supported platforms",
      steps: {
        "Clash Verge": { lead: "Copy the subscription link and import it on the Profiles page; the client picks up a Clash config, ", tail: "and the nodes are ready." },
        "Clash Meta for Android": { lead: "Create a new profile and paste the link; the subscription comes in Clash format, ", tail: "and a refresh syncs the latest nodes." },
        Shadowrocket: { lead: "Tap + in the top right, choose “Subscribe” and paste the link; the subscription comes as Base64, ", tail: "and pull to refresh keeps it current." },
        Stash: { lead: "Add a profile with “Download from URL” and paste the link; Stash is a Clash client, ", tail: "so it gets a Clash config." },
        v2rayN: { lead: "Open Subscription group, add the address and update; the subscription comes as Base64, ", tail: "and the node list refreshes itself." },
      },
    },
  },
};
