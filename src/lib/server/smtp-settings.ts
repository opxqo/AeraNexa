import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { getDbPool } from "./db";

export type SmtpSettings = {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  fromName: string;
  fromEmail: string;
  hasPassword: boolean;
  configured: boolean;
  encryptionReady: boolean;
  updatedAt: Date | null;
};

type SmtpRow = RowDataPacket & {
  is_enabled: number;
  host: string | null;
  port: number | null;
  secure: number;
  username: string | null;
  password_ciphertext: string | null;
  password_iv: string | null;
  password_auth_tag: string | null;
  from_name: string | null;
  from_email: string | null;
  updated_at: Date | null;
};

export type SmtpTransportConfig = {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
  from: string;
};

export type SaveSmtpSettingsInput = Omit<SmtpSettings, "hasPassword" | "configured" | "encryptionReady" | "updatedAt"> & {
  password?: string;
};

const SETTINGS_SELECT = `SELECT is_enabled, host, port, secure, username, password_ciphertext,
  password_iv, password_auth_tag, from_name, from_email, updated_at FROM smtp_settings WHERE id = 1 LIMIT 1`;

function asText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function getEncryptionKey(): Buffer | null {
  const configured = process.env.SMTP_CONFIG_ENCRYPTION_KEY?.trim();
  if (!configured) return null;
  const key = Buffer.from(configured, "base64");
  return key.length === 32 ? key : null;
}

function encryptPassword(password: string): { ciphertext: string; iv: string; authTag: string } {
  const key = getEncryptionKey();
  if (!key) throw new Error("SMTP_CONFIG_ENCRYPTION_KEY 必须是 Base64 编码的 32 字节密钥");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
}

function decryptPassword(row: SmtpRow): string {
  const key = getEncryptionKey();
  if (!key) throw new Error("SMTP 配置加密密钥不可用");
  if (!row.password_ciphertext || !row.password_iv || !row.password_auth_tag) throw new Error("SMTP 密码尚未配置");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(row.password_iv, "base64"));
  decipher.setAuthTag(Buffer.from(row.password_auth_tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(row.password_ciphertext, "base64")), decipher.final()]).toString("utf8");
}

function toPublicSettings(row: SmtpRow | undefined): SmtpSettings {
  const host = asText(row?.host);
  const username = asText(row?.username);
  const fromEmail = asText(row?.from_email);
  const hasPassword = Boolean(row?.password_ciphertext && row.password_iv && row.password_auth_tag);
  const port = Number(row?.port ?? 0);
  return {
    enabled: Boolean(row?.is_enabled), host, port, secure: Boolean(row?.secure), username,
    fromName: asText(row?.from_name), fromEmail, hasPassword,
    configured: Boolean(host && port > 0 && username && fromEmail && hasPassword),
    encryptionReady: Boolean(getEncryptionKey()), updatedAt: row?.updated_at ?? null,
  };
}

export async function getSmtpSettings(): Promise<SmtpSettings> {
  const [rows] = await getDbPool().execute<SmtpRow[]>(SETTINGS_SELECT);
  return toPublicSettings(rows[0]);
}

export async function saveSmtpSettings(input: SaveSmtpSettingsInput, adminId: number): Promise<SmtpSettings> {
  const pool = getDbPool();
  const [existingRows] = await pool.execute<SmtpRow[]>(SETTINGS_SELECT);
  const existing = existingRows[0];
  const password = input.password?.trim();
  const encrypted = password ? encryptPassword(password) : null;
  const hasPassword = Boolean(encrypted || (existing?.password_ciphertext && existing.password_iv && existing.password_auth_tag));
  const host = input.host.trim();
  const username = input.username.trim();
  const fromName = input.fromName.trim();
  const fromEmail = input.fromEmail.trim().toLowerCase();
  if (/[\r\n]/.test(fromName)) throw new Error("发件人名称不能包含换行符");
  const configured = Boolean(host && input.port > 0 && username && fromEmail && hasPassword);
  if (input.enabled && !configured) throw new Error("启用邮件服务前，请完整填写 SMTP 主机、端口、账号、密码和发件邮箱");
  if (input.enabled && !getEncryptionKey()) throw new Error("服务器未配置 SMTP_CONFIG_ENCRYPTION_KEY，不能启用邮件服务");
  // 旧密文只能由当前部署主密钥解开；启用前提前失败，避免保存出看似正常但无法投递的配置。
  if (input.enabled && !encrypted && existing?.password_ciphertext) decryptPassword(existing);

  await pool.execute(
    `INSERT INTO smtp_settings
      (id, is_enabled, host, port, secure, username, password_ciphertext, password_iv, password_auth_tag, from_name, from_email, updated_by_admin_id)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled), host = VALUES(host), port = VALUES(port),
       secure = VALUES(secure), username = VALUES(username),
       password_ciphertext = COALESCE(VALUES(password_ciphertext), password_ciphertext),
       password_iv = COALESCE(VALUES(password_iv), password_iv),
       password_auth_tag = COALESCE(VALUES(password_auth_tag), password_auth_tag),
       from_name = VALUES(from_name), from_email = VALUES(from_email), updated_by_admin_id = VALUES(updated_by_admin_id)`,
    [input.enabled ? 1 : 0, host || null, input.port || null, input.secure ? 1 : 0, username || null,
      encrypted?.ciphertext ?? null, encrypted?.iv ?? null, encrypted?.authTag ?? null,
      fromName || null, fromEmail || null, adminId],
  );
  return getSmtpSettings();
}

export async function getSmtpTransportConfig(requireEnabled = true): Promise<SmtpTransportConfig> {
  const [rows] = await getDbPool().execute<SmtpRow[]>(SETTINGS_SELECT);
  const row = rows[0];
  const settings = toPublicSettings(row);
  if (!row || !settings.configured || (requireEnabled && !settings.enabled)) throw new Error("邮件验证服务未启用");
  if (!settings.encryptionReady) throw new Error("SMTP 配置加密密钥不可用");
  const password = decryptPassword(row);
  const from = settings.fromName ? `"${settings.fromName.replace(/["\\]/g, "")}" <${settings.fromEmail}>` : settings.fromEmail;
  return { host: settings.host, port: settings.port, secure: settings.secure, auth: { user: settings.username, pass: password }, from };
}
