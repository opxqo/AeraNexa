export const plans = [
  { id: "1", name: "标准订阅", traffic: "100 GB", speed: "300 Mbps", month: 18, quarter: 50, year: 180, type: "周期订阅", features: ["全球优质线路", "最多 3 台设备同时在线", "每月自动重置流量", "支持全平台客户端"] },
  { id: "2", name: "高级订阅", traffic: "300 GB", speed: "1000 Mbps", month: 35, quarter: 98, year: 350, type: "周期订阅", features: ["高级专线节点", "最多 5 台设备同时在线", "流媒体解锁", "工单优先响应"] },
  { id: "3", name: "轻量流量包", traffic: "200 GB", speed: "300 Mbps", month: 0, quarter: 0, year: 0, once: 58, type: "按流量", features: ["流量用完为止", "长期有效", "全部基础节点", "不限制使用设备"] },
];

export const orders = [
  { id: "ANX202609190001", plan: "标准订阅", period: "月付", amount: "¥18.00", status: "待支付", tone: "warning", time: "2026-09-19 10:32" },
  { id: "ANX202608190018", plan: "标准订阅", period: "月付", amount: "¥18.00", status: "已完成", tone: "success", time: "2026-08-19 09:18" },
  { id: "ANX202607190026", plan: "标准订阅", period: "月付", amount: "¥18.00", status: "已完成", tone: "success", time: "2026-07-19 09:20" },
];

export const nodes = [
  { name: "香港 01", tags: ["IEPL", "流媒体"], status: "在线", rate: "1.0x" },
  { name: "香港 02", tags: ["低延迟"], status: "在线", rate: "1.0x" },
  { name: "日本 01", tags: ["BGP", "Netflix"], status: "在线", rate: "1.0x" },
  { name: "新加坡 01", tags: ["专线"], status: "在线", rate: "1.5x" },
  { name: "美国 01", tags: ["原生 IP"], status: "维护", rate: "1.0x" },
];

export const trafficRows = [
  { time: "2026-09-19", up: "320.42 MB", down: "2.84 GB", rate: "1.0x", total: "3.15 GB" },
  { time: "2026-09-18", up: "486.18 MB", down: "4.12 GB", rate: "1.0x", total: "4.60 GB" },
  { time: "2026-09-17", up: "218.67 MB", down: "2.05 GB", rate: "1.5x", total: "3.40 GB" },
  { time: "2026-09-16", up: "552.31 MB", down: "5.36 GB", rate: "1.0x", total: "5.90 GB" },
];

export const tickets = [
  { id: "1024", subject: "Windows 客户端无法更新订阅", level: "中", status: "待回复", time: "2026-09-19 09:42" },
  { id: "1018", subject: "咨询流媒体节点使用方式", level: "低", status: "已回复", time: "2026-09-16 17:08" },
  { id: "1003", subject: "订单支付后未到账", level: "高", status: "已关闭", time: "2026-09-01 11:36" },
];

export const knowledgeGroups = [
  { title: "快速开始", articles: ["Windows 客户端使用教程", "macOS 客户端使用教程", "iOS 客户端使用教程", "Android 客户端使用教程"] },
  { title: "常见问题", articles: ["订阅无法更新怎么办？", "如何选择延迟更低的节点？", "流量与倍率是如何计算的？"] },
  { title: "账户与订阅", articles: ["如何续费或变更套餐？", "订阅信息泄露后如何重置？", "工单与售后服务说明"] },
];
