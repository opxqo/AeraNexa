import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getDbPool } from "./db";

/**
 * 面板对面板在线迁移：旧面板生成一次性「迁移码」，新面板凭它直接拉取旧面板的备份流并恢复，
 * 中间不落地备份文件。清空覆盖这一破坏性操作只发生在新面板，旧面板只开放一个只读导出口。
 *
 * 迁移码 = "anx1." + base64url(JSON { u: 旧面板对外地址, t: 32 字节随机令牌 })。
 * 数据库只存令牌的 SHA-256（按哈希查找，不比较明文），30 分钟过期，导出开始即作废。
 * 本文件会被命令行脚本引用（Node 剥离类型运行），只能使用可擦除的 TS 语法。
 */

const CODE_PREFIX = "anx1.";
export const MIGRATION_TOKEN_TTL_MINUTES = 30;
export const MIGRATION_EXPORT_PATH = "/api/migration/export";
/** 新面板把自己数据库的指纹放在这个请求头里；旧面板发现和自己相同就拒绝（见 databaseFingerprint）。 */
export const DATABASE_FINGERPRINT_HEADER = "x-aeranexa-database";
/** 连上旧面板并收到响应头的最长等待；之后的数据传输不限时。 */
const CONNECT_TIMEOUT_MS = 30_000;

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** 旧面板地址只允许 https；本机地址例外，方便测试。只保留协议 + 主机 + 端口。 */
export function normalizePanelOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`面板地址格式不正确：${raw}`);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("面板地址必须是 https://（迁移数据含全部用户数据和密钥，不能明文传输）");
  }
  return url.origin;
}

/**
 * 当前连接的数据库指纹：MySQL 实例（server_uuid，MariaDB 没有时退回主机名 + 端口）+ 库名。
 * 用来识别「把迁移码粘贴回同一个面板」：恢复会先清空库，而导出还在边读边发，读到的就是空表，会丢数据。
 */
export async function databaseFingerprint(): Promise<string> {
  const pool = getDbPool();
  let instance: string;
  try {
    const [rows] = await pool.query<RowDataPacket[]>("SELECT @@server_uuid AS id");
    instance = String(rows[0]?.id ?? "");
  } catch {
    const [rows] = await pool.query<RowDataPacket[]>("SELECT CONCAT(@@hostname, ':', @@port) AS id");
    instance = String(rows[0]?.id ?? "");
  }
  const [dbRows] = await pool.query<RowDataPacket[]>("SELECT DATABASE() AS db");
  return createHash("sha256").update(`${instance}/${String(dbRows[0]?.db ?? "")}`).digest("hex").slice(0, 32);
}

export function encodeMigrationCode(origin: string, token: string): string {
  return CODE_PREFIX + Buffer.from(JSON.stringify({ u: origin, t: token }), "utf8").toString("base64url");
}

export function parseMigrationCode(code: string): { origin: string; token: string } {
  const trimmed = code.trim();
  if (!trimmed.startsWith(CODE_PREFIX)) throw new Error("不是有效的迁移码（应以 anx1. 开头）");
  let payload: { u?: unknown; t?: unknown };
  try {
    payload = JSON.parse(Buffer.from(trimmed.slice(CODE_PREFIX.length), "base64url").toString("utf8")) as { u?: unknown; t?: unknown };
  } catch {
    throw new Error("迁移码已损坏，请重新复制完整");
  }
  if (typeof payload.u !== "string" || typeof payload.t !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(payload.t)) {
    throw new Error("迁移码已损坏，请重新复制完整");
  }
  return { origin: normalizePanelOrigin(payload.u), token: payload.t };
}

/** adminId 为 null 表示在服务器命令行生成（安装脚本的「生成迁移码」）。 */
export async function createMigrationCode(adminId: number | null, options: { includeLogs: boolean; origin: string }) {
  const origin = normalizePanelOrigin(options.origin);
  const token = randomBytes(32).toString("base64url");
  await getDbPool().execute(
    `INSERT INTO migration_tokens (token_hash, include_logs, created_by, expires_at)
     VALUES (?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ${MIGRATION_TOKEN_TTL_MINUTES} MINUTE))`,
    [hashToken(token), options.includeLogs ? 1 : 0, adminId],
  );
  return { code: encodeMigrationCode(origin, token), origin, expiresInSeconds: MIGRATION_TOKEN_TTL_MINUTES * 60 };
}

/** 校验并作废令牌：单条 UPDATE 带条件，按影响行数判断，并发两次使用只有一次成功。 */
export async function consumeMigrationToken(token: string, ip: string | null): Promise<{ includeLogs: boolean } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const hash = hashToken(token);
  const pool = getDbPool();
  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE migration_tokens SET used_at = CURRENT_TIMESTAMP, used_by_ip = ?
      WHERE token_hash = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
    [ip ? ip.slice(0, 45) : null, hash],
  );
  if (result.affectedRows !== 1) return null;
  const [rows] = await pool.execute<RowDataPacket[]>("SELECT include_logs FROM migration_tokens WHERE token_hash = ? LIMIT 1", [hash]);
  return { includeLogs: Boolean(Number(rows[0]?.include_logs)) };
}

export async function countActiveMigrationTokens(): Promise<number> {
  const [rows] = await getDbPool().query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM migration_tokens WHERE used_at IS NULL AND expires_at > CURRENT_TIMESTAMP",
  );
  return Number(rows[0]?.n ?? 0);
}

/** 作废所有尚未使用的迁移码，返回作废数量。 */
export async function revokeMigrationTokens(): Promise<number> {
  const [result] = await getDbPool().execute<ResultSetHeader>(
    "UPDATE migration_tokens SET used_at = CURRENT_TIMESTAMP WHERE used_at IS NULL AND expires_at > CURRENT_TIMESTAMP",
  );
  return result.affectedRows;
}

/**
 * 新面板用迁移码连接旧面板，返回备份数据流（直接交给 restoreBackup）。
 * 不跟随跳转：否则令牌可能被带到别的地址。
 */
export async function openRemoteBackup(code: string): Promise<Readable> {
  const { origin, token } = parseMigrationCode(code);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(new URL(MIGRATION_EXPORT_PATH, origin), {
      headers: { Authorization: `Bearer ${token}`, [DATABASE_FINGERPRINT_HEADER]: await databaseFingerprint() },
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    const reason = controller.signal.aborted ? "连接超时" : error instanceof Error ? error.message : String(error);
    throw new Error(`无法连接旧面板 ${origin}：${reason}`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    let message = text.slice(0, 200);
    try { message = (JSON.parse(text) as { error?: string }).error ?? message; } catch { /* 非 JSON 时用原文 */ }
    if (response.status === 404) message = "旧面板没有在线迁移接口，请先把旧面板更新到最新版本";
    if (response.status === 409) throw new Error(message);
    throw new Error(`旧面板拒绝迁移（HTTP ${response.status}）：${message || "未知原因"}`);
  }
  return Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>);
}
