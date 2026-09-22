import "server-only";

import { buildRelayWsUrl, invalidateMonitorAuthCache, listServers, type CfsmServersPayload } from "./client";
import { applyBatchUpdate, applyLatestReportUpdates, unknownServerIds, type RelayServer } from "./relay-model";

/**
 * CF-Server-Monitor 实时数据的服务端中继。
 *
 * 整个 Next.js 进程只维护 1 条到 CFSM /api/ws 的连接，内存里保存最新状态，通过 SSE
 * （/api/monitor/stream）扇出给所有浏览器；上游负载与观看人数无关，凭据也只留在服务端。
 *
 * CFSM 的约束（source/CF-Server-Monitor src/durable/MetricsBroadcaster.js）：
 * - scope=all 必须发 subscribe 并带上 ids 才会投递（_shouldDeliver），否则只收到 hello；
 * - 有订阅者时探针切到 2 秒上报，无订阅者回落 60 秒。因此最后一位观看者离开后要断开上游，
 *   让探针回到空闲档。
 */

type SnapshotMeta = Omit<CfsmServersPayload, "servers" | "latestReportUpdates">;
export type MonitorSnapshot = SnapshotMeta & { servers: RelayServer[] };
export type MonitorRelayStatus = { live: boolean; error: string | null };
export type MonitorRelayEvent =
  | { type: "snapshot"; data: MonitorSnapshot }
  | { type: "update"; data: RelayServer[] }
  | { type: "status"; data: MonitorRelayStatus };
export type MonitorRelayListener = (event: MonitorRelayEvent) => void;

/** 最后一位观看者离开后的宽限期，避免切页面时来回重连。 */
const STOP_GRACE_MS = 30_000;
/** 应用层心跳；广播端对 {"type":"ping"} 自动回 pong，不会唤醒 DO。 */
const PING_MS = 30_000;
/** 超过该时长没有任何上游消息（含 pong）即判定连接假死。 */
const IDLE_TIMEOUT_MS = 90_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
/** 实时通道断开期间的兜底快照间隔。 */
const FALLBACK_SNAPSHOT_MS = 15_000;
/** 实时通道正常时刷新名称、标签、延迟历史等不走推送的字段。 */
const LIVE_SNAPSHOT_MS = 60_000;
const UNKNOWN_REFRESH_DEBOUNCE_MS = 2_000;
/** 连续失败到该次数时丢弃鉴权缓存（token 过期或公开性变化都会让握手被拒）。 */
const AUTH_RESET_EVERY_FAILURES = 3;

const PING_FRAME = JSON.stringify({ type: "ping" });

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

class MonitorRelay {
  private listeners = new Set<MonitorRelayListener>();
  private servers = new Map<string, RelayServer>();
  private order: string[] = [];
  private meta: SnapshotMeta | null = null;
  /** 曾由推送更新过的字段；快照刷新时这些字段保留更新的推送值。 */
  private liveKeys = new Set<string>();
  private status: MonitorRelayStatus = { live: false, error: null };

  private running = false;
  /** 每次 start/stop 递增，用于丢弃上一轮遗留的异步回调。 */
  private generation = 0;
  private ws: WebSocket | null = null;
  private subscribedIds = "";
  private lastMessageAt = 0;
  private failures = 0;
  private reconnectDelay = RECONNECT_MIN_MS;
  private snapshotInFlight: Promise<void> | null = null;

  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private unknownTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  subscribe(listener: MonitorRelayListener): () => void {
    this.listeners.add(listener);
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    if (!this.running) {
      this.start();
    } else {
      if (this.meta) listener({ type: "snapshot", data: this.snapshot() });
      listener({ type: "status", data: this.status });
    }
    return () => {
      if (!this.listeners.delete(listener) || this.listeners.size > 0 || this.stopTimer) return;
      this.stopTimer = setTimeout(() => {
        this.stopTimer = null;
        if (this.listeners.size === 0) this.stop();
      }, STOP_GRACE_MS);
    };
  }

  restart(): void {
    if (!this.running) return;
    this.stop();
    if (this.listeners.size > 0) this.start();
  }

  private isCurrent(gen: number): boolean {
    return this.running && gen === this.generation;
  }

