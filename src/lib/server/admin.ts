import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import type { RowDataPacket } from "mysql2";
import type { AdminSectionKey } from "@/lib/admin-navigation";
import { getDbPool } from "./db";
import { getCurrentUser } from "./users";

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

export type AdminDashboardData = {
  stats: {
    totalUsers: number;
    activeUsers: number;
    newUsersToday: number;
    totalOrders: number;
    pendingOrders: number;
    paidOrders: number;
    revenue: number;
    totalNodes: number;
    onlineNodes: number;
    openTickets: number;
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
};

export type AdminTableData = {
  title: string;
  description: string;
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, string | number>>;
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

export const requireAdminUser = cache(async () => {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");
  return { id: user.id, email: user.email, nickname: user.nickname };
});

export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  await requireAdminUser();
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
          COALESCE(SUM(CASE WHEN status IN (1, 3, 4) THEN total_amount ELSE 0 END), 0) AS revenue
        FROM orders
      `),
      pool.query<CountRow[]>(`
        SELECT
          (SELECT COUNT(*) FROM nodes) AS total_nodes,
          (SELECT COUNT(*) FROM nodes WHERE is_online = 1) AS online_nodes,
          (SELECT COUNT(*) FROM tickets WHERE status = 0) AS open_tickets
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
      totalNodes: toNumber(resources?.total_nodes),
      onlineNodes: toNumber(resources?.online_nodes),
      openTickets: toNumber(resources?.open_tickets),
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
  };
}

