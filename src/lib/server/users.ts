import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import bcrypt from "bcryptjs";
import { getDbPool } from "./db";
import { badRequest } from "./errors";
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
  const quota = toNumber(user.transfer_enable);
  const upload = toNumber(user.upload_bytes);
  const download = toNumber(user.download_bytes);
  const used = upload + download;
  const expiredAt = user.expired_at === null ? null : toNumber(user.expired_at);
  const isPermanent = user.plan_id !== null && (expiredAt === null || expiredAt === 0);
  const nowSeconds = Math.floor(Date.now() / 1000);

  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    avatar_url: user.avatar || toEmailAvatar(user.email),
    role: user.role,
    is_active: Boolean(user.is_active),
    // 流量字段统一为字节；剩余量与占用比由服务端计算，避免前后端口径漂移。
    transfer_enable: quota,
    used_bytes: used,
    remain_bytes: Math.max(0, quota - used),
    usage_percent: quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0,
    last_login_at: toUnixSeconds(user.last_login_at),
    created_at: Math.floor(user.created_at.getTime() / 1000),
    email_verified_at: toUnixSeconds(user.email_verified_at),
    banned: user.is_active ? 0 : 1,
    remind_expire: user.remind_expire,
    remind_traffic: user.remind_traffic,
    expired_at: expiredAt,
    is_permanent: isPermanent,
    is_expired: user.plan_id !== null && !isPermanent && (expiredAt ?? 0) <= nowSeconds,
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

  // 注册流程已校验邮箱验证码，因此直接标记邮箱已验证，避免出现"已注册但未验证"的不一致状态。
  const [result] = await getDbPool().execute(
    `INSERT INTO users (email, password_hash, nickname, uuid, subscription_token, email_verified_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [email, passwordHash, nickname, uuid, subscriptionToken],
  );

  const userId = Number((result as { insertId: number | string }).insertId);
  const user = await findUserById(userId);
  if (!user) throw new Error("User creation failed");
  return user;
}

export type RegistrationInput = {
  email: string;
  password: string;
  inviteCode?: string;
};

type InviteCodeRow = RowDataPacket & {
  id: number; user_id: number; status: number;
  max_uses: number | null; used_count: number; expires_at: Date | null;
};

/**
 * 注册用户，并在同一事务内建立邀请关系。
 * 邀请码无效/过期/用尽时整笔回滚，避免出现"用户已建但邀请关系丢失"的中间态。
 */
export async function registerUser(input: RegistrationInput): Promise<UserRow> {
  const email = input.email.trim().toLowerCase();
  const nickname = email.split("@", 1)[0].slice(0, 50) || "AeraNexa 用户";
  const uuid = randomUUID();
  const subscriptionToken = randomBytes(16).toString("hex");
  const passwordHash = await hashPassword(input.password);

  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();

    let inviteCode: InviteCodeRow | null = null;
    if (input.inviteCode) {
      const [rows] = await connection.execute<InviteCodeRow[]>(
        `SELECT id, user_id, status, max_uses, used_count, expires_at
           FROM invite_codes WHERE code = ? LIMIT 1 FOR UPDATE`,
        [input.inviteCode.trim()],
      );
      inviteCode = rows[0] ?? null;
      if (!inviteCode || inviteCode.status !== 0) throw badRequest("邀请码无效");
      if (inviteCode.expires_at && new Date(inviteCode.expires_at).getTime() < Date.now()) {
        throw badRequest("邀请码已过期");
      }
      if (inviteCode.max_uses !== null && inviteCode.used_count >= inviteCode.max_uses) {
        throw badRequest("邀请码使用次数已达上限");
      }
    }

    const [result] = await connection.execute(
      `INSERT INTO users (email, password_hash, nickname, uuid, subscription_token, email_verified_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [email, passwordHash, nickname, uuid, subscriptionToken],
    );
    const userId = Number((result as { insertId: number | string }).insertId);

    if (inviteCode) {
      await connection.execute(
        `INSERT INTO user_referrals (inviter_user_id, invited_user_id, invite_code_id) VALUES (?, ?, ?)`,
        [inviteCode.user_id, userId, inviteCode.id],
      );
      await connection.execute(
        `UPDATE invite_codes SET used_count = used_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [inviteCode.id],
      );
    }

    await connection.commit();

    const user = await findUserById(userId);
    if (!user) throw new Error("User creation failed");
    return user;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
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

export async function updateProfile(
  userId: number,
  profile: { nickname?: string; avatar?: string | null },
): Promise<void> {
  const fields: string[] = [];
  const values: Array<string | null | number> = [];

  if (profile.nickname !== undefined) {
    fields.push("nickname = ?");
    values.push(profile.nickname);
  }
  if (profile.avatar !== undefined) {
    fields.push("avatar = ?");
    values.push(profile.avatar);
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
