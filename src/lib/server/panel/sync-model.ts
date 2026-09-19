/**
 * 同步的纯函数部分：期望状态、实际状态、差异（docs/node-domain-design.md §4.1 / §4.3）。
 * 零依赖，可被测试直接 import；数据库与 3x-ui 调用在 ./reconcile.ts。
 */

/** 第一版参与分配的协议：凭据都能由用户 UUID 直接表达。 */
export const SYNC_PROTOCOLS: ReadonlySet<string> = new Set(["vless", "vmess", "trojan"]);

/** 节点域管理的客户端 email 命名空间。其他 email（管理员手工建的）一律不碰。 */
export const MANAGED_EMAIL = /^u(\d+)$/;

/** 下发给 3x-ui 的客户端对象（字段名对齐 3x-ui model.Client）。 */
export type PanelClientPayload = {
  email: string;
  id: string;
  password: string;
  subId: string;
  enable: boolean;
  expiryTime: number;
  totalGB: number;
  limitIp: number;
  tgId: number;
  flow: string;
  comment: string;
};

export type DesiredClient = {
  userId: number;
  client: PanelClientPayload;
  inboundIds: number[];
};

export type ActualClient = {
  email: string;
  id: string;
  subId: string;
  enable: boolean;
  expiryTime: number;
  totalGB: number;
  limitIp: number;
  comment: string;
  inboundIds: number[];
};

export type PanelOp =
  | { type: "add"; email: string; client: PanelClientPayload; inboundIds: number[] }
  | { type: "update"; email: string; client: PanelClientPayload }
  | { type: "detach"; email: string; inboundIds: number[] }
  | { type: "delete"; email: string };

export type UserEntitlement = {
  userId: number;
  /** 仅写进 3x-ui 备注供管理员辨认；客户端标识仍是 u{userId}，不随改邮箱变化。 */
  email: string;
  uuid: string;
  isActive: boolean;
  planId: number | null;
  /** 秒级时间戳；null 表示一次性套餐（永久）。 */
  expiredAt: number | null;
  transferEnable: number;
  usedBytes: number;
  subId: string;
  /** 设备数上限：用户覆盖优先于套餐，0 表示不限。下发为 3x-ui limitIp（同时在线源 IP 数）。 */
  deviceLimit: number;
  /** 该用户套餐可用的入站 ID（已按权限组、节点启用、协议过滤）。 */
  inboundIds: number[];
};

export function isEligible(user: UserEntitlement, nowSeconds: number): boolean {
  return (
    user.isActive &&
    user.planId !== null &&
    (user.expiredAt === null || user.expiredAt > nowSeconds) &&
    user.transferEnable > 0 &&
    user.usedBytes < user.transferEnable
  );
}

/**
 * 期望状态。返回 null 表示「3x-ui 中不应存在该客户端」（没有套餐或没有可用节点）。
 * 到期 / 超额 / 封禁只是 enable=false 并保留挂载：续费后一次 update 即可恢复。
 */
export function computeDesiredClient(user: UserEntitlement, nowSeconds: number): DesiredClient | null {
  if (user.planId === null || user.inboundIds.length === 0) return null;
  return {
    userId: user.userId,
    inboundIds: [...new Set(user.inboundIds)].sort((a, b) => a - b),
    client: {
      email: `u${user.userId}`,
      id: user.uuid,
      // Trojan 用 password；VLESS / VMess 用 id。同一个 UUID，用户之间不共用。
      password: user.uuid,
      subId: user.subId,
      enable: isEligible(user, nowSeconds),
      expiryTime: user.expiredAt === null ? 0 : user.expiredAt * 1000,
      // 额度由 AeraNexa 判定，3x-ui 侧不限量，避免两套计数口径打架。
      totalGB: 0,
      limitIp: Math.max(0, Math.floor(user.deviceLimit) || 0),
      tgId: 0,
      flow: "",
      // 备注只在 3x-ui 面板里给管理员看，不会进入订阅或节点名。
      comment: user.email ? `AeraNexa · ${user.email}` : "AeraNexa",
    },
  };
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asJsonObject(value: unknown): JsonObject {
  if (isObject(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (isObject(parsed)) return parsed;
    } catch {
      // 忽略：按空对象处理
    }
  }
  return {};
}

/**
 * 从 `inbounds/list` 汇总出每个受管客户端的实际状态。
 * 同一 email 挂在多个入站上时，凭据与开关以第一次出现为准（3x-ui 保证它们一致）。
 */
export function collectActualClients(rawInbounds: unknown[]): Map<string, ActualClient> {
  const clients = new Map<string, ActualClient>();
  for (const raw of rawInbounds) {
    if (!isObject(raw)) continue;
    const inboundId = Number(raw.id);
    if (!Number.isInteger(inboundId) || inboundId <= 0) continue;
    const list = asJsonObject(raw.settings).clients;
    if (!Array.isArray(list)) continue;

    for (const item of list) {
      if (!isObject(item)) continue;
      const email = String(item.email ?? "");
      if (!MANAGED_EMAIL.test(email)) continue;
      const existing = clients.get(email);
      if (existing) {
        if (!existing.inboundIds.includes(inboundId)) existing.inboundIds.push(inboundId);
        continue;
      }
      clients.set(email, {
        email,
        id: String(item.id ?? item.password ?? ""),
        subId: String(item.subId ?? ""),
        enable: item.enable !== false,
        expiryTime: Number(item.expiryTime ?? 0) || 0,
        totalGB: Number(item.totalGB ?? 0) || 0,
        limitIp: Number(item.limitIp ?? 0) || 0,
        comment: String(item.comment ?? ""),
        inboundIds: [inboundId],
      });
    }
  }
  for (const client of clients.values()) client.inboundIds.sort((a, b) => a - b);
  return clients;
}

function fieldsDiffer(desired: PanelClientPayload, actual: ActualClient): boolean {
  return (
    desired.id !== actual.id ||
    desired.subId !== actual.subId ||
    desired.enable !== actual.enable ||
    desired.expiryTime !== actual.expiryTime ||
    desired.totalGB !== actual.totalGB ||
    desired.limitIp !== actual.limitIp ||
    desired.comment !== actual.comment
  );
}

/**
 * 差异 → 操作序列。顺序固定为 add → update → detach：
 * 先把缺的入站挂上（add 对已存在的 email 会复用其原凭据），
 * 再用 update 统一改写凭据与开关（作用于全部已挂入站），最后摘掉多余入站。
 */
export function diffClient(email: string, desired: DesiredClient | null, actual: ActualClient | null): PanelOp[] {
  if (!desired) return actual ? [{ type: "delete", email }] : [];
  if (!actual) return [{ type: "add", email, client: desired.client, inboundIds: desired.inboundIds }];

  const ops: PanelOp[] = [];
  const have = new Set(actual.inboundIds);
  const want = new Set(desired.inboundIds);
  const missing = desired.inboundIds.filter((id) => !have.has(id));
  const extra = actual.inboundIds.filter((id) => !want.has(id));

  if (missing.length) ops.push({ type: "add", email, client: desired.client, inboundIds: missing });
  if (fieldsDiffer(desired.client, actual)) ops.push({ type: "update", email, client: desired.client });
  if (extra.length) ops.push({ type: "detach", email, inboundIds: extra });
  return ops;
}
