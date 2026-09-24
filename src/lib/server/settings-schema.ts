/**
 * 系统设置项定义与校验（纯函数、零依赖，可被测试直接 import）。
 *
 * 只收「可以在运行时由管理员调整」的配置。数据库连接、会话密钥、各类加密主密钥与哈希 pepper
 * 必须留在环境变量：要么是读取设置本身的前提，要么放进数据库会让加密 / 哈希失去意义。
 *
 * 取值优先级：后台保存的值 → 同名环境变量（兼容既有部署）→ 默认值。
 */

export type SettingKind = "url" | "secret" | "int" | "number" | "select" | "text";

export type SettingGroup = "节点" | "监控" | "订阅" | "佣金" | "订单" | "支付" | "Worker" | "Telegram";

export type SettingDef = {
  key: string;
  group: SettingGroup;
  label: string;
  description: string;
  kind: SettingKind;
  /** 未在后台设置时回退读取的环境变量。 */
  env?: string;
  defaultValue: string;
  min?: number;
  max?: number;
  unit?: string;
  options?: readonly { value: string; label: string }[];
};

export const SETTING_DEFS: readonly SettingDef[] = [
  { key: "telegram.enabled", group: "Telegram", label: "AeraNexaBot 服务", description: "启用后才接收更新及投递用户通知。", kind: "select", env: "TELEGRAM_BOT_ENABLED", defaultValue: "false", options: [{ value: "false", label: "停用" }, { value: "true", label: "启用" }] },
  { key: "telegram.mode", group: "Telegram", label: "运行方式", description: "长轮询适合本地与单机；Webhook 必须使用公网 HTTPS 地址。", kind: "select", env: "TELEGRAM_BOT_MODE", defaultValue: "polling", options: [{ value: "polling", label: "长轮询" }, { value: "webhook", label: "Webhook" }] },
  { key: "telegram.username", group: "Telegram", label: "Bot 用户名", description: "不带 @，用于个人中心显示绑定入口。", kind: "text", env: "TELEGRAM_BOT_USERNAME", defaultValue: "" },
  { key: "telegram.token", group: "Telegram", label: "Bot Token", description: "由 BotFather 创建；加密保存且不会回显。", kind: "secret", env: "TELEGRAM_BOT_TOKEN", defaultValue: "" },
  { key: "telegram.webhook_url", group: "Telegram", label: "Webhook 公网 HTTPS 地址", description: "例如 https://app.example.com/api/telegram/webhook，仅 Webhook 模式使用。", kind: "url", env: "TELEGRAM_WEBHOOK_URL", defaultValue: "" },
  { key: "telegram.webhook_secret", group: "Telegram", label: "Webhook 校验密钥", description: "Telegram 回调 Header 校验用；留空由系统生成并加密保存。", kind: "secret", env: "TELEGRAM_WEBHOOK_SECRET", defaultValue: "" },
  {
    key: "order.reset_traffic_percent",
    group: "订单",
    label: "流量重置价格比例",
    description: "流量重置价格 = 用户当前套餐的月付价 × 该比例；套餐没有月付价时按最短周期换算成每月价格。",
    kind: "int",
    defaultValue: "75",
    min: 0,
    max: 500,
    unit: "%",
  },
  {
    key: "payment.epay.gateway_url",
    group: "支付",
    label: "易支付网关地址",
    description: "渠道提供的接口域名，例如 https://normal.33zn.com；下单跳转其 submit.php。",
    kind: "url",
    env: "EPAY_GATEWAY_URL",
    defaultValue: "",
  },
  {
    key: "payment.epay.pid",
    group: "支付",
    label: "易支付商户号（PID）",
    description: "开户时分配的用户 ID；商户密钥在「支付渠道」里填到回调签名密钥，加密保存。",
    kind: "text",
    env: "EPAY_PID",
    defaultValue: "",
  },
  {
    key: "panel.base_url",
    group: "节点",
    label: "3x-ui 面板地址",
    description: "包含面板路径，例如 https://panel.example.com:2053/secret-path/。",
    kind: "url",
    env: "PANEL_BASE_URL",
    defaultValue: "",
  },
  {
    key: "panel.api_token",
    group: "节点",
    label: "3x-ui API Token",
    description: "在 3x-ui「设置 → 安全 → API Token」创建，能选 node-sync 范围就用 node-sync。加密存储，保存后不再显示。",
    kind: "secret",
    env: "PANEL_API_TOKEN",
    defaultValue: "",
  },
  {
    key: "panel.timeout_ms",
    group: "节点",
    label: "3x-ui 请求超时",
    description: "单次请求 3x-ui 的超时时间。",
    kind: "int",
    env: "PANEL_TIMEOUT_MS",
    defaultValue: "10000",
    min: 1000,
    max: 60000,
    unit: "毫秒",
  },
  {
    key: "panel.vless_flow",
    group: "节点",
    label: "VLESS 流控（Vision）",
    description:
      "开启后为 VLESS + TCP（TLS / Reality）入站下发 xtls-rprx-vision，订阅链接同步带上 flow；在 3x-ui 里勾选了「禁用流控」的入站除外。切换后用户需更新订阅，旧链接会被拒绝连接。",
    kind: "select",
    env: "PANEL_VLESS_FLOW",
    defaultValue: "none",
    options: [
      { value: "none", label: "关闭" },
      { value: "xtls-rprx-vision", label: "xtls-rprx-vision" },
    ],
  },
  {
    key: "node.traffic_secret",
    group: "节点",
    label: "节点流量上报密钥",
    description: "非 3x-ui 节点调用 /api/node/traffic 推送流量时使用的共享密钥。加密存储。",
    kind: "secret",
    env: "NODE_TRAFFIC_SECRET",
    defaultValue: "",
  },
  {
    key: "monitor.base_url",
    group: "监控",
    label: "CF-Server-Monitor 地址",
    description: "CFSM 探针监控系统的部署地址，例如 https://monitor.example.com。填写后节点状态页可展示其采集的负载、流量与延迟指标。",
    kind: "url",
    env: "CFSM_BASE_URL",
    defaultValue: "",
  },
  {
    key: "monitor.auth_mode",
    group: "监控",
    label: "监控对接模式",
    description: "自动：先探测对方是否公开仪表盘，公开则免密钥直调，否则用管理员账号登录换取 JWT；公开免密钥：强制直调；管理员 JWT：强制账号密码登录（对方 is_public=false 或需要 24 小时以上历史时选它）。",
    kind: "select",
    env: "CFSM_AUTH_MODE",
    defaultValue: "auto",
    options: [
      { value: "auto", label: "自动探测" },
      { value: "public", label: "公开免密钥" },
      { value: "jwt", label: "管理员 JWT" },
    ],
  },
  {
    key: "monitor.username",
    group: "监控",
    label: "监控管理员账号",
    description: "CF-Server-Monitor 的管理员用户名。对方非公开仪表盘（或选择管理员 JWT 模式）时必填。",
    kind: "text",
    env: "CFSM_USERNAME",
    defaultValue: "",
  },
  {
    key: "monitor.password",
    group: "监控",
    label: "监控管理员密码",
    description: "用于登录 CF-Server-Monitor 换取只读 JWT（7 天有效期，系统自动缓存与续期）。加密存储，保存后不再显示。",
    kind: "secret",
    env: "CFSM_PASSWORD",
    defaultValue: "",
  },
  {
    key: "monitor.timeout_ms",
    group: "监控",
    label: "监控请求超时",
    description: "单次请求 CF-Server-Monitor 的超时时间。",
    kind: "int",
    env: "CFSM_TIMEOUT_MS",
    defaultValue: "8000",
    min: 1000,
    max: 60000,
    unit: "毫秒",
  },
  {
    key: "subscribe.base_url",
    group: "订阅",
    label: "订阅链接域名",
    description: "用户订阅链接的前缀，例如 https://sub.example.com。修改后新生成的链接立即生效，已导入的旧链接需要旧域名仍可访问。",
    kind: "url",
    env: "SUBSCRIBE_BASE_URL",
    defaultValue: "http://localhost:3000",
  },
  {
    key: "subscribe.clash_provider",
    group: "订阅",
    label: "Clash / Mihomo 规则来源",
    description: "AeraNexa 由本系统生成规则；3x-ui 则沿用 3x-ui「订阅」中配置的 Clash/Mihomo 规则。两种方式都通过 AeraNexa 订阅链接校验用户权限。",
    kind: "select",
    env: "SUBSCRIBE_CLASH_PROVIDER",
    defaultValue: "aeranexa",
    options: [
      { value: "aeranexa", label: "AeraNexa" },
      { value: "3x-ui", label: "3x-ui" },
    ],
  },
  {
    key: "subscribe.panel_clash_url",
    group: "订阅",
    label: "3x-ui Clash/Mihomo 订阅地址",
    description: "仅选择 3x-ui 规则来源时使用。填写 3x-ui「订阅 → Clash URI」中以 / 结尾的完整地址；留空时尝试面板地址下的 /mihomo/ 兼容路径。",
    kind: "url",
    env: "PANEL_CLASH_SUBSCRIBE_URL",
    defaultValue: "",
  },
  {
    key: "commission.rate_percent",
    group: "佣金",
    label: "邀请佣金比例",
    description: "被邀请人订单实付金额的百分比，0 表示关闭返佣。只影响之后产生的佣金。",
    kind: "number",
    env: "COMMISSION_RATE_PERCENT",
    defaultValue: "0",
    min: 0,
    max: 100,
    unit: "%",
  },
  {
    key: "commission.available_after_days",
    group: "佣金",
    label: "佣金冷静期",
    description: "佣金产生后多少天才可提现，期间订单退款会作废佣金。只影响之后产生的佣金。",
    kind: "int",
    env: "COMMISSION_AVAILABLE_AFTER_DAYS",
    defaultValue: "0",
    min: 0,
    max: 365,
    unit: "天",
  },
  {
    key: "worker.event_interval_ms",
    group: "Worker",
    label: "事件同步间隔",
    description: "worker 处理「待同步」用户的轮询间隔，决定开通 / 停用生效的快慢。",
    kind: "int",
    env: "WORKER_EVENT_INTERVAL_MS",
    defaultValue: "5000",
    min: 1000,
    max: 600000,
    unit: "毫秒",
  },
  {
    key: "worker.traffic_interval_ms",
    group: "Worker",
    label: "流量采集间隔",
    description: "从 3x-ui 读取流量计数的间隔；也是超额到停用的最大延迟。",
    kind: "int",
    env: "WORKER_TRAFFIC_INTERVAL_MS",
    defaultValue: "60000",
    min: 5000,
    max: 3600000,
    unit: "毫秒",
  },
  {
    key: "worker.reconcile_interval_ms",
    group: "Worker",
    label: "全量对账间隔",
    description: "兜底修正到期、漏同步与 3x-ui 中的手工改动。",
    kind: "int",
    env: "WORKER_RECONCILE_INTERVAL_MS",
    defaultValue: "60000",
    min: 10000,
    max: 3600000,
    unit: "毫秒",
  },
  {
    key: "worker.import_interval_ms",
    group: "Worker",
    label: "入站导入间隔",
    description: "自动从 3x-ui 同步入站变化的间隔。",
    kind: "int",
    env: "WORKER_IMPORT_INTERVAL_MS",
    defaultValue: "600000",
    min: 60000,
    max: 86400000,
    unit: "毫秒",
  },
];

