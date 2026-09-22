"use client";

/**
 * 节点状态页 · 服务器实时状态区块。
 *
 * 数据来自 CF-Server-Monitor 探针（经服务端 /api/monitor 代理，只读、不含凭据）。
 * 沿用门户 v2 设计语言：v2-block 外壳 + stat-grid 概览 + 卡片网格明细，
 * 支持明暗两套主题。轮询刷新以兼容公开模式与管理员 JWT 模式（后者不能下发 WS 凭据）。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Cpu, RefreshCw } from "lucide-react";
import {
  monitorApi,
  type MonitorBatchUpdateMessage,
  type MonitorSamplePoint,
  type MonitorServer,
} from "@/lib/api/monitor";
import { AsyncBoundary, toErrorMessage } from "@/components/api-ui";

/** CFSM 判定在线的阈值：最近上报距今小于 5 分钟（source/CF-Server-Monitor）。 */
const ONLINE_THRESHOLD_MS = 300000;
/**
 * 全量轮询间隔。探针 agent 上报间隔约 10~60s 且 WS 推送对新订阅者不投递
 * （实测同源/跨域均只收到 hello），轮询是唯一可靠通道，2s 足以贴住每次上报。
 */
const POLL_MS = 2000;
/** 时钟刻度：用于在线判定、运行时长与实时通道活性判定。 */
const CLOCK_MS = 2000;
/** 超过该时长没有收到 WS 推送即认为实时通道不可用，回退轮询。 */
const WS_LIVE_WINDOW_MS = 10000;

/* -------------------------------------------------------------------------
   格式化
------------------------------------------------------------------------- */

function formatBytes(bytes: number | null | undefined): string {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const scaled = value / 1024 ** index;
  return `${scaled >= 100 || index === 0 ? Math.round(scaled) : scaled.toFixed(scaled >= 10 ? 1 : 2)} ${units[index]}`;
}

function formatSpeed(bytesPerSecond: number | null | undefined): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** 容量字段单位为 MB，展示时按大小自适应到 GB/MB。 */
function formatMb(mb: number | null | undefined): string {
  const value = Number(mb);
  if (!Number.isFinite(value) || value <= 0) return "0 MB";
  if (value >= 1024) return `${(value / 1024).toFixed(value >= 10240 ? 0 : 1)} GB`;
  return `${Math.round(value)} MB`;
}

function formatUptime(bootTime: string | number | undefined): string {
  const boot = Number(bootTime);
  if (!Number.isFinite(boot) || boot <= 0) return "—";
  const ms = Date.now() - boot;
  if (ms < 0) return "—";
  const minutes = Math.floor(ms / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes % 60} 分`;
  return `${minutes} 分钟`;
}

/** 数据新鲜度：距最近一次 agent 上报的时长。探针上报间隔 10~60s，用于解释数值为何不逐秒变化。 */
function formatReportAge(deltaMs: number): string {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return "刚刚上报";
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 5) return "刚刚上报";
  if (seconds < 60) return `${seconds}s 前上报`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m 前上报`;
  return `${Math.floor(minutes / 60)}h 前上报`;
}

