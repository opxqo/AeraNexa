import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getDbPool } from "../db";
import { normalizeCertificateSha256, type PinnedPanelTarget } from "./client";

type ConnectionRow = RowDataPacket & {
  id: number;
  name: string;
  base_url: string;
  certificate_sha256: string;
  token_ciphertext: string;
  token_iv: string;
  token_auth_tag: string;
  is_enabled: number;
  last_tested_at: Date | null;
  last_test_error: string | null;
};

export type NodeConnectionView = {
  id: number;
  name: string;
  baseUrl: string;
  certificateSha256: string;
  enabled: boolean;
  lastTestedAt: string | null;
  lastTestError: string | null;
};

function encryptionKey(): Buffer {
  const key = Buffer.from(process.env.SETTINGS_ENCRYPTION_KEY?.trim() ?? "", "base64");
  if (key.length !== 32) throw new Error("需要配置 SETTINGS_ENCRYPTION_KEY 才能保存节点 Token");
  return key;
}

function seal(token: string): { ciphertext: string; iv: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

function unseal(row: ConnectionRow): string {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(row.token_iv, "base64"));
  decipher.setAuthTag(Buffer.from(row.token_auth_tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(row.token_ciphertext, "base64")), decipher.final()]).toString("utf8");
}

export function normalizeNodeBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("请输入有效的 HTTPS 管理地址"); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error("管理地址必须是无凭据、无查询参数的 HTTPS 地址");
  }
  return url.toString().replace(/\/+$/, "");
}

export async function listNodeConnections(): Promise<NodeConnectionView[]> {
  const [rows] = await getDbPool().execute<ConnectionRow[]>(
    `SELECT id, name, base_url, certificate_sha256, is_enabled, last_tested_at, last_test_error
       FROM node_panel_connections ORDER BY id DESC`,
  );
  return rows.map((row) => ({
    id: Number(row.id), name: row.name, baseUrl: row.base_url,
    certificateSha256: row.certificate_sha256, enabled: Boolean(row.is_enabled),
    lastTestedAt: row.last_tested_at?.toISOString() ?? null, lastTestError: row.last_test_error,
  }));
}

export async function saveNodeConnection(input: { id?: number; name: string; baseUrl: string; certificateSha256: string; token?: string; enabled: boolean }): Promise<number> {
  const name = input.name.trim();
  if (!name || name.length > 100) throw new Error("节点名称须为 1–100 字符");
  const baseUrl = normalizeNodeBaseUrl(input.baseUrl);
  const pin = normalizeCertificateSha256(input.certificateSha256);
  const token = input.token?.trim() ?? "";
  if (token && !/^[A-Za-z0-9._~-]{32,256}$/.test(token)) throw new Error("节点 Token 格式不正确");
  if (input.id) {
    if (token && token.length < 32) throw new Error("节点 Token 至少需要 32 字符");
    const params: Array<string | number> = [name, baseUrl, pin, input.enabled ? 1 : 0];
    let tokenSql = "";
    if (token) {
      const sealed = seal(token);
      tokenSql = ", token_ciphertext = ?, token_iv = ?, token_auth_tag = ?";
      params.push(sealed.ciphertext, sealed.iv, sealed.tag);
    }
    params.push(input.id);
    const [result] = await getDbPool().execute<ResultSetHeader>(
      `UPDATE node_panel_connections SET name = ?, base_url = ?, certificate_sha256 = ?, is_enabled = ?,
        last_tested_at = NULL, last_test_error = NULL${tokenSql} WHERE id = ?`, params,
    );
    if (result.affectedRows !== 1) throw new Error("节点连接不存在");
    return input.id;
  }
  if (token.length < 32) throw new Error("新节点 Token 至少需要 32 字符");
  const sealed = seal(token);
  const [result] = await getDbPool().execute<ResultSetHeader>(
    `INSERT INTO node_panel_connections
       (name, base_url, certificate_sha256, token_ciphertext, token_iv, token_auth_tag, is_enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, baseUrl, pin, sealed.ciphertext, sealed.iv, sealed.tag, input.enabled ? 1 : 0],
  );
  return result.insertId;
}

export async function getEnabledNodeTarget(id: number): Promise<PinnedPanelTarget> {
  const [rows] = await getDbPool().execute<ConnectionRow[]>(
    "SELECT * FROM node_panel_connections WHERE id = ? AND is_enabled = 1 LIMIT 1", [id],
  );
  const row = rows[0];
  if (!row) throw new Error("节点连接不存在或已停用");
  return { baseUrl: row.base_url, token: unseal(row), certificateSha256: row.certificate_sha256, timeoutMs: 8000 };
}

export async function recordNodeConnectionTest(id: number, error: string | null): Promise<void> {
  await getDbPool().execute(
    "UPDATE node_panel_connections SET last_tested_at = CURRENT_TIMESTAMP, last_test_error = ? WHERE id = ?",
    [error?.slice(0, 255) ?? null, id],
  );
}
