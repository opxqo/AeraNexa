import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { getDbPool } from "./db";
import { hashPassword } from "./users";
import { safeError } from "./runtime-logs";
import { DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD } from "./default-admin";

/**
 * 首次部署时 users 表为空，注册流程又依赖尚未配置的 SMTP 发验证码，会出现无法登录的死锁。
 * 服务启动时检测到一个用户都没有，就直接种一个默认管理员账号，让部署者能先登进后台。
 * 一旦表里出现任意用户（哪怕不是管理员），后续启动都会跳过，不会覆盖已有数据。
 */
async function ensureDefaultAdmin(): Promise<void> {
  try {
    const pool = getDbPool();
    const [rows] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM users");
    const count = Number(rows[0]?.count ?? 0);
    if (count > 0) return;

    const passwordHash = await hashPassword(DEFAULT_ADMIN_PASSWORD);
    const uuid = randomUUID();
    const subscriptionToken = randomBytes(16).toString("hex");

    await pool.execute(
      `INSERT INTO users (email, password_hash, nickname, role, uuid, subscription_token, email_verified_at)
       VALUES (?, ?, 'Admin', 'admin', ?, ?, CURRENT_TIMESTAMP)`,
      [DEFAULT_ADMIN_EMAIL, passwordHash, uuid, subscriptionToken],
    );

    console.log(
      `[bootstrap-admin] 用户表为空，已自动创建默认管理员账号 ${DEFAULT_ADMIN_EMAIL}，请登录后立即修改密码。`,
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ER_DUP_ENTRY") return; // 多实例同时启动导致的竞态，忽略即可
    process.stderr.write(`${JSON.stringify({ event: "bootstrap_admin.failed", error: safeError(error) })}\n`);
  }
}

void ensureDefaultAdmin();
