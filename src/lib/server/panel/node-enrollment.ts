import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getDbPool } from "../db";
import { getServerStatus, normalizeCertificateSha256 } from "./client";
import { normalizeNodeBaseUrl, saveNodeConnection } from "./node-connections";

/**
 * 3x-node 一键安装注册（节点侧契约见 3x-node docs/node/README.md「自动注册」）。
 * 注册码 192 位随机、只存 SHA-256、单次使用；节点上报后 AN 用固定指纹回连核对，
 * 成功才保存连接，且默认停用，等管理员确认后启用。
 */

const CODE_TTL_MINUTES = 30;
const CODE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{32,256}$/;

export const NODE_INSTALL_SCRIPT_URL = "https://raw.githubusercontent.com/opxqo/3x-node/main/install-node.sh";

export class EnrollmentError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type CodeRow = RowDataPacket & { id: number; name: string; base_url: string; expires_at: Date; used_at: Date | null };

export type EnrollmentCodeView = {
  id: number;
  name: string;
  baseUrl: string;
  expiresAt: string;
  usedAt: string | null;
  connectionId: number | null;
  lastError: string | null;
};

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function buildInstallCommand(enrollUrl: string, code: string): string {
  return `apk add --no-cache ca-certificates curl && curl -fLSs ${NODE_INSTALL_SCRIPT_URL} -o /root/install-node.sh && sh /root/install-node.sh install --enroll-url ${enrollUrl} --enroll-code ${code}`;
}

export async function createEnrollmentCode(input: { name: string; baseUrl: string; createdBy: number }): Promise<{ code: string; expiresAt: Date }> {
  const name = input.name.trim();
  if (!name || name.length > 100) throw new Error("节点名称须为 1–100 字符");
  const baseUrl = normalizeNodeBaseUrl(input.baseUrl);
  const code = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000);
  await getDbPool().execute(
    "INSERT INTO node_enrollment_codes (code_hash, name, base_url, expires_at, created_by) VALUES (?, ?, ?, ?, ?)",
    [hashCode(code), name, baseUrl, expiresAt, input.createdBy],
  );
  return { code, expiresAt };
}

export async function listEnrollmentCodes(): Promise<EnrollmentCodeView[]> {
  const [rows] = await getDbPool().execute<RowDataPacket[]>(
    `SELECT id, name, base_url, expires_at, used_at, connection_id, last_error
       FROM node_enrollment_codes ORDER BY id DESC LIMIT 10`,
  );
  return rows.map((row) => ({
    id: Number(row.id), name: String(row.name), baseUrl: String(row.base_url),
    expiresAt: (row.expires_at as Date).toISOString(), usedAt: (row.used_at as Date | null)?.toISOString() ?? null,
    connectionId: row.connection_id === null ? null : Number(row.connection_id), lastError: row.last_error as string | null,
  }));
}

function text(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value.trim() : "";
}

/** 节点注册：先原子占用注册码（失败也作废，防止重放），再回连核对，最后保存为停用连接。 */
export async function enrollNode(body: Record<string, unknown>, ip: string | null): Promise<{ connectionId: number; name: string }> {
  const code = text(body, "code");
  if (!CODE_PATTERN.test(code)) throw new EnrollmentError("注册码无效或已过期", 403);
  const codeHash = hashCode(code);
  const pool = getDbPool();
  const [claim] = await pool.execute<ResultSetHeader>(
    `UPDATE node_enrollment_codes SET used_at = CURRENT_TIMESTAMP, used_ip = ?
      WHERE code_hash = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
    [ip?.slice(0, 45) ?? null, codeHash],
  );
  if (claim.affectedRows !== 1) throw new EnrollmentError("注册码无效或已过期", 403);
  const [rows] = await pool.execute<CodeRow[]>("SELECT id, name, base_url FROM node_enrollment_codes WHERE code_hash = ?", [codeHash]);
  const row = rows[0];

  try {
    const token = text(body, "token");
    if (!TOKEN_PATTERN.test(token)) throw new EnrollmentError("节点 Token 格式不正确", 400);
    let certificateSha256: string;
    try { certificateSha256 = normalizeCertificateSha256(text(body, "certSha256")); }
    catch { throw new EnrollmentError("证书指纹格式不正确", 400); }
    const basePath = text(body, "basePath") || "/";
    if (!/^\/([A-Za-z0-9._~-]+\/)*$/.test(basePath)) throw new EnrollmentError("basePath 格式不正确", 400);
    const guid = text(body, "guid");
    const baseUrl = normalizeNodeBaseUrl(row.base_url + basePath);

    let status;
    try {
      status = await getServerStatus({ baseUrl, token, certificateSha256, timeoutMs: 8000 });
    } catch (error) {
      throw new EnrollmentError(`AN 无法通过 ${row.base_url} 回连节点：${error instanceof Error ? error.message : "连接失败"}`, 422);
    }
    if (!guid || status.panelGuid !== guid) throw new EnrollmentError("回连到的节点与上报的实例标识不一致", 422);

    const connectionId = await saveNodeConnection({ name: row.name, baseUrl, certificateSha256, token, enabled: false });
    await pool.execute("UPDATE node_enrollment_codes SET connection_id = ?, last_error = NULL WHERE id = ?", [connectionId, row.id]);
    return { connectionId, name: row.name };
  } catch (error) {
    const message = error instanceof Error ? error.message : "注册失败";
    await pool.execute("UPDATE node_enrollment_codes SET last_error = ? WHERE id = ?", [message.slice(0, 255), row.id]).catch(() => {});
    throw error;
  }
}