  private start(): void {
    this.running = true;
    const gen = ++this.generation;
    void this.refreshSnapshot(gen).finally(() => {
      if (this.isCurrent(gen)) this.scheduleSnapshot(gen);
    });
  }

  private stop(): void {
    this.running = false;
    this.generation += 1;
    for (const timer of [this.stopTimer, this.reconnectTimer, this.snapshotTimer, this.unknownTimer]) {
      if (timer) clearTimeout(timer);
    }
    this.stopTimer = this.reconnectTimer = this.snapshotTimer = this.unknownTimer = null;
    this.stopPing();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close(1000, "relay stopped");
      } catch {
        // 已关闭
      }
    }
    this.servers = new Map();
    this.order = [];
    this.meta = null;
    this.liveKeys.clear();
    this.subscribedIds = "";
    this.status = { live: false, error: null };
    this.failures = 0;
    this.reconnectDelay = RECONNECT_MIN_MS;
  }

  private emit(event: MonitorRelayEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 单个 SSE 连接写失败不影响其他观看者
      }
    }
  }

  private setStatus(live: boolean, error: string | null): void {
    if (this.status.live === live && this.status.error === error) return;
    this.status = { live, error };
    this.emit({ type: "status", data: this.status });
  }

  private snapshot(): MonitorSnapshot {
    const servers = this.order.map((id) => this.servers.get(id)).filter((server): server is RelayServer => !!server);
    return { ...(this.meta as SnapshotMeta), servers };
  }

  /* ---------------------------- 快照 ---------------------------- */

  private scheduleSnapshot(gen: number): void {
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(
      () => {
        this.snapshotTimer = null;
        void this.refreshSnapshot(gen).finally(() => {
          if (this.isCurrent(gen)) this.scheduleSnapshot(gen);
        });
      },
      this.status.live ? LIVE_SNAPSHOT_MS : FALLBACK_SNAPSHOT_MS,
    );
  }

  private refreshSnapshot(gen: number): Promise<void> {
    if (this.snapshotInFlight) return this.snapshotInFlight;
    this.snapshotInFlight = (async () => {
      try {
        const { servers, latestReportUpdates, ...meta } = await listServers();
        if (!this.isCurrent(gen)) return;

        const next = new Map<string, RelayServer>();
        for (const server of servers) {
          const id = String(server.id);
          next.set(id, { ...server, id });
        }
        applyLatestReportUpdates(next, latestReportUpdates);
        // 快照来自 D1（分钟级）；推送更新过的字段若更新，则保留推送值。
        for (const [id, entry] of next) {
          const prev = this.servers.get(id);
          if (!prev || Number(prev.last_updated) <= Number(entry.last_updated)) continue;
          for (const key of this.liveKeys) {
            if (key in prev) entry[key] = prev[key];
          }
        }

        this.servers = next;
        this.order = [...next.keys()];
        this.meta = meta;
        this.emit({ type: "snapshot", data: this.snapshot() });
        this.setStatus(this.status.live, this.status.live ? null : this.status.error);

        if (this.ws?.readyState === WebSocket.OPEN) {
          this.sendSubscribe(this.ws);
        } else if (!this.ws && !this.reconnectTimer) {
          void this.connect(gen);
        }
      } catch (error) {
        if (this.isCurrent(gen)) {
          this.setStatus(false, errorMessage(error, "服务器状态加载失败"));
        }
      } finally {
        this.snapshotInFlight = null;
      }
    })();
    return this.snapshotInFlight;
  }

  /* --------------------------- 实时通道 --------------------------- */

  private async connect(gen: number): Promise<void> {
    let url: string;
    try {
      url = await buildRelayWsUrl();
    } catch (error) {
      if (!this.isCurrent(gen)) return;
      this.failures += 1;
      this.setStatus(false, errorMessage(error, "实时通道地址不可用"));
      this.scheduleReconnect(gen);
      return;
    }
    if (!this.isCurrent(gen) || this.ws) return;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (error) {
      this.failures += 1;
      this.setStatus(false, errorMessage(error, "实时通道连接失败"));
      this.scheduleReconnect(gen);
      return;
    }
    this.ws = ws;
    let opened = false;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      opened = true;
      this.failures = 0;
      this.reconnectDelay = RECONNECT_MIN_MS;
      this.lastMessageAt = Date.now();
      this.subscribedIds = "";
      this.sendSubscribe(ws);
      this.startPing(ws, gen);
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      this.lastMessageAt = Date.now();
      let message: unknown;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!message || typeof message !== "object") return;
      const type = (message as { type?: unknown }).type;
      if (type === "subscribed") {
        this.setStatus(true, null);
        this.scheduleSnapshot(gen);
      } else if (type === "batchUpdate") {
        this.handleBatch(message, gen);
      } else if (type === "error") {
        this.setStatus(false, "CF-Server-Monitor 拒绝了实时订阅");
      }
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      if (!opened) this.failures += 1;
      this.dropSocket(ws, gen, opened ? "实时通道已断开，正在重连" : "实时通道连接失败，正在重连");
    };

    // 错误之后必然触发 close，统一在 onclose 处理
    ws.onerror = () => {};
  }

  /**
   * 摘下当前连接并立即进入断线流程（兜底快照 + 退避重连）。
   * 不等待 close 事件：CFSM 的 DO 不回应关闭帧，连接会长时间停在 CLOSING，等它就永远不会重连。
   */
  private dropSocket(ws: WebSocket, gen: number, reason: string): void {
    if (this.ws !== ws) return;
    this.ws = null;
    this.stopPing();
    try {
      ws.close();
    } catch {
      // 已关闭
    }
    this.setStatus(false, reason);
    this.scheduleSnapshot(gen);
    this.scheduleReconnect(gen);
  }

  private sendSubscribe(ws: WebSocket): void {
    const ids = [...this.servers.keys()];
    const key = ids.join(",");
    if (key === this.subscribedIds) return;
    try {
      ws.send(JSON.stringify({ type: "subscribe", scope: "all", ids }));
      this.subscribedIds = key;
    } catch {
      // 发送失败会伴随 close，由重连流程补发
    }
  }

  private handleBatch(message: unknown, gen: number): void {
    const newIds = unknownServerIds(this.servers, message);
    const deltas = applyBatchUpdate(this.servers, message);
    for (const delta of deltas) {
      for (const key of Object.keys(delta)) if (key !== "id") this.liveKeys.add(key);
    }
    if (deltas.length > 0) this.emit({ type: "update", data: deltas });
    if (!this.status.live) {
      this.setStatus(true, null);
      this.scheduleSnapshot(gen);
    }
    if (newIds.length > 0 && !this.unknownTimer) {
      this.unknownTimer = setTimeout(() => {
        this.unknownTimer = null;
        if (this.isCurrent(gen)) void this.refreshSnapshot(gen);
      }, UNKNOWN_REFRESH_DEBOUNCE_MS);
    }
  }

  private startPing(ws: WebSocket, gen: number): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws !== ws) return;
      if (Date.now() - this.lastMessageAt > IDLE_TIMEOUT_MS) {
        this.dropSocket(ws, gen, "实时通道无响应，正在重连");
        return;
      }
      try {
        ws.send(PING_FRAME);
      } catch {
        // 发送失败的连接会在下一轮心跳因无响应被摘下
      }
    }, PING_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private scheduleReconnect(gen: number): void {
    if (!this.isCurrent(gen) || this.reconnectTimer) return;
    if (this.failures > 0 && this.failures % AUTH_RESET_EVERY_FAILURES === 0) invalidateMonitorAuthCache();
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isCurrent(gen) && !this.ws) void this.connect(gen);
    }, delay);
  }
}

// 挂在 globalThis 上：dev 热更新重新求值本模块时仍复用同一条上游连接。
const GLOBAL_KEY = "__aeranexaMonitorRelay";
type RelayGlobal = typeof globalThis & { [GLOBAL_KEY]?: MonitorRelay };

function relay(): MonitorRelay {
  const store = globalThis as RelayGlobal;
  store[GLOBAL_KEY] ??= new MonitorRelay();
  return store[GLOBAL_KEY];
}

/** 订阅实时数据；首位订阅者触发上游连接，返回取消订阅函数。 */
export function subscribeMonitor(listener: MonitorRelayListener): () => void {
  return relay().subscribe(listener);
}

/** 监控设置变更后调用：有观看者时按新配置重建上游连接。 */
export function restartMonitorRelay(): void {
  relay().restart();
}
