import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";

const databaseName = process.env.DB_NAME;

if (databaseName !== "aeranexa") {
  throw new Error(`Refusing to run against unexpected database: ${databaseName || "<missing>"}`);
}

// 首次启动服务时（见 src/lib/server/bootstrap-admin.ts）会在 users 表为空时自动创建同样的默认账号；
// 这个脚本用于手动重置密码，或者在 users 表已经非空时仍想强制指定/升级某个管理员账号。
const email = (process.env.ADMIN_EMAIL || "admin@admin.com").trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || "admin123456";

if (!/^\S+@\S+\.\S+$/.test(email)) {
  throw new Error(`ADMIN_EMAIL 格式不合法（需形如 admin@example.com）: ${email}`);
}
if (password.length < 8 || password.length > 72) {
  throw new Error("ADMIN_PASSWORD 长度必须在 8-72 位之间");
}

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

try {
  const passwordHash = await bcrypt.hash(password, 12);
  const [existingRows] = await connection.execute("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);

  if (existingRows.length > 0) {
    const userId = existingRows[0].id;
    await connection.execute(
      `UPDATE users
          SET password_hash = ?, role = 'admin', is_active = 1, email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP)
        WHERE id = ?`,
      [passwordHash, userId],
    );
    console.log(`已更新现有账号为管理员：${email}（id=${userId}）`);
  } else {
    const uuid = randomUUID();
    const subscriptionToken = randomBytes(16).toString("hex");
    const [result] = await connection.execute(
      `INSERT INTO users (email, password_hash, nickname, role, uuid, subscription_token, email_verified_at)
       VALUES (?, ?, 'Admin', 'admin', ?, ?, CURRENT_TIMESTAMP)`,
      [email, passwordHash, uuid, subscriptionToken],
    );
    console.log(`已创建管理员账号：${email}（id=${result.insertId}）`);
  }

  console.log(`登录邮箱：${email}`);
  console.log(`登录密码：${password}`);
  console.log("请登录后立即在「个人中心」修改密码。");
} finally {
  await connection.end();
}
