"use client";

/**
 * 节点状态页 · 服务器实时状态区块。
 *
 * 数据来自 CF-Server-Monitor 探针，经服务端中继以 SSE 推送（/api/monitor/stream）：
 * 连上先收到 snapshot 全量，之后是 update 增量（探针有观看者时每 2 秒上报）。
 * 页面隐藏时断开数据流，让中继在无人观看时断开上游、探针回落空闲档。
 * 沿用门户 v2 设计语言：v2-block 外壳 + stat-grid 概览 + 卡片网格明细，支持明暗两套主题。
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Image from "next/image";
import { RefreshCw } from "lucide-react";
import {
  MONITOR_STREAM_URL,
  type MonitorSamplePoint,
  type MonitorServer,
  type MonitorServerDelta,
  type MonitorServersPayload,
  type MonitorStreamStatus,
} from "@/lib/api/monitor";
import { AsyncBoundary } from "@/components/api-ui";
import { MonitorIcon, type MonitorIconName } from "@/components/monitor-icons";

/** CFSM 判定在线的阈值：最近上报距今小于 5 分钟（source/CF-Server-Monitor）。 */
const ONLINE_THRESHOLD_MS = 300000;
/** 时钟刻度：用于在线判定、运行时长与「xx 秒前上报」。 */
const CLOCK_MS = 1000;
/** 中继在上游断线期间的兜底快照间隔（src/lib/server/monitor/relay.ts），用于提示文案。 */
const FALLBACK_REFRESH_S = 15;

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

/** 负载原始值形如 "0.12 0.08 0.05"，展示为逗号分隔。 */
function formatLoad(loadAvg: string | undefined): string {
  const parts = (loadAvg ?? "").trim().split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "—";
}

const REGION_NAMES =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["zh-CN"], { type: "region" })
    : null;

/** 探针 region 为 Cloudflare cf.country 两位 ISO 码，非法值不展示国旗。 */
function regionCode(region: string | undefined): string | null {
  const code = region?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) ? code : null;
}

