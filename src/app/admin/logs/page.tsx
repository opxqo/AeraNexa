import Link from "next/link";
import { requireAdminUser } from "@/lib/server/admin";
import { loadLogAlerts, loadLogRows, loadLogSettings, type LogFilters } from "@/lib/server/log-query";
import { LOG_CATEGORIES, LOG_CATEGORY_LABELS } from "@/lib/server/runtime-logs";
import { LOG_CATEGORY_LABELS_ZH, LOG_LEVEL_LABELS } from "@/lib/log-descriptions";
import { LOG_EXPORT_LIMIT } from "@/lib/log-export";
import { saveLogCaptureSettingsAction } from "./actions";
import { AdminPage, AdminTabs } from "@/components/admin-page";

export const dynamic = "force-dynamic";

const views = [
  { id: "audit", label: "操作审计" }, { id: "access", label: "请求访问" },
  { id: "runtime", label: "运行事件" }, { id: "alerts", label: "告警状态" },
  { id: "settings", label: "监控开关" },
] as const;

function first(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }

export default async function AdminLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminUser();
  const params = await searchParams;
  const requested = first(params.view);
  const view = views.find((item) => item.id === requested)?.id ?? "audit";
  const page = Math.min(1000, Math.max(1, Number.parseInt(first(params.page), 10) || 1));
  const filters: LogFilters = {
    view, page, from: first(params.from), to: first(params.to), category: first(params.category),
    level: first(params.level), actor: first(params.actor), path: first(params.path), requestId: first(params.requestId),
  };
  const listing = view === "audit" || view === "access" || view === "runtime" ? await loadLogRows(filters) : null;
  const alerts = view === "alerts" ? await loadLogAlerts() : null;
  const settings = view === "settings" ? await loadLogSettings() : null;
  const pageHref = (next: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...filters, page: String(next) })) {
      if (value && key !== "view") query.set(key, String(value));
    }
    query.set("view", view);
    return `/admin/logs?${query.toString()}`;
  };

  const tabs = views.map((item) => ({ key: item.id, label: item.label, href: `/admin/logs?view=${item.id}` }));
  return <AdminPage title="日志中心" description="查询操作审计、请求和服务运行记录；事件附有中文解释，原始代码可用于精确排查。" tabs={<AdminTabs tabs={tabs} active={view} label="日志类别" />}>

    {listing ? <>
      <form className="v2-block log-filter" method="get" action="/admin/logs">
        <input type="hidden" name="view" value={view} />
        <label>开始时间<input type="datetime-local" name="from" defaultValue={filters.from} /></label>
        <label>结束时间<input type="datetime-local" name="to" defaultValue={filters.to} /></label>
        {view !== "audit" ? <>
          <label>类别<select name="category" defaultValue={filters.category}><option value="">全部</option>{LOG_CATEGORIES.map((category) => <option key={category} value={category}>{LOG_CATEGORY_LABELS[category]}</option>)}</select></label>
          <label>级别<select name="level" defaultValue={filters.level}><option value="">全部</option><option value="info">信息</option><option value="warn">警告</option><option value="error">错误</option></select></label>
        </> : null}
        <label>操作者<input name="actor" defaultValue={filters.actor} placeholder="邮箱或昵称" maxLength={80} /></label>
        <label>路径<input name="path" defaultValue={filters.path} placeholder="请求路径" maxLength={100} /></label>
        <label>请求 ID<input name="requestId" defaultValue={filters.requestId} placeholder="关联 ID" maxLength={36} /></label>
        <button className="button button-primary" type="submit">筛选</button>
        <Link href={`/admin/logs?view=${view}`} className="button button-secondary">重置</Link>
        <button className="button button-secondary" type="submit" formAction="/api/admin/logs/export">导出筛选结果 CSV</button>
        <span className="log-export-hint">不受当前页限制，最多 {LOG_EXPORT_LIMIT.toLocaleString("zh-CN")} 条</span>
      </form>
      <section className="v2-block"><div className="table-wrap"><table className="v2-table log-table"><thead><tr><th>时间</th><th>来源 / 级别</th><th>事件与中文解释</th><th>操作者</th><th>请求</th><th>结果</th><th>详情</th></tr></thead><tbody>
        {listing.rows.length ? listing.rows.map((row) => <tr key={row.id}>
          <td className="log-time">{row.createdAt}</td>
          <td>{row.service}<small>{LOG_CATEGORY_LABELS_ZH[row.category] ?? row.category} · {LOG_LEVEL_LABELS[row.level] ?? row.level}</small></td>
          <td><strong>{row.explanation}</strong><small className="mono">{row.eventCode}</small>{row.message ? <small className="log-message">{row.message}</small> : null}</td>
          <td>{row.actor || "—"}</td>
          <td><span className="mono">{row.method} {row.path || "—"}</span>{row.requestId ? <small className="mono">{row.requestId}</small> : null}</td>
          <td>{row.status || "—"}<small>{row.duration}</small></td>
          <td>{row.details && row.details !== "null" ? <details><summary>查看</summary><pre>{row.details}</pre></details> : "—"}</td>
        </tr>) : <tr><td colSpan={7} className="admin-empty">当前条件下没有日志</td></tr>}
      </tbody></table></div></section>
      <div className="admin-list-pager"><span>共 {listing.total} 条 · 第 {page} 页</span><div className="admin-pager">{page > 1 ? <Link href={pageHref(page - 1)}>上一页</Link> : <span>上一页</span>}{page * listing.pageSize < listing.total ? <Link href={pageHref(page + 1)}>下一页</Link> : <span>下一页</span>}</div></div>
    </> : null}

    {alerts ? <div className="log-alert-grid">
      <StatusCard label="应用错误（15 分钟）" count={alerts.errors} active={alerts.errors >= 5} />
      <StatusCard label="慢请求（15 分钟）" count={alerts.slow} active={alerts.slow >= 10} />
      <StatusCard label="支付错误（15 分钟）" count={alerts.payment} active={alerts.payment > 0} />
      <StatusCard label="Bot 错误（15 分钟）" count={alerts.bot} active={alerts.bot > 0} />
      <StatusCard label="Worker 心跳" count={alerts.workerStale ? `超过 ${alerts.workerStaleAfter} 秒未完成任务` : "正常"} active={alerts.workerStale} />
      <section className="v2-block log-health"><h2>日志采集状态</h2>{alerts.ingestion.length ? alerts.ingestion.map((item) => <p key={item.service}><strong>{item.service}</strong> · {item.healthy ? "正常" : "写入异常"} · 丢弃 {item.dropped} 条{item.error ? ` · ${item.error}` : ""}</p>) : <p>尚无采集状态记录</p>}</section>
    </div> : null}

    {settings ? <section className="v2-block log-settings"><h2>监控开关</h2><p>调整后各服务最多约 5 秒生效。关键操作审计始终启用。</p><form action={saveLogCaptureSettingsAction}>{LOG_CATEGORIES.map((category) => <label key={category}><input type="checkbox" name={category} defaultChecked={settings[category]} /><span>{LOG_CATEGORY_LABELS[category]}</span></label>)}<button className="button button-primary" type="submit">保存监控设置</button></form></section> : null}
  </AdminPage>;
}

function StatusCard({ label, count, active }: { label: string; count: number | string; active: boolean }) {
  return <article className={`v2-block log-alert-card ${active ? "warning" : ""}`}><span>{label}</span><strong>{count}</strong><small>{active ? "需要关注" : "正常"}</small></article>;
}
