import "server-only";

import { timingSafeEqual } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { getDbPool } from "./db";
import { badRequest } from "./errors";
import { getSetting } from "./settings";

/**
 * 节点流量上报的写入路径。
 *
 * `user_traffic_records` 与 `node_traffic_records` 两张表早就建好了（唯一键、索引、
 * 外键齐全），但项目里此前**只有一处 SELECT**，没有任何写入方——「流量明细」页面
 * 因此永远空着。这里补上写入，读取沿用既有的 `listTraffic`。
 */

/** 单次上报的条数上限。节点可能攒批上报，但不能把整个库的历史一次性塞进来。 */
const MAX_USER_RECORDS = 500;
const MAX_NODE_RECORDS = 200;

/** 允许的聚合粒度。与 record_type 列（VARCHAR(10)）的长度兼容。 */
const RECORD_TYPES = new Set(["hour", "day", "month"]);
const DEFAULT_RECORD_TYPE = "day";

/** 倍率上限。server_rate 参与 user_traffic_records 的唯一键，乱填会炸开行数。 */
const MAX_SERVER_RATE = 1000;

export type UserTrafficInput = {
  userId: number;
  nodeId: number | null;
  uploadBytes: number;
  downloadBytes: number;
  serverRate: number;
  recordType: string;
  /** 归一化后的 UTC 挂钟时间（MySQL DATETIME 字面量）。 */
  recordAt: string;
};

export type NodeTrafficInput = {
  nodeId: number;
  uploadBytes: number;
  downloadBytes: number;
  recordType: string;
  recordAt: string;
};

export type TrafficReportInput = {
  userRecords: UserTrafficInput[];
  nodeRecords: NodeTrafficInput[];
};

export type TrafficReportResult = {
  accepted: number;
  nodeAccepted: number;
};

/* ------------------------------------------------------------------ *
 * 认证
 * ------------------------------------------------------------------ */

async function nodeTrafficSecret(): Promise<string> {
  const configured = await getSetting("node.traffic_secret");
  if (configured) return configured;

  // 与 session.ts 一致：生产环境宁可直接失败，也不要退回一个众所周知的默认密钥。
  if (process.env.NODE_ENV === "production") {
    throw new Error("节点流量上报密钥未配置：请在后台「系统设置」或环境变量 NODE_TRAFFIC_SECRET 中设置");
  }

  return "aeranexa-local-node-traffic-secret";
}

/**
 * 校验上报凭据。
 *
 * 用 timingSafeEqual 而不是 `===`：字符串比较会在第一个不同字节处返回，
 * 逐字节试可以把密钥一个字节一个字节地试出来。
 */
export async function isAuthorizedTrafficReport(request: Request): Promise<boolean> {
  const header = request.headers.get("authorization");
  const bearer = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const provided = bearer || request.headers.get("x-node-token")?.trim() || "";
  if (!provided) return false;

  const expected = await nodeTrafficSecret();
  const left = Buffer.from(provided, "utf8");
  const right = Buffer.from(expected, "utf8");
  // timingSafeEqual 要求两片等长，长度不等时先判否（长度本身会泄漏，但远好于逐字节比较）。
  return left.length === right.length && timingSafeEqual(left, right);
}

/* ------------------------------------------------------------------ *
 * 解析与校验
 * ------------------------------------------------------------------ */

/**
 * 东八区挂钟时间字段。
 * 给 Date 加 8 小时后取 UTC 字段，等价于读东八区的年/月/日/时。
 */
function shanghaiFields(date: Date) {
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
  };
}

/**
 * 把上报的时间归一化成「桶起点的 UTC 瞬时」，返回 MySQL DATETIME 字面量。
 *
 * 分两步，顺序不能颠倒：
 * 1. **先按东八区取桶**——业务上的「一天」是东八区的一天，节点说 9/19 就是东八区 9/19；
 * 2. **再转成 UTC 挂钟存库**——DATETIME 列在本项目里存的是 UTC 瞬时（与 asDate 的
 *    展示口径一致）。若把东八区的 00:00 直接当字面量存进去，读出来会被当成 UTC，
 *    展示时整体偏移 8 小时。
 *
 * 为什么要归一化到桶起点：`record_at` 参与唯一键，同一个小时上报两次若带着不同的
 * 分钟数，就会拆成两行，聚合时同一时段被算两遍。
 */