function regionName(code: string): string {
  try {
    return REGION_NAMES?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** 图标文件来自 allsvgicons.com，存放在 public/os-icons；未命中的系统统一用 Linux 企鹅兜底。 */
const OS_ICONS: Array<[RegExp, string]> = [
  [/ubuntu|elementary/, "ubuntu"],
  [/debian/, "debian"],
  [/centos/, "centos"],
  [/rocky/, "rocky"],
  [/alma/, "alma"],
  [/fedora/, "fedora"],
  [/red ?hat|rhel/, "redhat"],
  [/alpine/, "alpine"],
  [/\barch/, "arch"],
  [/kali/, "kali"],
  [/openwrt|immortalwrt|istore|qwrt|kwrt/, "openwrt"],
  [/freebsd/, "freebsd"],
  [/windows|microsoft|win(?:10|11|32|64)/, "windows"],
];

function osIconSrc(os: string): string {
  const value = os.toLowerCase();
  const match = OS_ICONS.find(([pattern]) => pattern.test(value));
  return `/os-icons/${match ? match[1] : "linux"}.svg`;
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

function parseEvent<T>(event: Event): T | null {
  try {
    return JSON.parse(String((event as MessageEvent).data)) as T;
  } catch {
    return null;
  }
}

/** 合并 update 事件的增量；中继只推送已知节点，新节点会随下一次 snapshot 出现。 */
function applyDeltas(prev: MonitorServer[], deltas: MonitorServerDelta[]): MonitorServer[] {
  if (deltas.length === 0) return prev;
  const byId = new Map(deltas.map((delta) => [String(delta.id), delta]));
  return prev.map((server) => {
    const delta = byId.get(String(server.id));
    return delta ? { ...server, ...delta, id: server.id } : server;
  });
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
function LeaderRow({ icon, label, children }: { icon: MonitorIconName; label: string; children: ReactNode }) {
  return (
    <div className="monitor-row">
      <span className="monitor-row-label">
        <MonitorIcon name={icon} size={13} />
        {label}
      </span>
      <span className="monitor-row-leader" />
      <span className="monitor-row-value">{children}</span>
    </div>
  );
}

/** 2×2 指标块：标签 + 百分比 + 细进度条 + 说明副行。 */
function MetricBlock({
  icon,
  label,
  percentText,
  value,
  sub,
  subTitle,
  children,
}: {
  icon: MonitorIconName;
  label: string;
  percentText?: string;
  value?: number;
  sub?: ReactNode;
  subTitle?: string;
  children?: ReactNode;
}) {
  const level = value === undefined ? "" : usageLevel(value);
  return (
    <div className="monitor-mblock">
      <div className="monitor-mblock-top">
        <span>
          <MonitorIcon name={icon} size={13} />
          {label}
        </span>
        {percentText !== undefined && <b>{percentText}</b>}
      </div>
      {value === undefined ? (
        children ?? <div className="monitor-bar monitor-bar-empty" />
      ) : (
        <div className={`monitor-bar ${level}`}>
          <span style={{ width: `${value}%` }} />
        </div>
      )}
      {sub !== undefined && (
        <div className="monitor-mblock-sub" title={subTitle}>
          {sub}
        </div>
      )}
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

  // 优先用随推送每 2 秒更新的标量，历史序列只随快照刷新，作为兜底。
  const history = latestSample(server.ping);
  const ping =
    server.ping_ct !== undefined || server.ping_cu !== undefined || server.ping_cm !== undefined
      ? { ct: server.ping_ct ?? false, cu: server.ping_cu ?? false, cm: server.ping_cm ?? false }
      : history;
  const load = formatLoad(server.load_avg);
  const swapText =
    Number(server.swap_total) > 0 ? `Swap ${formatMb(server.swap_used)} / ${formatMb(server.swap_total)}` : undefined;
  const flag = regionCode(server.region);
  const osTitle = [server.os, server.arch].filter(Boolean).join(" · ");
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
          <span className={`monitor-dot${online ? " online" : ""}`} title={online ? "在线" : "离线"} />
          <strong title={server.name}>{server.name}</strong>
        </div>
        <div className="monitor-card-badges">
          {server.os && (
            <Image
              className="monitor-os-icon"
              src={osIconSrc(server.os)}
              alt={server.os}
              title={osTitle}
              width={16}
              height={16}
            />
          )}
          {flag && (
            <Image
              className="monitor-flag"
              src={`/flags/${flag.toLowerCase()}.svg`}
              alt={regionName(flag)}
              title={regionName(flag)}
              width={20}
              height={15}
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          )}
        </div>
      </header>

      <div className="monitor-card-body">
        <div className="monitor-metric-grid">
          <MetricBlock icon="cpu" label="CPU" percentText={`${cpu.toFixed(1)}%`} value={cpu} sub={load} subTitle="1 / 5 / 15 分钟负载" />
          <MetricBlock
            icon="memory"
            label="内存"
            percentText={`${ramPct.toFixed(1)}%`}
            value={ramPct}
            sub={`${formatMb(server.ram_used)} / ${formatMb(server.ram_total)}`}
            subTitle={swapText}
          />
          <MetricBlock
            icon="disk"
            label="硬盘"
            percentText={`${diskPct.toFixed(1)}%`}
            value={diskPct}
            sub={`${formatMb(server.disk_used)} / ${formatMb(server.disk_total)}`}
          />
          <MetricBlock
            icon="traffic"
            label="流量"
            percentText={limitBytes > 0 ? `${trafficPct.toFixed(1)}%` : undefined}
            value={limitBytes > 0 ? trafficPct : undefined}
            sub={
              <>
                {formatBytes(monthlyTotal)}
                {limitBytes > 0 ? ` / ${formatBytes(limitBytes)}` : " / ∞"}
              </>
            }
            subTitle={`本月 ↑ ${formatBytes(monthlyTx)} · ↓ ${formatBytes(monthlyRx)}`}
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

        <div className="monitor-card-lower">
          {!online && (
            <div className="monitor-offline-mask">
              <span>离线</span>
              <small>最近上报 {formatSampleTime(server.last_updated)}</small>
            </div>
          )}

          <div className={`monitor-rows${online ? "" : " is-blurred"}`}>
            <LeaderRow icon="activity" label="速率">
              <span className="monitor-speed">
                <em className="up" title="上行">
                  <MonitorIcon name="up" size={12} />
                  {formatSpeed(server.net_out_speed)}
                </em>
                <em className="down" title="下行">
                  <MonitorIcon name="down" size={12} />
                  {formatSpeed(server.net_in_speed)}
                </em>
              </span>
            </LeaderRow>
            <LeaderRow icon="clock" label="在线">
              {online ? formatUptime(server.boot_time) : "—"}
            </LeaderRow>
            <LeaderRow icon="signal" label="三网">
              {ping ? (
                <span className="monitor-tri">
                  {(
                    [
                      ["电信", ping.ct],
                      ["联通", ping.cu],
                      ["移动", ping.cm],
                    ] as const
                  ).map(([carrier, value], index) => (
                    <span key={carrier}>
                      {index > 0 && <b className="monitor-sep">·</b>}
                      <i className={latencyTone(sampleValue(value) ?? 999)} title={`${carrier} ${formatPing(value)}`}>
                        {formatPing(value)}
                      </i>
                    </span>
                  ))}
                </span>
              ) : (
                "N/A"
              )}
            </LeaderRow>
            <LeaderRow icon="server" label="配置">
              <span className="monitor-spec">
                <span title="1 分钟负载">
                  <MonitorIcon name="gauge" size={12} />
                  {load.split(",")[0]}
                </span>
                <span title="CPU 核心数">
                  <MonitorIcon name="cpu" size={12} />
                  {server.cpu_cores ?? "—"} 核
                </span>
                <span title="TCP 连接数">
                  <MonitorIcon name="plug" size={12} />
                  {server.tcp_conn ?? 0}
                </span>
              </span>
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
      </div>

      {(tags.length > 0 || server.last_updated) && (
        <footer className="monitor-card-foot">
          <div className="monitor-tags">
            {tags.map((tag) => (
              <span key={tag} className="monitor-tag">
                {tag}
              </span>
            ))}
          </div>
          {server.last_updated ? (
            <em className="monitor-card-age" title={`最近上报 ${formatSampleTime(server.last_updated)}`}>
              <MonitorIcon name="history" size={12} />
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
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const [loading, setLoading] = useState(true);
  const [streamOpen, setStreamOpen] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [upstream, setUpstream] = useState<MonitorStreamStatus>({ live: false, error: null });
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let source: EventSource | null = null;

    const touch = () => {
      const ts = Date.now();
      setUpdatedAt(ts);
      setNow(ts);
    };

    const close = () => {
      if (!source) return;
      source.close();
      source = null;
      setStreamOpen(false);
    };

    const open = () => {
      if (source) return;
      const es = new EventSource(MONITOR_STREAM_URL);
      source = es;
      es.onopen = () => {
        setStreamOpen(true);
        setStreamError(null);
      };
      es.addEventListener("snapshot", (event) => {
        const payload = parseEvent<MonitorServersPayload>(event);
        if (!payload) return;
        setServers(Array.isArray(payload.servers) ? payload.servers : []);
        setHasSnapshot(true);
        setLoading(false);
        touch();
      });
      es.addEventListener("update", (event) => {
        const deltas = parseEvent<MonitorServerDelta[]>(event);
        if (!Array.isArray(deltas)) return;
        setServers((prev) => applyDeltas(prev, deltas));
        touch();
      });
      es.addEventListener("status", (event) => {
        const status = parseEvent<MonitorStreamStatus>(event);
        if (status) setUpstream({ live: status.live === true, error: status.error ?? null });
      });
      // CONNECTING 时浏览器会自动重连；CLOSED 表示服务端拒绝（如登录失效），需手动刷新。
      es.onerror = () => {
        setStreamOpen(false);
        if (es.readyState === EventSource.CLOSED) {
          setStreamError("实时数据流已断开，请点击刷新重试");
          setLoading(false);
          close();
        }
      };
    };

    // 页面隐藏时断开：无人观看时中继会断开上游，探针回落空闲上报档。
    const onVisibility = () => {
      if (document.hidden) close();
      else open();
    };

    if (!document.hidden) open();
    document.addEventListener("visibilitychange", onVisibility);
    const clockTimer = window.setInterval(() => setNow(Date.now()), CLOCK_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(clockTimer);
      close();
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

  // 概览直接由本地节点实时汇总，收到增量后即刻变化，不依赖快照 stats。
  const total = servers.length;
  const onlineCount = servers.filter((server) => isOnline(server, now)).length;
  const offlineCount = Math.max(0, total - onlineCount);
  const globalIn = servers.reduce((sum, server) => sum + (server.net_in_speed ?? 0), 0);
  const globalOut = servers.reduce((sum, server) => sum + (server.net_out_speed ?? 0), 0);

  // 徽章：首份快照前「连接中」；数据流与上游实时通道都正常为 LIVE；
  // 上游断线时中继每 15 秒兜底刷新显示「轮询」；与本站的数据流断开显示「断开」。
  const badgeState = !hasSnapshot ? "connecting" : streamOpen && upstream.live ? "live" : "stale";
  const badgeText =
    badgeState === "live" ? "LIVE" : badgeState === "connecting" ? "连接中" : streamOpen ? "轮询" : "断开";
  const badgeTitle =
    badgeState === "connecting"
      ? "正在连接探针..."
      : badgeState === "live"
        ? "探针实时推送中，约每 2 秒更新"
        : streamOpen
          ? `${upstream.error ?? "上游实时通道不可用"}，每 ${FALLBACK_REFRESH_S} 秒刷新一次`
          : (streamError ?? "与服务器的连接已断开，正在重连...");
  const boundaryError = servers.length === 0 ? (streamError ?? (hasSnapshot ? null : upstream.error)) : null;

  return (
    <section className="v2-block">
      <header className="v2-block-header" style={{ justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <h2>服务器实时状态</h2>
          <span className={`monitor-live${badgeState === "live" ? "" : ` ${badgeState}`}`} title={badgeTitle}>
            <span className="monitor-live-dot" />
            {badgeText}
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
        loading={loading && !hasSnapshot && !boundaryError}
        error={boundaryError}
        onRetry={reload}
        loadingText="正在拉取服务器实时状态..."
        empty={hasSnapshot && total === 0 ? "探针暂无上报的服务器。" : undefined}
      >
        <div className="stat-grid monitor-overview">
          <article>
            <MonitorIcon name="server" size={20} className="monitor-stat-icon" />
            <small>节点总数</small>
            <strong>{total}</strong>
          </article>
          <article>
            <MonitorIcon name="activity" size={20} className="monitor-stat-icon" />
            <small>在线 / 离线</small>
            <strong>
              <span className="monitor-online-num">{onlineCount}</span>
              <span className="monitor-offline-num"> / {offlineCount}</span>
            </strong>
          </article>
          <article>
            <MonitorIcon name="worldDown" size={20} className="monitor-stat-icon" />
            <small>全球下行</small>
            <strong>{formatSpeed(globalIn)}</strong>
          </article>
          <article>
            <MonitorIcon name="worldUp" size={20} className="monitor-stat-icon" />
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
