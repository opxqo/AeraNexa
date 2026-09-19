/**
 * 系统设置项定义与校验（纯函数、零依赖，可被测试直接 import）。
 *
 * 只收「可以在运行时由管理员调整」的配置。数据库连接、会话密钥、各类加密主密钥与哈希 pepper
 * 必须留在环境变量：要么是读取设置本身的前提，要么放进数据库会让加密 / 哈希失去意义。
 *
 * 取值优先级：后台保存的值 → 同名环境变量（兼容既有部署）→ 默认值。
 */

export type SettingKind = "url" | "secret" | "int" | "number";

export type SettingGroup = "节点" | "订阅" | "佣金" | "Worker";

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
};

export const SETTING_DEFS: readonly SettingDef[] = [
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
    key: "node.traffic_secret",
    group: "节点",
    label: "节点流量上报密钥",
    description: "非 3x-ui 节点调用 /api/node/traffic 推送流量时使用的共享密钥。加密存储。",
    kind: "secret",
    env: "NODE_TRAFFIC_SECRET",
    defaultValue: "",
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
    case "int":
    case "number": {
      if (!/^-?\d+(\.\d+)?$/.test(value)) return { ok: false, error: `${def.label}需为数字` };
      const parsed = Number(value);
      if (def.kind === "int" && !Number.isInteger(parsed)) return { ok: false, error: `${def.label}需为整数` };
      if (def.min !== undefined && parsed < def.min) return { ok: false, error: `${def.label}不能小于 ${def.min}${def.unit ?? ""}` };
      if (def.max !== undefined && parsed > def.max) return { ok: false, error: `${def.label}不能大于 ${def.max}${def.unit ?? ""}` };
      return { ok: true, value: String(parsed) };
    }
  }
}