function toBucketUtc(value: string, recordType: string): string {
  const parsed = parseRecordAt(value);
  const fields = shanghaiFields(parsed);

  // 月桶归到该月 1 号，日桶保留当天只把小时归零，小时桶连小时一起保留。
  // 注意月份与日期都要留着——只归零「比当前粒度更细」的那些字段。
  const month = fields.month;
  const day = recordType === "month" ? 1 : fields.day;
  const hour = recordType === "hour" ? fields.hour : 0;

  // Date.UTC 得到该东八区挂钟时刻对应的「瞬时」，减 8 小时换回 UTC 挂钟。
  const instant = Date.UTC(fields.year, month - 1, day, hour, 0, 0) - 8 * 3600 * 1000;
  return new Date(instant).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * 解析上报时间。
 * 认三种写法：带偏移量的 ISO 8601（最稳妥）、`YYYY-MM-DD HH:MM:SS`、`YYYY-MM-DD`。
 * 后两种缺偏移量，按东八区理解——项目本身就是东八区业务，且节点通常与面板同区。
 */
function parseRecordAt(value: string): Date {
  const raw = value.trim();
  if (!raw) throw badRequest("record_at 不能为空");

  const withOffset = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:?\d{2})$/.test(raw);
  if (withOffset) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
    throw badRequest(`record_at 不是有效时间：${value}`);
  }

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) throw badRequest(`record_at 格式应为 YYYY-MM-DD[ HH:MM:SS] 或带偏移量的 ISO 8601，实际 ${value}`);

  const [, year, month, day, hour, minute, second] = match;
  const parsed = new Date(`${year}-${month}-${day}T${hour ?? "00"}:${minute ?? "00"}:${second ?? "00"}+08:00`);
  if (Number.isNaN(parsed.getTime())) throw badRequest(`record_at 不是有效时间：${value}`);
  return parsed;
}

function asId(value: unknown, label: string, allowNull = false): number | null {
  if (value === null || value === undefined || value === "") {
    if (allowNull) return null;
    throw badRequest(`${label} 不能为空`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw badRequest(`${label} 必须为正整数，实际 ${value}`);
  return parsed;
}

function asBytes(value: unknown, label: string): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw badRequest(`${label} 必须为非负整数，实际 ${value}`);
  // BIGINT UNSIGNED 上限，超过会在驱动层被静默截断，这里直接挡掉。
  if (parsed > 18_446_744_073_709_551_615) throw badRequest(`${label} 超出范围`);
  return parsed;
}

function asRecordType(value: unknown): string {
  if (value === undefined || value === null || value === "") return DEFAULT_RECORD_TYPE;
  const raw = String(value);
  if (!RECORD_TYPES.has(raw)) {
    throw badRequest(`record_type 只支持 ${[...RECORD_TYPES].join(" / ")}，实际 ${raw}`);
  }
  return raw;
}

function asServerRate(value: unknown): number {
  if (value === undefined || value === null || value === "") return 1;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_SERVER_RATE) {
    throw badRequest(`server_rate 需在 (0, ${MAX_SERVER_RATE}] 之间，实际 ${value}`);
  }
  // 保留两位小数：与列定义 DECIMAL(10,2) 对齐，也避免浮点尾数把唯一键打散。
  return Math.round(parsed * 100) / 100;
}

/* ------------------------------------------------------------------ *
 * 入参整理
 * ------------------------------------------------------------------ */

type RawRecord = Record<string, unknown>;

function readArray(body: Record<string, unknown>, key: string): RawRecord[] {
  const value = body[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest(`${key} 必须是数组`);
  return value.map((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw badRequest(`${key} 的每一项必须是对象`);
    }
    return item as RawRecord;
  });
}

/** 把原始请求体整理成入库结构；任何一项不合法都直接 400，不做部分接受。 */
export function parseTrafficReport(body: Record<string, unknown>): TrafficReportInput {
  const rawUsers = readArray(body, "records");
  const rawNodes = readArray(body, "node_records");

  if (!rawUsers.length && !rawNodes.length) {
    throw badRequest("records 与 node_records 不能同时为空");
  }
  if (rawUsers.length > MAX_USER_RECORDS) {
    throw badRequest(`单次最多上报 ${MAX_USER_RECORDS} 条用户流量，实际 ${rawUsers.length}`);
  }
  if (rawNodes.length > MAX_NODE_RECORDS) {
    throw badRequest(`单次最多上报 ${MAX_NODE_RECORDS} 条节点流量，实际 ${rawNodes.length}`);
  }

  const userRecords = rawUsers.map((item) => {
    const recordType = asRecordType(item.record_type);
    return {
      userId: asId(item.user_id, "user_id") as number,
      nodeId: asId(item.node_id, "node_id", true),
      uploadBytes: asBytes(item.upload_bytes, "upload_bytes"),
      downloadBytes: asBytes(item.download_bytes, "download_bytes"),
      serverRate: asServerRate(item.server_rate),
      recordType,
      recordAt: toBucketUtc(String(item.record_at ?? ""), recordType),
    };
  });

  const nodeRecords = rawNodes.map((item) => {
    const recordType = asRecordType(item.record_type);
    return {
      nodeId: asId(item.node_id, "node_id") as number,
      uploadBytes: asBytes(item.upload_bytes, "upload_bytes"),
      downloadBytes: asBytes(item.download_bytes, "download_bytes"),
      recordType,
      recordAt: toBucketUtc(String(item.record_at ?? ""), recordType),
    };
  });

  return { userRecords, nodeRecords };
}

