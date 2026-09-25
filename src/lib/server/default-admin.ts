import "server-only";

import { verifyPassword } from "./users";

/** 首次部署自动创建的管理员（见 bootstrap-admin.ts）。密码是公开的，只用于第一次登录。 */
export const DEFAULT_ADMIN_EMAIL = "admin@admin.com";
export const DEFAULT_ADMIN_PASSWORD = "admin123456";

// bcrypt 比对一次约几百毫秒，按密码哈希缓存结果：同一个哈希只算一次，改密码后哈希变了自然重新判断
const checked = new Map<string, boolean>();

/** 这个密码哈希是不是默认密码（任何账号都查，不只默认邮箱：有人可能改了邮箱没改密码）。 */
export async function isDefaultAdminPassword(passwordHash: string): Promise<boolean> {
  const cached = checked.get(passwordHash);
  if (cached !== undefined) return cached;
  const result = await verifyPassword(DEFAULT_ADMIN_PASSWORD, passwordHash).catch(() => false);
  if (checked.size > 1000) checked.clear();
  checked.set(passwordHash, result);
  return result;
}
