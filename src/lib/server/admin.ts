import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "./users";
import { loadAdminDashboard, type AdminDashboardData } from "./admin-stats";
import { isDefaultAdminPassword } from "./default-admin";

export type { AdminDashboardData };

export const requireAdminUser = cache(async () => {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    /** 还在用公开的默认密码：后台每页顶部提醒尽快修改 */
    usesDefaultPassword: await isDefaultAdminPassword(user.password_hash),
  };
});

/** 后台首页指标：先校验管理员，查询本身在 admin-stats.ts（Telegram 机器人也复用）。 */
export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  await requireAdminUser();
  return loadAdminDashboard();
}
