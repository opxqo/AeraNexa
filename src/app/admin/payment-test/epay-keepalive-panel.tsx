"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CircleAlert, HeartPulse, RefreshCw, Save, Zap } from "lucide-react";
import type { EpayKeepaliveOverview } from "@/lib/server/payments/epay-keepalive";
import { getEpayKeepaliveOverviewAction, runEpayKeepaliveNowAction, saveEpayKeepaliveSettingsAction } from "./actions";

const BAN_AFTER_SECONDS = 5 * 24 * 3600;
/** 距封号期限少于这么久时标红。 */
const DANGER_SECONDS = 24 * 3600;

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} 秒`;
  if (s < 3600) return `${Math.floor(s / 60)} 分钟`;
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  if (!days) return `${hours} 小时`;
  return hours ? `${days} 天 ${hours} 小时` : `${days} 天`;
}

function Badge({ tone, children }: { tone: "success" | "warning" | "danger"; children: React.ReactNode }) {
  return <span className={`v2-badge badge-${tone}`}>{children}</span>;
}

function statusOf(o: EpayKeepaliveOverview): { tone: "success" | "warning" | "danger"; label: string } {
  if (o.configError || !o.channel) return { tone: "warning", label: "未配置" };
  if (!o.enabled) return { tone: "warning", label: "已停用" };
  if (o.banDeadlineInSeconds !== null && o.banDeadlineInSeconds <= 0) return { tone: "danger", label: "已超期" };
  if (!o.worker.alive || (o.worker.lastCheckAgoSeconds !== null && !o.worker.ok)) return { tone: "danger", label: "异常" };
  return { tone: "success", label: "保活中" };
}

/** 易支付商户保活：开关、间隔、当前进度与历史保活账单。 */
export function EpayKeepalivePanel({ initial }: { initial: EpayKeepaliveOverview }) {
  const [overview, setOverview] = useState(initial);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [hours, setHours] = useState(String(initial.intervalHours));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const status = statusOf(overview);
  const dirty = enabled !== overview.enabled || hours.trim() !== String(overview.intervalHours);
  const age = overview.lastBillAgoSeconds;
  const deadline = overview.banDeadlineInSeconds;
  const progress = age === null ? 0 : Math.min(100, (age / BAN_AFTER_SECONDS) * 100);
  const intervalMark = Math.min(100, ((overview.intervalHours * 3600) / BAN_AFTER_SECONDS) * 100);
  const deadlineTone = deadline === null ? "warning" : deadline <= DANGER_SECONDS ? "danger" : deadline <= 2 * DANGER_SECONDS ? "warning" : "success";

  const act = <T,>(task: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, done: (data: T) => void) => {
    setError("");
    setMessage("");
    startTransition(async () => {
      const result = await task();
      if (result.ok) done(result.data);
      else setError(result.error);
    });
  };

  const save = () => {
    const value = Number(hours);
    if (!Number.isInteger(value) || value < 6 || value > 96) {
      setError("下单间隔需为 6–96 之间的整数小时");
      return;
    }
    act(() => saveEpayKeepaliveSettingsAction(enabled, value), (data) => {
      setOverview(data);
      setEnabled(data.enabled);
      setHours(String(data.intervalHours));
      setMessage("已保存，worker 下一次检查时生效");
    });
  };

  const runNow = () => act(runEpayKeepaliveNowAction, (data) => {
    setOverview(data.overview);
    setMessage(data.summary);
  });

  const refresh = () => act(getEpayKeepaliveOverviewAction, setOverview);

  let nextLabel: string;
  if (!overview.enabled) nextLabel = "已停用，不会自动下单";
  else if (!overview.channel) nextLabel = "没有可用渠道";
  else if ((overview.nextDueInSeconds ?? 0) <= 0) nextLabel = "已到期，等待 worker 下一次检查（每小时）";
  else nextLabel = `${formatDuration(overview.nextDueInSeconds ?? 0)}后`;

  let workerLabel: React.ReactNode;
  if (!overview.worker.alive) workerLabel = <><Badge tone="danger">未运行</Badge> 请在服务器上运行 <code>pnpm worker</code></>;
  else if (overview.worker.lastCheckAgoSeconds === null) workerLabel = <><Badge tone="warning">尚未检查</Badge> 重启 worker 后生效</>;
  else if (!overview.worker.ok) workerLabel = <><Badge tone="danger">失败</Badge> {formatDuration(overview.worker.lastCheckAgoSeconds)}前 · {overview.worker.error}</>;
  else workerLabel = <><Badge tone="success">正常</Badge> {formatDuration(overview.worker.lastCheckAgoSeconds)}前 · {overview.worker.summary === "无变更" ? "未到下单时间" : overview.worker.summary}</>;

  return (
    <section className="v2-block epay-keepalive">
      <header className="v2-block-header">
        <div>
          <h2><HeartPulse size={17} /> 商户保活 <Badge tone={status.tone}>{status.label}</Badge></h2>
          <p className="admin-audit-note">渠道规定商户号连续 5 天没有账单会被封禁，未支付的白账单也算。启用后 worker 按间隔自动向网关下一笔 ¥1.00 的账单，只下单不付款，不建站内订单。</p>
        </div>
        <button type="button" className="button button-secondary" disabled={pending} onClick={refresh}><RefreshCw size={15} /> 刷新</button>
      </header>

      {overview.configError ? (
        <p className="admin-error-text"><CircleAlert size={14} /> {overview.configError}。<Link href="/admin/settings">去系统设置</Link></p>
      ) : !overview.channel ? (
        <p className="admin-error-text"><CircleAlert size={14} /> 没有配置齐全（商户密钥 + 回调域名）的易支付渠道，保活不会执行。<Link href="/admin/payments">去支付渠道</Link></p>
      ) : null}

      <div className="epay-keepalive-settings">
        <label className="epay-keepalive-switch">
          <input type="checkbox" role="switch" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          <span aria-hidden="true" />
          <b>{enabled ? "自动保活已启用" : "自动保活已停用"}</b>
        </label>
        <label className="v2-field epay-keepalive-hours">
          <span>下单间隔（小时）</span>
          <input value={hours} onChange={(event) => setHours(event.target.value)} inputMode="numeric" aria-label="下单间隔（小时）" />
        </label>
        <button type="button" className="button button-primary" disabled={pending || !dirty} onClick={save}><Save size={15} /> 保存</button>
        <button type="button" className="button button-secondary" disabled={pending || !overview.channel || Boolean(overview.configError)} onClick={runNow}>
          <Zap size={15} /> 立即补一张
        </button>
      </div>

      <div className="epay-keepalive-progress">
        <div className="epay-keepalive-progress-head">
          <span>距上一张账单 {age === null ? "—" : formatDuration(age)}</span>
          <span>封号期限 5 天</span>
        </div>
        <div className={`epay-keepalive-bar tone-${deadlineTone}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-label="距封号期限的进度">
          <i style={{ width: `${progress}%` }} />
          <em style={{ left: `${intervalMark}%` }} title={`第 ${overview.intervalHours} 小时自动下单`} />
        </div>
      </div>

      <dl className="epay-live-config">
        <div><dt>上一张保活账单</dt><dd>{age === null ? "从未创建" : `${formatDuration(age)}前`}</dd></div>
        <div><dt>下次自动下单</dt><dd>{nextLabel}</dd></div>
        <div>
          <dt>距封号期限</dt>
          <dd>{deadline === null ? <Badge tone="warning">未知（尚无保活账单）</Badge> : deadline <= 0 ? <Badge tone="danger">已超过 {formatDuration(-deadline)}</Badge> : <Badge tone={deadlineTone}>剩余 {formatDuration(deadline)}</Badge>}</dd>
        </div>
        <div><dt>使用渠道</dt><dd>{overview.channel ? <>{overview.channel.name} <span className="mono">{overview.channel.provider}</span>{overview.channel.enabled ? null : <> <Badge tone="warning">渠道停用</Badge></>}</> : "—"}</dd></div>
        <div><dt>worker 最近检查</dt><dd>{workerLabel}</dd></div>
      </dl>

      {message ? <p className="epay-live-result epay-keepalive-message"><Badge tone="success">完成</Badge> {message}</p> : null}
      {error ? <p className="admin-error-text" role="alert"><CircleAlert size={14} /> {error}</p> : null}

      {overview.history.length ? (
        <div className="table-wrap">
          <table className="v2-table">
            <thead><tr><th>时间</th><th>本站单号</th><th>渠道单号</th><th>渠道</th><th>触发</th></tr></thead>
            <tbody>
              {overview.history.map((bill) => (
                <tr key={bill.outTradeNo}>
                  <td>{bill.createdAt}</td>
                  <td className="mono">{bill.outTradeNo}</td>
                  <td className="mono">{bill.epayTradeNo || "—"}</td>
                  <td>{bill.channelName || "—"}</td>
                  <td>{bill.manual ? <Badge tone="warning">手动</Badge> : <Badge tone="success">自动</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="admin-audit-note epay-keepalive-empty">还没有保活账单。启用后 worker 会在一小时内下第一张，也可以点「立即补一张」马上验证。</p>
      )}
    </section>
  );
}
