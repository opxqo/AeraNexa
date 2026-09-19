import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { getDbPool } from "./db";

type CredentialRow = RowDataPacket & {
  secret_ciphertext: string;
  secret_iv: string;
  secret_auth_tag: string;
};

function key(): Buffer | null {
  const source = process.env.PAYMENT_CONFIG_ENCRYPTION_KEY?.trim();
  if (!source) return null;
  const decoded = Buffer.from(source, "base64");
  return decoded.length === 32 ? decoded : null;
}

export function paymentCredentialEncryptionReady(): boolean {
  return Boolean(key());
}

export async function savePaymentCallbackSecret(paymentMethodId: number, secret: string, adminId: number): Promise<void> {
  const encryptionKey = key();
  if (!encryptionKey) throw new Error("PAYMENT_CONFIG_ENCRYPTION_KEY 必须是 Base64 编码的 32 字节密钥");
  const normalized = secret.trim();
  if (!normalized) throw new Error("回调签名密钥不能为空");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  await getDbPool().execute(
    `INSERT INTO payment_method_credentials
      (payment_method_id, secret_ciphertext, secret_iv, secret_auth_tag, updated_by_admin_id)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE secret_ciphertext = VALUES(secret_ciphertext), secret_iv = VALUES(secret_iv),
       secret_auth_tag = VALUES(secret_auth_tag), updated_by_admin_id = VALUES(updated_by_admin_id)`,
    [paymentMethodId, ciphertext.toString("base64"), iv.toString("base64"), cipher.getAuthTag().toString("base64"), adminId],
  );
}

export async function hasPaymentCallbackSecret(paymentMethodId: number): Promise<boolean> {
  const [rows] = await getDbPool().execute<RowDataPacket[]>(
    "SELECT 1 FROM payment_method_credentials WHERE payment_method_id = ? LIMIT 1",
    [paymentMethodId],
  );
  return Boolean(rows[0]);
}

export async function getPaymentCallbackSecret(paymentMethodId: number, provider: string): Promise<string | null> {
  const [rows] = await getDbPool().execute<CredentialRow[]>(
    "SELECT secret_ciphertext, secret_iv, secret_auth_tag FROM payment_method_credentials WHERE payment_method_id = ? LIMIT 1",
    [paymentMethodId],
  );
  const row = rows[0];
  if (!row) {
    // mock 只用于本地/测试签名沙箱；生产环境必须显式配置，不能退化成固定密钥。
    if (provider === "mock" && process.env.NODE_ENV !== "production") {
      return process.env.PAYMENT_SANDBOX_WEBHOOK_SECRET?.trim() || "aeranexa-local-payment-sandbox-secret";
    }
    return null;
  }
  const encryptionKey = key();
  if (!encryptionKey) throw new Error("支付渠道配置加密密钥不可用");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(row.secret_iv, "base64"));
  decipher.setAuthTag(Buffer.from(row.secret_auth_tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(row.secret_ciphertext, "base64")), decipher.final()]).toString("utf8");
}