export type SettingKey = (typeof SETTING_DEFS)[number]["key"];

export function findSettingDef(key: string): SettingDef | undefined {
  return SETTING_DEFS.find((def) => def.key === key);
}

export type NormalizeResult = { ok: true; value: string } | { ok: false; error: string };

/**
 * 校验并规整管理员输入。空字符串的含义由调用方决定（清除后台值 / 保留密钥），这里不处理。
 */
export function normalizeSettingValue(def: SettingDef, raw: string): NormalizeResult {
  const value = raw.trim();
  switch (def.kind) {
    case "url": {
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        return { ok: false, error: `${def.label}不是有效的网址` };
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, error: `${def.label}只支持 http 或 https` };
      }
      if (parsed.search || parsed.hash) return { ok: false, error: `${def.label}不能包含 ? 或 # 部分` };
      return { ok: true, value: parsed.href };
    }
    case "secret":
      if (value.length < 8) return { ok: false, error: `${def.label}至少 8 个字符` };
      if (value.length > 512) return { ok: false, error: `${def.label}过长` };
      if (/\s/.test(value)) return { ok: false, error: `${def.label}不能包含空白字符` };
      return { ok: true, value };
    case "text":
      if (value.length > 255) return { ok: false, error: `${def.label}过长` };
      if (/[\u0000-\u001f\u007f]/.test(value)) return { ok: false, error: `${def.label}包含不可用字符` };
      return { ok: true, value };
    case "int":
    case "number": {
      if (!/^-?\d+(\.\d+)?$/.test(value)) return { ok: false, error: `${def.label}需为数字` };
      const parsed = Number(value);
      if (def.kind === "int" && !Number.isInteger(parsed)) return { ok: false, error: `${def.label}需为整数` };
      if (def.min !== undefined && parsed < def.min) return { ok: false, error: `${def.label}不能小于 ${def.min}${def.unit ?? ""}` };
      if (def.max !== undefined && parsed > def.max) return { ok: false, error: `${def.label}不能大于 ${def.max}${def.unit ?? ""}` };
      return { ok: true, value: String(parsed) };
    }
    case "select": {
      if (def.options?.some((option) => option.value === value)) return { ok: true, value };
      return { ok: false, error: `${def.label}选项不正确` };
    }
  }
}