/** 采样值可能为 false（无数据）。 */
function sampleValue(value: number | false | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatPing(value: number | false | undefined): string {
  const parsed = sampleValue(value);
  return parsed === null ? "—" : `${Math.round(parsed)} ms`;
}

function usageLevel(percent: number): "" | "warn" | "danger" {
  if (percent >= 90) return "danger";
  if (percent >= 75) return "warn";
  return "";
}

function percent(used?: number, total?: number): number {
  const u = Number(used);
  const t = Number(total);
  if (!Number.isFinite(u) || !Number.isFinite(t) || t <= 0) return 0;
  return Math.min(100, Math.max(0, (u / t) * 100));
}

function isOnline(server: MonitorServer, now: number): boolean {
  const last = Number(server.last_updated);
  return Number.isFinite(last) && last > 0 && now - last < ONLINE_THRESHOLD_MS;
}

/** 取延迟采样序列末位（最新一次）。 */
function latestSample(points?: MonitorSamplePoint[]): MonitorSamplePoint | null {
  if (!Array.isArray(points) || points.length === 0) return null;
  return points[points.length - 1];
}

/**
 * 把 WS batchUpdate 推送合并进本地节点列表。
 * 推送只携带变化的指标字段，因此按 id 做浅合并覆盖，保持原有顺序，
 * 未知节点（新上线）追加到末尾，等下一次全量对账补全名称等静态字段。
 */
function applyBatchUpdate(prev: MonitorServer[], message: MonitorBatchUpdateMessage): MonitorServer[] {
  const updates = Array.isArray(message.updates) ? message.updates : [];
  if (updates.length === 0) return prev;

  const byId = new Map(prev.map((server) => [server.id, server]));
  let changed = false;

  for (const update of updates) {
    if (!update || !update.serverId) continue;
    const samples = Array.isArray(update.samples) ? update.samples : [];
    if (samples.length === 0) continue;
    const last = samples[samples.length - 1];
    const data = last?.data;
    if (!data || typeof data !== "object") continue;

    const sampleTs =
      typeof last.ts === "number"
        ? last.ts
        : typeof (data as Record<string, unknown>).last_updated === "number"
          ? ((data as Record<string, unknown>).last_updated as number)
          : Date.now();

    const existing = byId.get(update.serverId);
    const merged: MonitorServer = {
      ...(existing ?? ({ id: update.serverId, name: update.serverId } as MonitorServer)),
      ...(data as Partial<MonitorServer>),
      id: update.serverId,
      last_updated: sampleTs,
    };
    byId.set(update.serverId, merged);
    changed = true;
  }

  if (!changed) return prev;

  const ordered = prev.map((server) => byId.get(server.id) ?? server);
  const known = new Set(prev.map((server) => server.id));
  for (const [id, server] of byId) {
    if (!known.has(id)) ordered.push(server);
  }
  return ordered;
}

/* -------------------------------------------------------------------------
   子组件
------------------------------------------------------------------------- */

/** 格式化采样点时间戳为 HH:MM:SS，用于柱状图 tooltip。 */
function formatSampleTime(ts: number | undefined): string {
  const value = Number(ts);
  if (!Number.isFinite(value) || value <= 0) return "--:--:--";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** 单个采样点的三网均值（电信/联通/移动），全部缺失时返回 null。 */
function pointAverage(point: MonitorSamplePoint): number | null {
  const values = [point.ct, point.cu, point.cm]
    .map(sampleValue)
    .filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function latencyTone(ms: number): string {
  if (ms <= 80) return "tone-good";
  if (ms <= 160) return "tone-mid";
  if (ms <= 260) return "tone-warn";
  return "tone-bad";
}

function lossTone(loss: number): string {
  if (loss <= 1) return "tone-good";
  if (loss <= 5) return "tone-mid";
  if (loss <= 15) return "tone-warn";
  return "tone-bad";
}

type PingBar = { key: number; height: number; tone: string; title: string };

/** 延迟柱：按序列最大值归一化高度（保底 120ms 量程），颜色分级。 */
function buildLatencyBars(points?: MonitorSamplePoint[]): { bars: PingBar[]; avg: number | null } {
  if (!Array.isArray(points) || points.length === 0) return { bars: [], avg: null };
  const values = points.map((point) => pointAverage(point));
  const numeric = values.filter((value): value is number => value !== null);
  if (numeric.length === 0) return { bars: [], avg: null };
  const max = Math.max(120, ...numeric);
  const bars = values.map((value, index) =>
    value === null
      ? { key: index, height: 4, tone: "tone-none", title: `${formatSampleTime(points[index]?.ts)} 无响应` }
      : {
          key: index,
          height: Math.max(8, Math.round((value / max) * 100)),
          tone: latencyTone(value),
          title: `${formatSampleTime(points[index]?.ts)} ${Math.round(value)} ms`,
        },
  );
  const avg = numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
  return { bars, avg };
}

/** 丢包柱：直接以百分比为高度（0–100%），颜色分级。 */
function buildLossBars(points?: MonitorSamplePoint[]): { bars: PingBar[]; avg: number | null } {
  if (!Array.isArray(points) || points.length === 0) return { bars: [], avg: null };
  const values = points.map((point) => pointAverage(point));
  const numeric = values.filter((value): value is number => value !== null);
  if (numeric.length === 0) return { bars: [], avg: null };
  const bars = values.map((value, index) =>
    value === null
      ? { key: index, height: 4, tone: "tone-none", title: `${formatSampleTime(points[index]?.ts)} 无数据` }
      : {
          key: index,
          height: Math.max(12, Math.min(100, Math.round(value))),
          tone: lossTone(value),
          title: `${formatSampleTime(points[index]?.ts)} ${value.toFixed(1)}%`,
        },
  );
  const avg = numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
  return { bars, avg };
}

/** 带标签、点状引导线与右侧取值的明细行（参考主题 NodeCard 的信息层级）。 */
function LeaderRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="monitor-row">
      <span className="monitor-row-label">{label}</span>
      <span className="monitor-row-leader" />
      <span className="monitor-row-value">{children}</span>
    </div>
  );
}

/** 2×2 指标块：标签 + 百分比 + 细进度条 + 说明副行。 */
function MetricBlock({
  label,
  percentText,
  value,
  sub,
  children,
}: {
  label: string;
  percentText?: string;
  value?: number;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  const level = value === undefined ? "" : usageLevel(value);
  return (
    <div className="monitor-mblock">
      <div className="monitor-mblock-top">
        <span>{label}</span>
        {percentText !== undefined && <b>{percentText}</b>}
      </div>
      {value === undefined ? (
        children ?? <div className="monitor-bar monitor-bar-empty" />
      ) : (
        <div className={`monitor-bar ${level}`}>
          <span style={{ width: `${value}%` }} />
        </div>
      )}
      {sub !== undefined && <div className="monitor-mblock-sub">{sub}</div>}
    </div>
  );
}

function ServerCard({ server, now }: { server: MonitorServer; now: number }) {
  const online = isOnline(server, now);
  const cpu = Number.isFinite(server.cpu) ? Math.max(0, Math.min(100, server.cpu ?? 0)) : 0;
  const ramPct = percent(server.ram_used, server.ram_total);
  const diskPct = percent(server.disk_used, server.disk_total);

  const monthlyRx = server.net_rx_monthly ?? 0;
  const monthlyTx = server.net_tx_monthly ?? 0;
  const monthlyTotal = monthlyRx + monthlyTx;
  // CFSM 下发的 traffic_limit 为字符串（如 "2048.0"），单位 GB，需先转数值。
  const limitGb = Number(server.traffic_limit);
  const limitBytes = Number.isFinite(limitGb) && limitGb > 0 ? limitGb * 1024 ** 3 : 0;
  const trafficPct = limitBytes > 0 ? Math.min(100, (monthlyTotal / limitBytes) * 100) : 0;

  const ping = latestSample(server.ping);
  const load = server.load_avg?.trim() || "—";
  const latency = buildLatencyBars(server.ping);
  const loss = buildLossBars(server.loss);
  const showPingPanels = latency.bars.length > 0 || loss.bars.length > 0;
  const tags = (server.tags ?? "")
    .split(/[,，\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);

  return (
    <article className={`monitor-card${online ? "" : " offline"}`}>
      <header className="monitor-card-head">
        <div className="monitor-card-title">
          <span className={`monitor-dot${online ? " online" : ""}`} />
          <strong title={server.name}>{server.name}</strong>
        </div>
        <div className="monitor-card-badges">
          {server.region && <span className="v2-badge">{server.region}</span>}
          <span className={`v2-badge ${online ? "badge-success" : "badge-danger"}`}>{online ? "在线" : "离线"}</span>
        </div>
      </header>

      <div className="monitor-card-body">
        {!online && (
          <div className="monitor-offline-mask">
            <span>离线</span>
            <small>最近上报 {formatSampleTime(server.last_updated)}</small>
          </div>
        )}

        <div className={`monitor-metric-grid${online ? "" : " is-blurred"}`}>
          <MetricBlock label="CPU" percentText={`${cpu.toFixed(1)}%`} value={cpu} sub={load} />
          <MetricBlock
            label="内存"
            percentText={`${ramPct.toFixed(1)}%`}
            value={ramPct}
            sub={`${formatMb(server.ram_used)} / ${formatMb(server.ram_total)}`}
          />
          <MetricBlock
            label="硬盘"
            percentText={`${diskPct.toFixed(1)}%`}
            value={diskPct}
            sub={`${formatMb(server.disk_used)} / ${formatMb(server.disk_total)}`}
          />
          <MetricBlock
            label="流量"
            percentText={limitBytes > 0 ? `${trafficPct.toFixed(1)}%` : undefined}
            value={limitBytes > 0 ? trafficPct : undefined}
            sub={
              <>
                {formatBytes(monthlyTotal)}
                {limitBytes > 0 ? ` / ${formatBytes(limitBytes)}` : " / ∞"}
              </>
            }
          >
            <div className="monitor-bar monitor-bar-split">
              <span
                className="down"
                style={{ width: `${monthlyTotal > 0 ? (monthlyRx / monthlyTotal) * 100 : 50}%` }}
              />
              <span
                className="up"
                style={{ width: `${monthlyTotal > 0 ? (monthlyTx / monthlyTotal) * 100 : 50}%` }}
              />
            </div>
          </MetricBlock>
        </div>

        <div className={`monitor-rows${online ? "" : " is-blurred"}`}>
          <LeaderRow label="速率">
            <span className="monitor-speed">
              <em className="down">↓ {formatSpeed(server.net_in_speed)}</em>
              <em className="up">↑ {formatSpeed(server.net_out_speed)}</em>
            </span>
          </LeaderRow>
          <LeaderRow label="在线">{online ? formatUptime(server.boot_time) : "—"}</LeaderRow>
          <LeaderRow label="三网">
            {ping ? (
              <span className="monitor-tri">
                <i className={latencyTone(sampleValue(ping.ct) ?? 999)}>{formatPing(ping.ct)}</i>
                <i className={latencyTone(sampleValue(ping.cu) ?? 999)}>{formatPing(ping.cu)}</i>
                <i className={latencyTone(sampleValue(ping.cm) ?? 999)}>{formatPing(ping.cm)}</i>
              </span>
            ) : (
              "N/A"
            )}
          </LeaderRow>
          <LeaderRow label="配置">
            {`${load} · ${server.cpu_cores ?? "—"} 核 · TCP ${server.tcp_conn ?? 0}`}
          </LeaderRow>
        </div>

        {showPingPanels && (
          <div className={`monitor-panels${online ? "" : " is-blurred"}`}>
            <div className="monitor-panel">
              <div className="monitor-panel-head">
                <span>延迟</span>
                <span className="monitor-row-leader" />
                <b>{latency.avg === null ? "—" : `${Math.round(latency.avg)} ms`}</b>
              </div>
              <div className="monitor-panel-bars">
                {latency.bars.map((bar) => (
                  <span
                    key={bar.key}
                    className={`monitor-pbar ${bar.tone}`}
                    style={{ height: `${bar.height}%` }}
                    title={bar.title}
                  />
                ))}
              </div>
            </div>
            <div className="monitor-panel">
              <div className="monitor-panel-head">
                <span>丢包</span>
                <span className="monitor-row-leader" />
                <b>{loss.avg === null ? "—" : `${loss.avg.toFixed(1)}%`}</b>
              </div>
              <div className="monitor-panel-bars">
                {loss.bars.map((bar) => (
                  <span
                    key={bar.key}
                    className={`monitor-pbar ${bar.tone}`}
                    style={{ height: `${bar.height}%` }}
                    title={bar.title}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {tags.length > 0 && (
        <div className="monitor-tags">
          {tags.map((tag) => (
            <span key={tag} className="v2-badge">
              {tag}
            </span>
          ))}
        </div>
      )}

      {(server.os || server.arch || server.last_updated) && (
        <footer className="monitor-card-foot">
          <Cpu size={12} />
          <span>{[server.os, server.arch].filter(Boolean).join(" · ")}</span>
          {server.last_updated ? (
            <em className="monitor-card-age" title={`最近上报 ${formatSampleTime(server.last_updated)}`}>
              {formatReportAge(now - Number(server.last_updated))}
            </em>
          ) : null}
        </footer>
      )}
    </article>
  );
}

/* -------------------------------------------------------------------------
   主区块
------------------------------------------------------------------------- */

export function ServerStatusSection() {
  const [servers, setServers] = useState<MonitorServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [version, setVersion] = useState(0);

  const liveRef = useRef(false);
  const lastPushRef = useRef(0);

  const setLiveBoth = (value: boolean) => {
    liveRef.current = value;
    setLive(value);
  };

  useEffect(() => {
    let alive = true;
    let ws: WebSocket | null = null;

    const loadSnapshot = async () => {
      try {
        const payload = await monitorApi.getServers();
        if (!alive) return;
        setServers(payload && Array.isArray(payload.servers) ? payload.servers : []);
        setError(null);
        setUpdatedAt(Date.now());
        setNow(Date.now());
      } catch (err) {
        if (!alive) return;
        setError(toErrorMessage(err, "服务器状态加载失败，请稍后重试"));
      } finally {
        if (alive) setLoading(false);
      }
    };

    // 公开模式尝试直连探针 WS 作为「加速通道」：有推送时立即合并。
    // 但部分部署（跨域订阅、实时广播门未开启）只发 hello 不发指标，
    // 因此不以 onopen 判定可用，只有真正收到 batchUpdate 才算 LIVE；
    // 收不到推送时由下面的轮询兜底保证数据新鲜。JWT 模式 getWsUrl 返回 null，直接轮询。
    const connectWs = async () => {
      let url: string | null = null;
      try {
        url = await monitorApi.getWsUrl();
      } catch {
        url = null;
      }
      if (!alive || !url || typeof WebSocket === "undefined") return;
      try {
        ws = new WebSocket(url);
      } catch {
        ws = null;
        return;
      }
      ws.onmessage = (event) => {
        if (!alive) return;
        let message: MonitorBatchUpdateMessage | null = null;
        try {
          message = JSON.parse(String(event.data)) as MonitorBatchUpdateMessage;
        } catch {
          return;
        }
        if (!message || message.type !== "batchUpdate") return;
        setServers((prev) => applyBatchUpdate(prev, message as MonitorBatchUpdateMessage));
        setNow(Date.now());
        setUpdatedAt(Date.now());
        lastPushRef.current = Date.now();
        if (!liveRef.current) setLiveBoth(true);
      };
      const drop = () => {
        if (alive) setLiveBoth(false);
      };
      ws.onclose = drop;
      ws.onerror = drop;
    };

    void loadSnapshot();
    void connectWs();

    // 轮询为数据新鲜度的保底通道；实时推送活跃时暂停轮询避免重复请求。
    const pollTimer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (liveRef.current) return;
      void loadSnapshot();
    }, POLL_MS);

    // 时钟刻度：刷新在线判定/运行时长，并检测实时通道是否已静默失效。
    const clockTimer = window.setInterval(() => {
      if (!alive) return;
      setNow(Date.now());
      if (liveRef.current && Date.now() - lastPushRef.current > WS_LIVE_WINDOW_MS) {
        setLiveBoth(false);
      }
    }, CLOCK_MS);

    return () => {
      alive = false;
      clearInterval(pollTimer);
      clearInterval(clockTimer);
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        try {
          ws.close();
        } catch {
          // 忽略关闭异常
        }
      }
    };
  }, [version]);

  const reload = useCallback(() => {
    setLoading(true);
    setVersion((value) => value + 1);
  }, []);

  const sortedServers = useMemo(
    () =>
      [...servers].sort((a, b) => {
        const onlineDiff = Number(isOnline(b, now)) - Number(isOnline(a, now));
        if (onlineDiff !== 0) return onlineDiff;
        return (a.sort_order ?? 0) - (b.sort_order ?? 0);
      }),
    [servers, now],
  );

  // 概览直接由本地节点实时汇总，WS 推送后即刻变化，不依赖快照 stats。
  const total = servers.length;
  const onlineCount = servers.filter((server) => isOnline(server, now)).length;
  const offlineCount = Math.max(0, total - onlineCount);
  const globalIn = servers.reduce((sum, server) => sum + (server.net_in_speed ?? 0), 0);
  const globalOut = servers.reduce((sum, server) => sum + (server.net_out_speed ?? 0), 0);

  return (
    <section className="v2-block">
      <header className="v2-block-header" style={{ justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <h2>服务器实时状态</h2>
          <span
            className={`monitor-live${live ? "" : " polling"}`}
            title={live ? "探针实时推送已连接" : `实时推送不可用，每 ${POLL_MS / 1000} 秒轮询刷新`}
          >
            <span className="monitor-live-dot" />
            {live ? "LIVE" : "轮询"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {updatedAt !== null && (
            <span className="monitor-updated">
              更新于 {new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
          <button type="button" className="btn btn-secondary btn-sm" onClick={reload} disabled={loading}>
            <RefreshCw size={13} className={loading ? "animate-spin" : undefined} />
            <span>刷新</span>
          </button>
        </div>
      </header>

      <AsyncBoundary
        loading={loading && servers.length === 0}
        error={servers.length === 0 ? error : null}
        onRetry={reload}
        loadingText="正在拉取服务器实时状态..."
        empty={total === 0 ? "探针暂无上报的服务器。" : undefined}
      >
        <div className="stat-grid monitor-overview">
          <article>
            <small>节点总数</small>
            <strong>{total}</strong>
          </article>
          <article>
            <small>在线 / 离线</small>
            <strong>
              <span className="monitor-online-num">{onlineCount}</span>
              <span className="monitor-offline-num"> / {offlineCount}</span>
            </strong>
          </article>
          <article>
            <small>全球下行</small>
            <strong>{formatSpeed(globalIn)}</strong>
          </article>
          <article>
            <small>全球上行</small>
            <strong>{formatSpeed(globalOut)}</strong>
          </article>
        </div>

        <div className="monitor-grid">
          {sortedServers.map((server) => (
            <ServerCard key={server.id} server={server} now={now} />
          ))}
        </div>
      </AsyncBoundary>
    </section>
  );
}
