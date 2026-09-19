import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import bcrypt from "bcryptjs";
import { getDbPool } from "./db";
import { getSessionUserId } from "./session";

export type UserRow = RowDataPacket & {
  id: number;
  email: string;
  password_hash: string;
  nickname: string;
  avatar: string | null;
  role: string;
  is_active: number;
  email_verified_at: Date | null;
  transfer_enable: number | string;
  upload_bytes: number | string;
  download_bytes: number | string;
  balance: number | string;
  commission_balance: number | string;
  plan_id: number | null;
  expired_at: number | string | null;
  remind_expire: number;
  remind_traffic: number;
  telegram_id: number | string | null;
  uuid: string;
  subscription_token: string;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

const userColumns = `
  id, email, password_hash, nickname, avatar, role, is_active,
  email_verified_at, transfer_enable, upload_bytes, download_bytes,
  balance, commission_balance, plan_id, expired_at, remind_expire,
  remind_traffic, telegram_id, uuid, subscription_token, last_login_at,
  created_at, updated_at
`;

function toNumber(value: number | string | null): number {
  if (value === null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toUnixSeconds(value: Date | null): number | null {
  return value ? Math.floor(value.getTime() / 1000) : null;
}

function toEmailAvatar(email: string): string {
  return `https://cdn.v2ex.com/gravatar/${createHash("md5").update(email).digest("hex")}?s=64&d=identicon`;
}

export function toPublicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    avatar_url: user.avatar || toEmailAvatar(user.email),
    role: user.role,
    is_active: Boolean(user.is_active),
    transfer_enable: toNumber(user.transfer_enable),
    last_login_at: toUnixSeconds(user.last_login_at),
    created_at: Math.floor(user.created_at.getTime() / 1000),
    banned: user.is_active ? 0 : 1,
    remind_expire: user.remind_expire,
    remind_traffic: user.remind_traffic,
    expired_at: user.expired_at === null ? null : toNumber(user.expired_at),
    balance: toNumber(user.balance),
    commission_balance: toNumber(user.commission_balance),
    plan_id: user.plan_id,
    telegram_id: user.telegram_id === null ? null : toNumber(user.telegram_id),
    uuid: user.uuid,
  };
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const [rows] = await getDbPool().execute<UserRow[]>(
    `SELECT ${userColumns} FROM users WHERE email = ? LIMIT 1`,
    [email],
  );
  return rows[0] ?? null;
}

export async function findUserById(id: number): Promise<UserRow | null> {
  const [rows] = await getDbPool().execute<UserRow[]>(
    `SELECT ${userColumns} FROM users WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function getCurrentUser(): Promise<UserRow | null> {
  const userId = await getSessionUserId();
  if (!userId) return null;
  const user = await findUserById(userId);
  return user?.is_active ? user : null;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const normalizedHash = hash.startsWith("$2y$") ? `$2b$${hash.slice(4)}` : hash;
  return bcrypt.compare(password, normalizedHash);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function createUser(email: string, password: string): Promise<UserRow> {
  const nickname = email.split("@", 1)[0].slice(0, 50) || "AeraNexa 用户";
  const uuid = randomUUID();
  const subscriptionToken = randomBytes(16).toString("hex");
  const passwordHash = await hashPassword(password);

  const [result] = await getDbPool().execute(
    `INSERT INTO users (email, password_hash, nickname, uuid, subscription_token)
     VALUES (?, ?, ?, ?, ?)`,
    [email, passwordHash, nickname, uuid, subscriptionToken],
  );

  const userId = Number((result as { insertId: number | string }).insertId);
  const user = await findUserById(userId);
  if (!user) throw new Error("User creation failed");
  return user;
}

export async function updateLastLogin(userId: number): Promise<void> {
  await getDbPool().execute(
    "UPDATE users SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [userId],
  );
}

export async function updatePassword(userId: number, password: string): Promise<void> {
  await getDbPool().execute(
    "UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [await hashPassword(password), userId],
  );
}

export async function updatePreferences(
  userId: number,
  preferences: { remind_expire?: number; remind_traffic?: number },
): Promise<void> {
  const fields: string[] = [];
  const values: number[] = [];

  for (const field of ["remind_expire", "remind_traffic"] as const) {
    const value = preferences[field];
    if (value === undefined) continue;
    fields.push(`${field} = ?`);
    values.push(value ? 1 : 0);
  }

  if (!fields.length) return;
  values.push(userId);
  await getDbPool().execute(
    `UPDATE users SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    values,
  );
}

export async function resetSecurity(userId: number): Promise<string> {
  const uuid = randomUUID();
  const subscriptionToken = randomBytes(16).toString("hex");
  await getDbPool().execute(
    "UPDATE users SET uuid = ?, subscription_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [uuid, subscriptionToken, userId],
  );
  return subscriptionToken;
}
