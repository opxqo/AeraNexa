import "server-only";

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { badRequest, tooManyRequests, unavailable } from "./errors";
import { getDbPool } from "./db";
import { getSmtpSettings } from "./smtp-settings";

export const EMAIL_CODE_PURPOSES = ["register", "reset-password"] as const;
export type EmailCodePurpose = (typeof EMAIL_CODE_PURPOSES)[number];

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_PER_EMAIL_PER_HOUR = 5;
const MAX_PER_IP_PER_HOUR = 20;

type CodeRow = RowDataPacket & { id: number; code_hash: string; attempts: number; created_at: Date };

function getPepper(): string | null {
  return process.env.EMAIL_VERIFICATION_PEPPER?.trim() || null;
}

function hashCode(code: string): string {
  const pepper = getPepper();
  if (!pepper) throw unavailable("邮件验证服务暂未启用");
  return createHmac("sha256", pepper).update(code).digest("hex");
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return (forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown").slice(0, 45);
}

export async function assertEmailServiceAvailable(): Promise<void> {
  const settings = await getSmtpSettings();
  if (!settings.enabled || !settings.configured || !settings.encryptionReady || !getPepper()) {
    throw unavailable("邮件验证服务暂未启用");
  }
}

export async function createVerificationCode(email: string, purpose: EmailCodePurpose, ip: string): Promise<string> {
  await assertEmailServiceAvailable();
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [recentByEmail] = await connection.execute<CodeRow[]>(
      `SELECT id, code_hash, attempts, created_at FROM email_verification_codes
        WHERE email = ? AND purpose = ? AND created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 HOUR)
        ORDER BY id DESC FOR UPDATE`, [email, purpose],
    );
    const latest = recentByEmail[0];
    if (latest && Date.now() - new Date(latest.created_at).getTime() < RESEND_COOLDOWN_SECONDS * 1000) {
      throw tooManyRequests("验证码发送过于频繁，请稍后再试");
    }
    if (recentByEmail.length >= MAX_PER_EMAIL_PER_HOUR) throw tooManyRequests("该邮箱验证码发送次数已达上限，请稍后再试");
    const [recentByIp] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM email_verification_codes
        WHERE request_ip = ? AND created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 HOUR) FOR UPDATE`, [ip],
    );
    if (Number(recentByIp[0]?.total ?? 0) >= MAX_PER_IP_PER_HOUR) throw tooManyRequests("当前网络请求过于频繁，请稍后再试");
    await connection.execute(
      `UPDATE email_verification_codes SET consumed_at = CURRENT_TIMESTAMP
       WHERE email = ? AND purpose = ? AND consumed_at IS NULL`, [email, purpose],
    );
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await connection.execute(
      `INSERT INTO email_verification_codes (email, purpose, request_ip, code_hash, expires_at)
       VALUES (?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? MINUTE))`, [email, purpose, ip, hashCode(code), CODE_TTL_MINUTES],
    );
    await connection.commit();
    return code;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function invalidateLatestVerificationCode(email: string, purpose: EmailCodePurpose): Promise<void> {
  await getDbPool().execute(
    `UPDATE email_verification_codes SET consumed_at = CURRENT_TIMESTAMP
     WHERE email = ? AND purpose = ? AND consumed_at IS NULL`, [email, purpose],
  );
}

export async function consumeVerificationCode(email: string, purpose: EmailCodePurpose, code: string): Promise<void> {
  await assertEmailServiceAvailable();
  const connection = await getDbPool().getConnection();
  let committed = false;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<CodeRow[]>(
      `SELECT id, code_hash, attempts, created_at FROM email_verification_codes
       WHERE email = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP
       ORDER BY id DESC LIMIT 1 FOR UPDATE`, [email, purpose],
    );
    const record = rows[0];
    if (!record || record.attempts >= MAX_ATTEMPTS) throw badRequest("邮箱验证码错误或已过期");
    const expected = Buffer.from(record.code_hash, "hex");
    const actual = Buffer.from(hashCode(code), "hex");
    const matches = expected.length === actual.length && timingSafeEqual(expected, actual);
    if (!matches) {
      const attempts = record.attempts + 1;
      await connection.execute(
        `UPDATE email_verification_codes SET attempts = ?, consumed_at = CASE WHEN ? >= ? THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id = ?`,
        [attempts, attempts, MAX_ATTEMPTS, record.id],
      );
      await connection.commit();
      committed = true;
      throw badRequest(attempts >= MAX_ATTEMPTS ? "验证码错误次数过多，请重新获取" : "邮箱验证码错误或已过期");
    }
    await connection.execute("UPDATE email_verification_codes SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?", [record.id]);
    await connection.commit();
    committed = true;
  } catch (error) {
    if (!committed) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function isEmailCodePurpose(value: string): value is EmailCodePurpose {
  return (EMAIL_CODE_PURPOSES as readonly string[]).includes(value);
}
