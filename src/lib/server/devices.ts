import "server-only";

import { createHash } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { getDbPool } from "./db";

/**
 * 订阅层设备登记（HWID，docs/node-domain-design.md §4.7）。
 *
 * 3x-ui 的 limitHwid 只在它自带的订阅服务里生效，而订阅由 AeraNexa 生成，
 * 因此按同样的语义在这里实现：客户端拉取订阅时带 `X-HWID`，新设备超出上限即拒绝下发节点。
 * 它只卡「拉取订阅」；已拿到配置的设备、以及不发送 HWID 的客户端（多数 Clash 系）由连接层 limitIp 兜底。
 */

/** 与 3x-ui 一致：短于 6 个字符的 HWID 视为客户端不支持。 */
const MIN_HWID_LENGTH = 6;

export type DeviceInfo = {
  hwid: string;
  /** 拉取订阅的来源 IP（反向代理透传的真实地址），只用于拉取记录展示 */
  ip: string;
  userAgent: string;
  deviceOs: string;
  osVersion: string;
  deviceModel: string;
};

export type DeviceGate =
  /** 上限为 0：不限，仍记录设备便于用户查看。 */
  | { status: "unlimited"; allowed: true }
  /** 客户端没有发送 HWID：放行（否则 Clash 类客户端全部不可用），由 limitIp 兜底。 */
  | { status: "not_supported"; allowed: true; limit: number }
  | { status: "known" | "registered"; allowed: true; limit: number; registered: number }
  | { status: "full"; allowed: false; limit: number; registered: number };

function trimMeta(value: string | null | undefined, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

export function readDeviceInfo(headers: Headers): DeviceInfo {
  return {
    hwid: String(headers.get("x-hwid") ?? "").trim(),
    ip: trimMeta(headers.get("x-forwarded-for")?.split(",")[0] || headers.get("x-real-ip"), 45),
    userAgent: trimMeta(headers.get("user-agent"), 255),
    deviceOs: trimMeta(headers.get("x-device-os"), 64),
    osVersion: trimMeta(headers.get("x-ver-os"), 64),
    deviceModel: trimMeta(headers.get("x-device-model"), 128),
  };
}

function hashHwid(hwid: string): string {
  return createHash("sha256").update(hwid).digest("hex");
}

async function touchOrInsert(db: Pick<PoolConnection, "execute">, userId: number, hash: string, info: DeviceInfo): Promise<void> {
  await db.execute(
    `INSERT INTO user_devices (user_id, hwid_hash, user_agent, device_os, os_version, device_model, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE last_seen_at = CURRENT_TIMESTAMP,
       -- 客户端不一定每次都带设备元信息：缺省时保留已记录的值，不要抹掉。
       user_agent = COALESCE(VALUES(user_agent), user_agent),
       device_os = COALESCE(VALUES(device_os), device_os),
       os_version = COALESCE(VALUES(os_version), os_version),
       device_model = COALESCE(VALUES(device_model), device_model)`,
    [userId, hash, info.userAgent || null, info.deviceOs || null, info.osVersion || null, info.deviceModel || null],
  );
}

export async function gateDevice(userId: number, limit: number, info: DeviceInfo): Promise<DeviceGate> {
  const pool = getDbPool();
  const hasHwid = info.hwid.length >= MIN_HWID_LENGTH;

  if (limit <= 0) {
    // 尽力记录：写失败不能影响一个本来不受限的订阅。
    if (hasHwid) await touchOrInsert(pool, userId, hashHwid(info.hwid), info).catch(() => {});
    return { status: "unlimited", allowed: true };
  }
  if (!hasHwid) return { status: "not_supported", allowed: true, limit };

  const hash = hashHwid(info.hwid);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // 锁用户行：同一用户多台设备并发拉订阅时，登记数不会超过上限。
    await connection.execute("SELECT id FROM users WHERE id = ? FOR UPDATE", [userId]);
    const [known] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM user_devices WHERE user_id = ? AND hwid_hash = ? LIMIT 1",
      [userId, hash],
    );
    const [counts] = await connection.execute<RowDataPacket[]>("SELECT COUNT(*) AS total FROM user_devices WHERE user_id = ?", [userId]);
    const registered = Number(counts[0]?.total ?? 0);

    if (!known[0] && registered >= limit) {
      await connection.commit();
      return { status: "full", allowed: false, limit, registered };
    }
    await touchOrInsert(connection, userId, hash, info);
    await connection.commit();
    return known[0]
      ? { status: "known", allowed: true, limit, registered }
      : { status: "registered", allowed: true, limit, registered: registered + 1 };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

/** 与 3x-ui / Happ 兼容的响应头，客户端据此提示「设备已满」。 */
export function deviceGateHeaders(gate: DeviceGate): Record<string, string> {
  if (gate.status === "unlimited") return {};
  const headers: Record<string, string> = { "X-Hwid-Active": "true" };
  if (gate.status === "not_supported") headers["X-Hwid-Not-Supported"] = "true";
  else if (gate.registered >= gate.limit) headers["X-Hwid-Limit"] = "true";
  if (gate.status === "full") headers["X-Hwid-Max-Devices-Reached"] = "true";
  return headers;
}

export type UserDevice = {
  id: number;
  user_agent: string | null;
  device_os: string | null;
  os_version: string | null;
  device_model: string | null;
  first_seen_at: number;
  last_seen_at: number;
};

export async function listUserDevices(userId: number): Promise<UserDevice[]> {
  const [rows] = await getDbPool().execute<RowDataPacket[]>(
    `SELECT id, user_agent, device_os, os_version, device_model, first_seen_at, last_seen_at
       FROM user_devices WHERE user_id = ? ORDER BY last_seen_at DESC`,
    [userId],
  );
  const seconds = (value: Date) => Math.floor(new Date(value).getTime() / 1000);
  return rows.map((row) => ({
    id: Number(row.id),
    user_agent: row.user_agent ? String(row.user_agent) : null,
    device_os: row.device_os ? String(row.device_os) : null,
    os_version: row.os_version ? String(row.os_version) : null,
    device_model: row.device_model ? String(row.device_model) : null,
    first_seen_at: seconds(row.first_seen_at as Date),
    last_seen_at: seconds(row.last_seen_at as Date),
  }));
}

/** 设备数上限：用户覆盖优先于套餐，0 表示不限。 */
export async function getUserDeviceLimit(userId: number): Promise<number> {
  const [rows] = await getDbPool().execute<RowDataPacket[]>(
    `SELECT COALESCE(u.device_limit_override, p.device_limit, 0) AS device_limit
       FROM users u LEFT JOIN plans p ON p.id = u.plan_id WHERE u.id = ?`,
    [userId],
  );
  return Number(rows[0]?.device_limit ?? 0);
}

/** 移除设备；deviceId 省略时移除该用户全部设备。返回移除数量。 */
export async function removeUserDevices(userId: number, deviceId?: number): Promise<number> {
  const [result] = deviceId === undefined
    ? await getDbPool().execute<ResultSetHeader>("DELETE FROM user_devices WHERE user_id = ?", [userId])
    : await getDbPool().execute<ResultSetHeader>("DELETE FROM user_devices WHERE user_id = ? AND id = ?", [userId, deviceId]);
  return result.affectedRows;
}
