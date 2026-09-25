import "server-only";

import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { createGunzip, createGzip } from "node:zlib";
import mysql from "mysql2";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDbConnectionOptions, getDbPool } from "./db";
import { SETTING_DEFS } from "./settings-schema";

/**
 * 一键迁移：把整站数据和必须随数据一起走的环境变量（加密主密钥、哈希 pepper）导出成一个文件，
 * 在新服务器上用后台上传或 `pnpm backup:restore` 恢复。
 *
 * 文件是 gzip 压缩的 JSON Lines，**不加密**：第一行 meta（含 env），随后每行一条记录，最后一行是各表行数。
 * 拿到文件就等于拿到整站，只能由管理员下载。
 * 本文件会被命令行脚本引用（Node 剥离类型运行），只能使用可擦除的 TS 语法。
 */

export const BACKUP_FORMAT = "aeranexa-backup";
export const BACKUP_VERSION = 1;

/** 临时 / 运行态数据：不导出，恢复时清空（会话清空后所有人需重新登录）。 */
export const ALWAYS_SKIPPED_TABLES: ReadonlySet<string> = new Set([
  "schema_migrations",
  "auth_sessions",
  "email_verification_codes",
  "password_reset_tokens",
  "telegram_binding_codes",
  "telegram_updates",
  "worker_runs",
  "log_ingestion_status",
  // 迁移码只对签发它的面板有效，不能随数据带走
  "migration_tokens",
]);

/** 勾选「包含日志」才导出。 */
export const LOG_TABLES: ReadonlySet<string> = new Set(["audit_logs", "runtime_logs"]);

/** 恢复时从不清空：迁移记录由目标库自己的 schema 迁移维护。 */
const NEVER_CLEARED_TABLES: ReadonlySet<string> = new Set(["schema_migrations"]);

/** 与数据库密文 / 哈希绑定、必须跟着数据走的环境变量；DB_* 不导出（新服务器有自己的库）。 */
const SECRET_ENV_KEYS = [
  "AUTH_SESSION_SECRET",
  "SMTP_CONFIG_ENCRYPTION_KEY",
  "PAYMENT_CONFIG_ENCRYPTION_KEY",
  "SETTINGS_ENCRYPTION_KEY",
  "EMAIL_VERIFICATION_PEPPER",
  "RECHARGE_CARD_SECRET",
  "TELEGRAM_BINDING_PEPPER",
  "PAYMENT_SANDBOX_WEBHOOK_SECRET",
];

/** 加上系统设置的环境变量回退（后台没保存时生效的那部分配置）。 */
export const BACKUP_ENV_KEYS: readonly string[] = [
  ...SECRET_ENV_KEYS,
  ...SETTING_DEFS.map((def) => def.env).filter((key): key is string => Boolean(key)),
];

const INSERT_BATCH = 500;

export type BackupMeta = {
  format: string;
  version: number;
  createdAt: string;
  includesLogs: boolean;
  tables: string[];
  env: Record<string, string>;
};

export type BackupTableCount = { name: string; rows: number };

export type EnvDiff = { key: string; value: string; status: "missing" | "different" };

export type RestoreResult = {
  createdAt: string;
  includesLogs: boolean;
  tables: BackupTableCount[];
  /** 备份里有、但当前进程环境缺失或不同的变量；不补齐的话密文解不开、卡密失效。 */
  envDiff: EnvDiff[];
  /** 文件末尾的行数记录缺失或对不上，说明文件被截断。 */
  complete: boolean;
};

async function listTables(connection: PoolConnection): Promise<string[]> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT TABLE_NAME AS name FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
  );
  return rows.map((row) => String(row.name));
}

function quoteId(name: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`非法的表名或列名：${name}`);
  return `\`${name}\``;
}

/** 导出表清单：动态读取，新增的表自动纳入。 */
export function selectBackupTables(all: string[], includeLogs: boolean): string[] {
  return all.filter((name) => !ALWAYS_SKIPPED_TABLES.has(name) && (includeLogs || !LOG_TABLES.has(name)));
}

function collectEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of BACKUP_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) env[key] = value;
  }
  return env;
}

