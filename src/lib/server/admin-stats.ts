import "server-only";

import type { RowDataPacket } from "mysql2";
import { getDbPool } from "./db";

/**
 * 后台首页统计（不做登录检查）。后台页面经 getAdminDashboardData 先校验管理员再调用；
 * Telegram 机器人进程直接调用（它只对已绑定的管理员开放）。
 * 本文件会被 bot 进程引用（Node 剥离类型运行），只能使用可擦除的 TS 语法、不能引入 next/*。
 */

type CountRow = RowDataPacket & Record<string, number | string | null>;

type RecentUserRow = RowDataPacket & {
  id: number;
  email: string;
  nickname: string;
  role: string;
  is_active: number;
  plan_name: string | null;
  created_at: Date;
};

type RecentOrderRow = RowDataPacket & {
  id: number;
  trade_no: string;
  email: string;
  plan_name: string;
  total_amount: number | string;
  status: number;
  created_at: Date;
};

type RecentAuditRow = RowDataPacket & {
  id: number;
  action: string;
  user_id: number | null;
  email: string | null;
  ip_address: string | null;
  created_at: Date;
};

export type AdminDashboardData = {
  stats: {
    totalUsers: number;
    activeUsers: number;
    newUsersToday: number;
    totalOrders: number;
    pendingOrders: number;
    paidOrders: number;
    revenue: number;
    revenueToday: number;
    totalNodes: number;
    onlineNodes: number;
    openTickets: number;
    awaitingReplyTickets: number;
    totalPlans: number;
  };
  recentUsers: Array<{
    id: number;
    email: string;
    nickname: string;
    role: string;
    active: boolean;
    planName: string;
    createdAt: string;
  }>;
  recentOrders: Array<{
    id: number;
    tradeNo: string;
    email: string;
    planName: string;
    totalAmount: number;
    status: number;
    createdAt: string;
  }>;
  recentAudits: Array<{
    id: number;
    action: string;
    actor: string;
    ip: string;
    createdAt: string;
  }>;
};

function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value: Date | string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

export async function loadAdminDashboard(): Promise<AdminDashboardData> {
  const pool = getDbPool();

  const [usersResult, ordersResult, resourcesResult, recentUsersResult, recentOrdersResult] =
    await Promise.all([
      pool.query<CountRow[]>(`
        SELECT COUNT(*) AS total_users,
          COALESCE(SUM(is_active = 1), 0) AS active_users,
          COALESCE(SUM(created_at >= CURRENT_DATE), 0) AS new_users_today
        FROM users
      `),
      pool.query<CountRow[]>(`
        SELECT COUNT(*) AS total_orders,
          COALESCE(SUM(status = 0), 0) AS pending_orders,
          COALESCE(SUM(status IN (1, 3, 4)), 0) AS paid_orders,
          COALESCE(SUM(CASE WHEN status IN (1, 3, 4) THEN total_amount ELSE 0 END), 0) AS revenue,
          COALESCE(SUM(CASE WHEN status IN (1, 3, 4) AND COALESCE(completed_at, created_at) >= CURRENT_DATE
                            THEN total_amount ELSE 0 END), 0) AS revenue_today
        FROM orders
      `),
      pool.query<CountRow[]>(`
        SELECT
          (SELECT COUNT(*) FROM nodes) AS total_nodes,
          (SELECT COUNT(*) FROM nodes WHERE is_online = 1) AS online_nodes,
          (SELECT COUNT(*) FROM tickets WHERE status = 0) AS open_tickets,
          (SELECT COUNT(*) FROM tickets WHERE status = 0 AND reply_status = 0) AS awaiting_reply_tickets,
          (SELECT COUNT(*) FROM plans) AS total_plans
      `),
      pool.query<RecentUserRow[]>(`
        SELECT u.id, u.email, u.nickname, u.role, u.is_active,
          p.name AS plan_name, u.created_at
        FROM users u
        LEFT JOIN plans p ON p.id = u.plan_id
        ORDER BY u.id DESC
        LIMIT 6
      `),
      pool.query<RecentOrderRow[]>(`
        SELECT o.id, o.trade_no, u.email, p.name AS plan_name,
          o.total_amount, o.status, o.created_at
        FROM orders o
        INNER JOIN users u ON u.id = o.user_id
        INNER JOIN plans p ON p.id = o.plan_id
        ORDER BY o.id DESC
        LIMIT 6
      `),
    ]);

  // 审计日志是可观测性增强项，单独容错，不影响首页其余指标。
  let recentAudits: RecentAuditRow[] = [];
  try {
    const [rows] = await pool.query<RecentAuditRow[]>(`
      SELECT a.id, a.action, a.user_id, u.email, a.ip_address, a.created_at
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.id DESC
      LIMIT 8
    `);
    recentAudits = rows;
  } catch (error) {
    console.error("[aeranexa] audit log read failed", error);
  }

  const users = usersResult[0][0];
  const orders = ordersResult[0][0];
  const resources = resourcesResult[0][0];

  return {
    stats: {
      totalUsers: toNumber(users?.total_users),
      activeUsers: toNumber(users?.active_users),
      newUsersToday: toNumber(users?.new_users_today),
      totalOrders: toNumber(orders?.total_orders),
      pendingOrders: toNumber(orders?.pending_orders),
      paidOrders: toNumber(orders?.paid_orders),
      revenue: toNumber(orders?.revenue),
      revenueToday: toNumber(orders?.revenue_today),
      totalNodes: toNumber(resources?.total_nodes),
      onlineNodes: toNumber(resources?.online_nodes),
      openTickets: toNumber(resources?.open_tickets),
      awaitingReplyTickets: toNumber(resources?.awaiting_reply_tickets),
      totalPlans: toNumber(resources?.total_plans),
    },
    recentUsers: recentUsersResult[0].map((row) => ({
      id: row.id,
      email: row.email,
      nickname: row.nickname,
      role: row.role,
      active: Boolean(row.is_active),
      planName: row.plan_name ?? "未订阅",
      createdAt: formatDate(row.created_at),
    })),
    recentOrders: recentOrdersResult[0].map((row) => ({
      id: row.id,
      tradeNo: row.trade_no,
      email: row.email,
      planName: row.plan_name,
      totalAmount: toNumber(row.total_amount),
      status: row.status,
      createdAt: formatDate(row.created_at),
    })),
    recentAudits: recentAudits.map((row) => ({
      id: row.id,
      action: row.action,
      actor: row.email ?? (row.user_id === null ? "匿名" : `#${row.user_id}`),
      ip: row.ip_address ?? "—",
      createdAt: formatDate(row.created_at),
    })),
  };
}