export async function getAdminSectionData(section: AdminSectionKey): Promise<AdminTableData> {
  await requireAdminUser();
  const pool = getDbPool();

  if (section === "users") {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT u.id, u.email, u.nickname, u.role, u.is_active, p.name AS plan_name, u.created_at
      FROM users u LEFT JOIN plans p ON p.id = u.plan_id
      ORDER BY u.id DESC LIMIT 50
    `);
    return {
      title: "用户管理",
      description: "查看 AeraNexa 用户账户、角色和当前套餐。",
      columns: [
        { key: "id", label: "ID" }, { key: "email", label: "邮箱" },
        { key: "nickname", label: "昵称" }, { key: "role", label: "角色" },
        { key: "plan", label: "套餐" }, { key: "status", label: "状态" },
        { key: "createdAt", label: "注册时间" },
      ],
      rows: rows.map((row) => ({
        id: Number(row.id), email: String(row.email), nickname: String(row.nickname),
        role: row.role === "admin" ? "管理员" : "用户", plan: row.plan_name ? String(row.plan_name) : "未订阅",
        status: row.is_active ? "正常" : "停用", createdAt: formatDate(row.created_at as Date),
      })),
    };
  }

  if (section === "plans") {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT id, name, transfer_enable, speed_limit, month_price, is_visible, is_renewable, created_at
      FROM plans ORDER BY sort_order, id DESC LIMIT 50
    `);
    return {
      title: "套餐管理",
      description: "查看套餐价格、流量配额和售卖状态。",
      columns: [
        { key: "id", label: "ID" }, { key: "name", label: "套餐" },
        { key: "traffic", label: "流量" }, { key: "speed", label: "限速" },
        { key: "price", label: "月付价格" }, { key: "visible", label: "展示" },
        { key: "renewable", label: "续费" },
      ],
      rows: rows.map((row) => ({
        id: Number(row.id), name: String(row.name), traffic: `${toNumber(row.transfer_enable)} GB`,
        speed: row.speed_limit === null ? "不限速" : `${toNumber(row.speed_limit)} Mbps`,
        price: row.month_price === null ? "—" : `¥${(toNumber(row.month_price) / 100).toFixed(2)}`,
        visible: row.is_visible ? "显示" : "隐藏", renewable: row.is_renewable ? "允许" : "禁止",
      })),
    };
  }

  if (section === "orders") {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT o.id, o.trade_no, u.email, p.name AS plan_name, o.period,
        o.total_amount, o.status, o.created_at
      FROM orders o INNER JOIN users u ON u.id = o.user_id
      INNER JOIN plans p ON p.id = o.plan_id
      ORDER BY o.id DESC LIMIT 50
    `);
    const statuses = ["待支付", "开通中", "已取消", "已完成", "已折抵", "已退款"];
    return {
      title: "订单管理",
      description: "查看用户订单、金额和当前履约状态。",
      columns: [
        { key: "tradeNo", label: "订单号" }, { key: "email", label: "用户" },
        { key: "plan", label: "套餐" }, { key: "period", label: "周期" },
        { key: "amount", label: "金额" }, { key: "status", label: "状态" },
        { key: "createdAt", label: "创建时间" },
      ],
      rows: rows.map((row) => ({
        tradeNo: String(row.trade_no), email: String(row.email), plan: String(row.plan_name),
        period: String(row.period), amount: `¥${(toNumber(row.total_amount) / 100).toFixed(2)}`,
        status: statuses[toNumber(row.status)] ?? "未知", createdAt: formatDate(row.created_at as Date),
      })),
    };
  }

  if (section === "payments") {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT pt.id, o.trade_no, pm.name AS method_name, pt.provider_trade_no,
        pt.amount, pt.currency, pt.status, pt.created_at
      FROM payment_transactions pt
      INNER JOIN orders o ON o.id = pt.order_id
      INNER JOIN payment_methods pm ON pm.id = pt.payment_method_id
      ORDER BY pt.id DESC LIMIT 50
    `);
    return {
      title: "支付管理",
      description: "查看支付交易记录；支付渠道密钥不会在此页面展示。",
      columns: [
        { key: "id", label: "ID" }, { key: "tradeNo", label: "订单号" },
        { key: "method", label: "支付渠道" }, { key: "providerTradeNo", label: "渠道流水" },
        { key: "amount", label: "金额" }, { key: "status", label: "状态" },
        { key: "createdAt", label: "创建时间" },
      ],
      rows: rows.map((row) => ({
        id: Number(row.id), tradeNo: String(row.trade_no), method: String(row.method_name),
        providerTradeNo: row.provider_trade_no ? String(row.provider_trade_no) : "—",
        amount: `${String(row.currency)} ${(toNumber(row.amount) / 100).toFixed(2)}`,
        status: String(row.status), createdAt: formatDate(row.created_at as Date),
      })),
    };
  }

  if (section === "nodes") {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT id, name, protocol, host, port, rate, external_panel,
        is_visible, is_online, last_check_at
      FROM nodes ORDER BY sort_order, id DESC LIMIT 50
    `);
    return {
      title: "节点管理",
      description: "查看 3x-ui 节点映射、协议和在线状态。",
      columns: [
        { key: "id", label: "ID" }, { key: "name", label: "节点" },
        { key: "protocol", label: "协议" }, { key: "endpoint", label: "地址" },
        { key: "rate", label: "倍率" }, { key: "panel", label: "来源" },
        { key: "visible", label: "展示" }, { key: "status", label: "状态" },
        { key: "checkedAt", label: "最近检查" },
      ],
      rows: rows.map((row) => ({
        id: Number(row.id), name: String(row.name), protocol: String(row.protocol).toUpperCase(),
        endpoint: `${String(row.host)}:${toNumber(row.port)}`, rate: `${toNumber(row.rate).toFixed(2)}x`,
        panel: String(row.external_panel), visible: row.is_visible ? "显示" : "隐藏",
        status: row.is_online ? "在线" : "离线", checkedAt: formatDate(row.last_check_at as Date | null),
      })),
    };
  }

  if (section === "tickets") {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT t.id, t.subject, u.email, t.level, t.status, t.reply_status, t.updated_at
      FROM tickets t INNER JOIN users u ON u.id = t.user_id
      ORDER BY t.updated_at DESC LIMIT 50
    `);
    const levels = ["低", "中", "高"];
    return {
      title: "工单管理",
      description: "查看用户工单优先级、回复和处理状态。",
      columns: [
        { key: "id", label: "ID" }, { key: "subject", label: "主题" },
        { key: "email", label: "用户" }, { key: "level", label: "优先级" },
        { key: "reply", label: "回复状态" }, { key: "status", label: "工单状态" },
        { key: "updatedAt", label: "更新时间" },
      ],
      rows: rows.map((row) => ({
        id: Number(row.id), subject: String(row.subject), email: String(row.email),
        level: levels[toNumber(row.level)] ?? "中", reply: row.reply_status ? "已回复" : "待回复",
        status: row.status ? "已关闭" : "处理中", updatedAt: formatDate(row.updated_at as Date),
      })),
    };
  }

  const [tableRows, migrationRows] = await Promise.all([
    pool.query<CountRow[]>(`
      SELECT COUNT(*) AS table_count FROM information_schema.tables
      WHERE table_schema = DATABASE()
    `),
    pool.query<RowDataPacket[]>(`
      SELECT version, description, applied_at FROM schema_migrations
      ORDER BY applied_at DESC LIMIT 10
    `),
  ]);
  const databaseName = process.env.DB_NAME || "aeranexa";
  return {
    title: "系统设置",
    description: "当前仅展示运行与迁移状态；可写配置将在对应功能接入后开放。",
    columns: [
      { key: "item", label: "项目" }, { key: "value", label: "当前值" },
      { key: "detail", label: "说明" },
    ],
    rows: [
      { item: "数据库", value: databaseName, detail: "AeraNexa 独立数据库" },
      { item: "数据表", value: toNumber(tableRows[0][0]?.table_count), detail: "当前 schema 表数量" },
      ...migrationRows[0].map((row) => ({
        item: `迁移 ${String(row.version)}`,
        value: formatDate(row.applied_at as Date),
        detail: String(row.description),
      })),
    ],
  };
}