/** Buffer 用标记对象编码，其余值（字符串化的日期、大整数、JSON）原样写出。 */
function encodeValue(value: unknown): unknown {
  return Buffer.isBuffer(value) ? { $b64: value.toString("base64") } : value;
}

function decodeValue(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && typeof (value as { $b64?: unknown }).$b64 === "string") {
    return Buffer.from((value as { $b64: string }).$b64, "base64");
  }
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return value;
}

async function* backupLines(includeLogs: boolean): AsyncGenerator<string> {
  const pool = getDbPool();
  const lookup = await pool.getConnection();
  let tables: string[];
  const primaryKeys = new Map<string, string[]>();
  try {
    tables = selectBackupTables(await listTables(lookup), includeLogs);
    const [keyRows] = await lookup.query<RowDataPacket[]>(
      `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    );
    for (const row of keyRows) {
      const list = primaryKeys.get(String(row.t)) ?? [];
      list.push(String(row.c));
      primaryKeys.set(String(row.t), list);
    }
  } finally {
    lookup.release();
  }

  const meta: BackupMeta = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    includesLogs: includeLogs,
    tables,
    env: collectEnv(),
  };
  yield `${JSON.stringify(meta)}\n`;

  // 独立连接：日期保持数据库里的字面值、大整数保持字符串、JSON 列不解析，保证原样写回。
  const connection = mysql.createConnection({
    ...getDbConnectionOptions(),
    dateStrings: true,
    bigNumberStrings: true,
    typeCast(field, next) {
      if (field.type === "JSON") return field.string("utf8");
      return next();
    },
  });
  const counts: BackupTableCount[] = [];
  try {
    for (const table of tables) {
      const keys = primaryKeys.get(table);
      const order = keys?.length ? ` ORDER BY ${keys.map(quoteId).join(", ")}` : "";
      let rows = 0;
      const stream = connection.query(`SELECT * FROM ${quoteId(table)}${order}`).stream({ highWaterMark: 200 });
      for await (const row of stream as AsyncIterable<Record<string, unknown>>) {
        const encoded: Record<string, unknown> = {};
        for (const [column, value] of Object.entries(row)) encoded[column] = encodeValue(value);
        yield `${JSON.stringify({ t: table, r: encoded })}\n`;
        rows += 1;
      }
      counts.push({ name: table, rows });
    }
  } finally {
    connection.end();
  }
  yield `${JSON.stringify({ end: true, tables: counts })}\n`;
}

/** 生成 gzip 压缩的备份流（Node Readable）；路由里用 Readable.toWeb 转换。 */
export function createBackupStream(options: { includeLogs: boolean }): Readable {
  return Readable.from(backupLines(options.includeLogs)).pipe(createGzip());
}

function parseMeta(line: string | undefined): BackupMeta {
  let meta: BackupMeta | null = null;
  try {
    meta = line ? (JSON.parse(line) as BackupMeta) : null;
  } catch {
    meta = null;
  }
  if (!meta || meta.format !== BACKUP_FORMAT) throw new Error("不是 AeraNexa 备份文件");
  if (meta.version !== BACKUP_VERSION) throw new Error(`不支持的备份版本：${String(meta.version)}`);
  return meta;
}

export function diffEnv(env: Record<string, string>): EnvDiff[] {
  return Object.entries(env)
    .filter(([key, value]) => process.env[key]?.trim() !== value)
    .map(([key, value]) => ({ key, value, status: process.env[key]?.trim() ? "different" : "missing" }));
}

const WORKER_LOCK = "aeranexa:node-worker";

/**
 * 用备份覆盖当前数据库：清空除 schema_migrations 外的所有表，再写入备份里的记录。
 * 先校验文件头再动数据；worker 在运行时拒绝执行，避免恢复中途被它写入。
 */
export async function restoreBackup(
  input: Readable | (() => Promise<Readable>),
  options: { onMeta?: (meta: BackupMeta) => void } = {},
): Promise<RestoreResult> {
  const connection = await getDbPool().getConnection();
  let locked = false;
  try {
    // 先拿 worker 主锁，再打开数据源：在线迁移的迁移码一连接就作废，
    // 若先连接再发现 worker 在跑，迁移码就白白浪费了。所以数据源可以传一个「用时再打开」的函数。
    const [lockRows] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK(?, 0) AS acquired", [WORKER_LOCK]);
    locked = Number(lockRows[0]?.acquired) === 1;
    if (!locked) {
      throw new Error("worker 正在运行，请先在服务器上执行 systemctl stop aeranexa-worker aeranexa-bot（其他部署方式停掉 worker 服务）后再试；数据未改动，迁移码也还没有使用");
    }

    const source = typeof input === "function" ? await input() : input;
    const lines = createInterface({ input: source.pipe(createGunzip()), crlfDelay: Infinity })[Symbol.asyncIterator]();
    const first = await lines.next();
    const meta = parseMeta(first.done ? undefined : first.value);
    // 命令行要拿备份里的完整 env 写 .env.local；网页端只返回 envDiff，不把整份密钥带给浏览器
    options.onMeta?.(meta);

    const existing = await listTables(connection);
    const columns = new Map<string, Set<string>>();
    const [columnRows] = await connection.query<RowDataPacket[]>(
      `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`,
    );
    for (const row of columnRows) {
      const set = columns.get(String(row.t)) ?? new Set<string>();
      set.add(String(row.c));
      columns.set(String(row.t), set);
    }

    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of existing) {
      if (!NEVER_CLEARED_TABLES.has(table)) await connection.query(`DELETE FROM ${quoteId(table)}`);
    }

    const counts = new Map<string, number>();
    let batchTable = "";
    let batch: Record<string, unknown>[] = [];
    const flush = async () => {
      if (!batch.length) return;
      const target = columns.get(batchTable);
      const names = Object.keys(batch[0]).filter((name) => target?.has(name));
      if (target && names.length) {
        const placeholders = `(${names.map(() => "?").join(", ")})`;
        const values = batch.flatMap((row) => names.map((name) => decodeValue(row[name])));
        await connection.query(
          `INSERT INTO ${quoteId(batchTable)} (${names.map(quoteId).join(", ")}) VALUES ${batch.map(() => placeholders).join(", ")}`,
          values,
        );
      }
      counts.set(batchTable, (counts.get(batchTable) ?? 0) + batch.length);
      batch = [];
    };

    let trailer: { tables: BackupTableCount[] } | null = null;
    for (let next = await lines.next(); !next.done; next = await lines.next()) {
      const line = next.value.trim();
      if (!line) continue;
      const record = JSON.parse(line) as { t?: string; r?: Record<string, unknown>; end?: boolean; tables?: BackupTableCount[] };
      if (record.end) {
        trailer = { tables: record.tables ?? [] };
        break;
      }
      if (!record.t || !record.r || NEVER_CLEARED_TABLES.has(record.t) || !columns.has(record.t)) continue;
      if (record.t !== batchTable || batch.length >= INSERT_BATCH) {
        await flush();
        batchTable = record.t;
      }
      batch.push(record.r);
    }
    await flush();

    const tables = meta.tables.map((name) => ({ name, rows: counts.get(name) ?? 0 }));
    const complete = Boolean(trailer) && (trailer?.tables ?? []).every((item) => (counts.get(item.name) ?? 0) === item.rows || !columns.has(item.name));
    return { createdAt: meta.createdAt, includesLogs: meta.includesLogs, tables, envDiff: diffEnv(meta.env), complete };
  } finally {
    await connection.query("SET FOREIGN_KEY_CHECKS = 1").catch(() => {});
    if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [WORKER_LOCK]).catch(() => {});
    connection.release();
  }
}

/** 读取备份里的环境变量（命令行写 .env.local 用），只读首行。 */
export async function readBackupEnv(input: Readable): Promise<Record<string, string>> {
  const reader = createInterface({ input: input.pipe(createGunzip()), crlfDelay: Infinity });
  try {
    for await (const line of reader) return parseMeta(line).env;
    throw new Error("备份文件为空");
  } finally {
    reader.close();
    input.destroy();
  }
}
