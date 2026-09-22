import { localApiRequest } from "./client";

/**
 * CF-Server-Monitor 探针数据的前台类型定义。
 *
 * 数据来自服务端代理 `/api/monitor/servers`（见 src/lib/server/monitor/client.ts），
 * 代理已裁剪掉管理员 JWT，浏览器只拿到只读的节点与统计信息。
 * 字段以 CFSM 原始响应为准，均为可选以兼容不同版本/未上报的节点。
 */

/** 延迟/丢包采样点：ct=电信 cu=联通 cm=移动，bd 为 CFSM 内部标记。 */
export type MonitorSamplePoint = {
  ts: number;
  ct: number | false;
  cu: number | false;
  cm: number | false;
  bd: number | false;
};

/** 磁盘 IO 明细。 */
export type MonitorDiskIo = {
  read_bps?: number;
  write_bps?: number;
  read_iops?: number;
  write_iops?: number;
  await_ms?: number;
  util?: number;
};

export type MonitorServer = {
  id: string;
  name: string;
  region?: string;
  server_group?: string;
  tags?: string;
  is_hidden?: string;
  sort_order?: number;
  /** CPU 使用率（百分比）。 */
  cpu?: number;
  /** 负载，形如 "0.00 0.00 0.00"。 */
  load_avg?: string;
  cpu_cores?: number;
  arch?: string;
  os?: string;
  /** 内存/交换/磁盘容量，单位 MB。 */
  ram_total?: number;
  ram_used?: number;
  swap_total?: number;
  swap_used?: number;
  disk_total?: number;
  disk_used?: number;
  disk?: MonitorDiskIo;
  /** 实时网速，单位 B/s。 */
  net_in_speed?: number;
  net_out_speed?: number;
  /** 累计流量，单位字节。 */
  net_rx?: number;
  net_tx?: number;
  net_rx_monthly?: number;
  net_tx_monthly?: number;
  /** 套餐流量上限，单位 GB（traffic_calc_type=total 时为本月总量口径）；CFSM 下发为字符串。 */
  traffic_limit?: number | string;
  /** 到期日，形如 "2026-10-16"。 */
  expire_date?: string;
  tcp_conn?: number;
  udp_conn?: number;
  processes?: number;
  /** 开机时间戳（毫秒），CFSM 下发为字符串。 */
  boot_time?: string | number;
  /** 最近一次上报时间戳（毫秒）。 */
  last_updated?: number;
  /** 配置时间戳（毫秒），并非上报时间，勿用于在线判定。 */
  timestamp?: number;
  /** 延迟采样序列，末位为最新值。 */
  ping?: MonitorSamplePoint[];
  loss?: MonitorSamplePoint[];
};

export type MonitorStats = {
  total: number;
  online: number;
  offline: number;
  /** 全球实时上/下行速度，单位 B/s。 */
  globalSpeedIn: number;
  globalSpeedOut: number;
  /** 全球累计流量，单位字节。 */
  globalNetTx: number;
  globalNetRx: number;
};

export type MonitorServersPayload = {
  servers: MonitorServer[];
  stats?: MonitorStats;
  regionStats?: Record<string, number>;
  sysConfig?: Record<string, unknown>;
};

/**
 * WS 实时推送消息（公开模式直连探针 /api/ws）。
 * 每条 update 的 samples 末位 data 为最新指标，需合并覆盖到对应节点上。
 */
export type MonitorBatchUpdateMessage = {
  type: "batchUpdate";
  ts?: number;
  updates: Array<{
    serverId: string;
    samples?: Array<{ ts?: number; data?: Record<string, unknown> }>;
  }>;
};

export const monitorApi = {
  /** 拉取全部服务器实时状态与全局统计。 */
  async getServers(): Promise<MonitorServersPayload> {
    return localApiRequest<MonitorServersPayload>("monitor/servers");
  },

  /** 浏览器可直连的实时通道地址；JWT 模式返回 null（前端应回退轮询）。 */
  async getWsUrl(): Promise<string | null> {
    const result = await localApiRequest<{ url: string | null }>("monitor/ws-url");
    return result?.url ?? null;
  },
};