/* ------------------------------------------------------------------ *
 * 落库
 * ------------------------------------------------------------------ */

/**
 * 先确认上报里引用的 user_id / node_id 都真实存在。
 *
 * 外键约束本来就会拦住不存在的 id，但那会抛成 500——而「上报了一个已删除的用户」
 * 是节点侧很常见的情况，属于调用方的错误，应该给 400 让它去修数据。
 * 两张表各查一次，不按条数放大查询次数。
 */
async function assertEntitiesExist(input: TrafficReportInput): Promise<void> {
  const pool = getDbPool();
  const userIds = [...new Set(input.userRecords.map((record) => record.userId))];
  const nodeIds = [
    ...new Set([
      ...input.userRecords.map((record) => record.nodeId).filter((id): id is number => id !== null),
      ...input.nodeRecords.map((record) => record.nodeId),
    ]),
  ];

  const placeholders = (count: number) => Array.from({ length: count }, () => "?").join(",");

  if (userIds.length) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id FROM users WHERE id IN (${placeholders(userIds.length)})`,
      userIds,
    );
    const found = new Set(rows.map((row) => Number(row.id)));
    const missing = userIds.filter((id) => !found.has(id));
    if (missing.length) throw badRequest(`user_id 不存在：${missing.join(", ")}`);
  }

  if (nodeIds.length) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id FROM nodes WHERE id IN (${placeholders(nodeIds.length)})`,
      nodeIds,
    );
    const found = new Set(rows.map((row) => Number(row.id)));
    const missing = nodeIds.filter((id) => !found.has(id));
    if (missing.length) throw badRequest(`node_id 不存在：${missing.join(", ")}`);
  }
}

/**
 * 写入上报数据。
 *
 * 用 `ON DUPLICATE KEY UPDATE ... = ... + VALUES(...)` **累加**而不是覆盖：
 * 节点通常每隔几分钟推一次增量，同一个桶会被多次上报，覆盖会丢掉前面的量。
 *
 * 两张表在同一个事务里写，避免用户侧记了、节点侧没记的对不上账。
 */
export async function recordTraffic(input: TrafficReportInput): Promise<TrafficReportResult> {
  await assertEntitiesExist(input);

  const pool = getDbPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const record of input.userRecords) {
      await connection.execute(
        `INSERT INTO user_traffic_records
           (user_id, node_id, upload_bytes, download_bytes, server_rate, record_type, record_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           upload_bytes = upload_bytes + VALUES(upload_bytes),
           download_bytes = download_bytes + VALUES(download_bytes)`,
        [
          record.userId,
          record.nodeId,
          record.uploadBytes,
          record.downloadBytes,
          record.serverRate,
          record.recordType,
          record.recordAt,
        ],
      );
    }

    for (const record of input.nodeRecords) {
      await connection.execute(
        `INSERT INTO node_traffic_records
           (node_id, upload_bytes, download_bytes, record_type, record_at)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           upload_bytes = upload_bytes + VALUES(upload_bytes),
           download_bytes = download_bytes + VALUES(download_bytes)`,
        [record.nodeId, record.uploadBytes, record.downloadBytes, record.recordType, record.recordAt],
      );
    }

    await connection.commit();
    return { accepted: input.userRecords.length, nodeAccepted: input.nodeRecords.length };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** 供测试清理用：按用户删除流量记录。 */
export async function deleteTrafficForUsers(userIds: number[]): Promise<void> {
  if (!userIds.length) return;
  const connection: PoolConnection = await getDbPool().getConnection();
  try {
    await connection.query(`DELETE FROM user_traffic_records WHERE user_id IN (?)`, [userIds]);
  } finally {
    connection.release();
  }
}
