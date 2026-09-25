import Link from "next/link";
import { CircleDollarSign, Network, ShoppingCart, TicketCheck, Users } from "lucide-react";
import { getAdminDashboardData } from "@/lib/server/admin";
import { AdminPage } from "@/components/admin-page";

const orderStatus = ["待支付", "开通中", "已取消", "已完成", "已折抵", "已退款"];

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(cents / 100);
}

export default async function AdminDashboardPage() {
  const { stats, recentUsers, recentOrders } = await getAdminDashboardData();

  return (
    <AdminPage title="系统概览" description="用户、订单、节点与工单的实时状态。">

      <section className="stat-grid" aria-label="核心业务指标">
        <article>
          <Users size={18} />
          <small>用户总数</small>
          <strong>{stats.totalUsers}</strong>
          <span className="admin-stat-detail">{stats.activeUsers} 个正常 · 今日新增 {stats.newUsersToday}</span>
        </article>
        <article>
          <CircleDollarSign size={18} />
          <small>成交总额</small>
          <strong>{formatMoney(stats.revenue)}</strong>
          <span className="admin-stat-detail">{stats.paidOrders} 笔已支付订单</span>
        </article>
        <article>
          <ShoppingCart size={18} />
          <small>订单总数</small>
          <strong>{stats.totalOrders}</strong>
          <span className="admin-stat-detail">{stats.pendingOrders} 笔等待支付</span>
        </article>
        <article>
          <Network size={18} />
          <small>在线节点</small>
          <strong>{stats.onlineNodes} / {stats.totalNodes}</strong>
          <span className="admin-stat-detail">3x-ui 节点映射</span>
        </article>
      </section>

      {stats.openTickets > 0 ? (
        <Link href="/admin/tickets" className="admin-notice">
          <TicketCheck size={18} />
          <span>当前有 {stats.openTickets} 个待处理工单</span>
          <strong>前往处理</strong>
        </Link>
      ) : null}

      <section className="v2-block">
        <header className="v2-block-header">
          <h2>最近注册用户</h2>
          <Link className="table-link" href="/admin/users">查看全部</Link>
        </header>
        <div className="table-wrap">
          <table className="v2-table">
            <thead><tr><th>用户</th><th>角色</th><th>套餐</th><th>状态</th><th>注册时间</th></tr></thead>
            <tbody>
              {recentUsers.length ? recentUsers.map((user) => (
                <tr key={user.id}>
                  <td>{user.nickname}<small>{user.email}</small></td>
                  <td>{user.role === "admin" ? "管理员" : "用户"}</td>
                  <td>{user.planName}</td>
                  <td><span className={`v2-badge ${user.active ? "badge-success" : "badge-danger"}`}>{user.active ? "正常" : "停用"}</span></td>
                  <td>{user.createdAt}</td>
                </tr>
              )) : <tr><td colSpan={5} className="admin-empty">暂无用户数据</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="v2-block">
        <header className="v2-block-header">
          <h2>最近订单</h2>
          <Link className="table-link" href="/admin/orders">查看全部</Link>
        </header>
        <div className="table-wrap">
          <table className="v2-table">
            <thead><tr><th>订单号</th><th>用户</th><th>套餐</th><th>金额</th><th>状态</th><th>创建时间</th></tr></thead>
            <tbody>
              {recentOrders.length ? recentOrders.map((order) => (
                <tr key={order.id}>
                  <td className="mono">{order.tradeNo}</td>
                  <td>{order.email}</td>
                  <td>{order.planName}</td>
                  <td>{formatMoney(order.totalAmount)}</td>
                  <td><span className={`v2-badge ${order.status === 3 ? "badge-success" : order.status === 0 ? "badge-warning" : ""}`}>{orderStatus[order.status] ?? "未知"}</span></td>
                  <td>{order.createdAt}</td>
                </tr>
              )) : <tr><td colSpan={6} className="admin-empty">暂无订单数据</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </AdminPage>
  );
}
