/**
 * CF-Server-Monitor 探针数据的前台类型定义。
 *
 * 数据来自服务端中继的 SSE 流 `/api/monitor/stream`（见 src/lib/server/monitor/relay.ts），
 * 浏览器不接触 CFSM 地址与凭据，只拿到只读的节点与统计信息。
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
  /** 最新一次三网延迟（ms）/ 丢包（%），随每次推送更新；false 表示未探测。 */
  ping_ct?: number | false;
  ping_cu?: number | false;
  ping_cm?: number | false;
  loss_ct?: number | false;
  loss_cu?: number | false;
  loss_cm?: number | false;
  /** 延迟采样序列（历史窗口，随快照刷新），末位为最新值。 */
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

/** SSE 数据流地址：事件 snapshot（MonitorServersPayload）/ update / status。 */
export const MONITOR_STREAM_URL = "/api/monitor/stream";

/** update 事件：发生变化的服务器，只含 id、变化字段与 last_updated，按 id 浅合并。 */
export type MonitorServerDelta = Partial<MonitorServer> & { id: string };

/** status 事件：上游实时通道是否在推送，以及最近一次错误。 */
export type MonitorStreamStatus = { live: boolean; error: string | null };
