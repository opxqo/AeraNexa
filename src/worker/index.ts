/**
 * 节点 worker（docs/node-domain-design.md §5）。独立进程运行：`pnpm worker`。
 *
 * 四个任务串行执行（同一时刻只做一件事，避免同一用户被并发改写）：
 * - 事件同步：处理被标脏的用户（默认每 5s）；
 * - 流量采集：累加已用流量，超额用户标脏（默认每 60s）；
 * - 全量对账：兜底到期与手工改动（默认每 60s）；
 * - 入站导入：同步 3x-ui 入站变化（默认每 10min）；
 * - 订单处理：向支付渠道查询近期交易、关闭超时订单、开通到期后排队的套餐（每 15s，与 3x-ui 是否可达无关）；
 * - 易支付保活：每小时检查一次，距上一张保活账单满 2 天就向网关下一张白账单，防止商户号因 5 天无账单被封。
 *
 * 间隔在后台「系统设置 → Worker」中调整，每轮重新读取，改完无需重启。
 *
 * 多实例部署时靠 MySQL 命名锁保证只有一个活跃 worker，其余待命。
 * 本文件由 Node 直接剥离类型运行，只能使用可擦除的 TS 语法。
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDbPool } from "../lib/server/db";
import { PanelError } from "../lib/server/panel/client";
import { getNumberSetting } from "../lib/server/settings";
import { collectTraffic } from "../lib/server/panel/collect-traffic";
import { importInbounds } from "../lib/server/panel/import-inbounds";
import { listDirtyUserIds, reconcileClients, type ReconcileResult } from "../lib/server/panel/reconcile";
import { activateQueuedSubscriptions } from "../lib/server/client-portal";
import { sweepOrderPayments } from "../lib/server/payments/order-payments";
import { runEpayKeepalive } from "../lib/server/payments/epay-keepalive";
import { recordWorkerRun, type WorkerTask } from "../lib/server/worker-status";
import { drainRuntimeLogs, emitRuntimeLog, safeError } from "../lib/server/runtime-logs";

const LEADER_LOCK = "aeranexa:node-worker";
const LEADER_POLL_MS = 5_000;

type Intervals = { event: number; traffic: number; reconcile: number; import: number };

async function readIntervals(): Promise<Intervals> {
  const [event, traffic, reconcile, imported] = await Promise.all([
    getNumberSetting("worker.event_interval_ms"),
    getNumberSetting("worker.traffic_interval_ms"),
    getNumberSetting("worker.reconcile_interval_ms"),
    getNumberSetting("worker.import_interval_ms"),
  ]);
  return { event, traffic, reconcile, import: imported };
}

function describeIntervals(i: Intervals): string {
  return `事件 ${i.event}ms / 流量 ${i.traffic}ms / 全量 ${i.reconcile}ms / 导入 ${i.import}ms`;
}
/** 支付查单间隔：用户付款后通知丢失时，最迟约这么久开通。 */
const PAYMENTS_INTERVAL = 15_000;
/** 保活检查间隔；是否真正下单由距上一张保活账单的时间决定，失败时也按这个间隔重试。 */
const EPAY_KEEPALIVE_INTERVAL = 3_600_000;
/** 3x-ui 不可达时的整体暂停时间。 */
const PANEL_DOWN_PAUSE = 30_000;

function log(message: string, extra?: unknown): void {
  void emitRuntimeLog({ service: "worker", category: "worker", level: extra === undefined ? "info" : "error", eventCode: "worker.lifecycle", message: extra === undefined ? message : `${message}: ${safeError(extra)}` });
}

function describe(result: ReconcileResult): string {
  return `检查 ${result.checked}，变更 ${result.changed}，失败 ${result.failed}，清理孤儿 ${result.orphansDeleted}，调用 3x-ui ${result.ops} 次`;
}

let stopping = false;
let wake: (() => void) | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wake = null;
      resolve();
    }, ms);
    wake = () => {
      clearTimeout(timer);
      wake = null;
      resolve();
    };
  });
}

async function acquireLeadership(): Promise<PoolConnection> {
  const connection = await getDbPool().getConnection();
  let announced = false;
  while (!stopping) {
    const [rows] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK(?, 0) AS acquired", [LEADER_LOCK]);
    if (Number(rows[0]?.acquired) === 1) return connection;
    if (!announced) {
      log("已有其他 worker 在运行，进入待命");
      announced = true;
    }
    // 滚动部署时旧容器收到 SIGTERM 后很快释放锁，短间隔让新容器尽快接手，避免同步中断。
    await sleep(LEADER_POLL_MS);
  }
  connection.release();
  throw new Error("stopped before acquiring leadership");
}

/** 运行记录写失败只打日志：后台看不到状态不应影响同步本身。 */
async function record(key: WorkerTask, outcome: { ok: boolean; summary?: string | null; error?: string | null }): Promise<void> {
  await recordWorkerRun(key, outcome).catch((error: unknown) => log("写入运行记录失败", error));
  await emitRuntimeLog({ service: "worker", category: key === "payments" || key === "epay_keepalive" ? "payment" : "worker", level: outcome.ok ? "info" : "error", eventCode: `worker.${key}`, message: outcome.ok ? outcome.summary ?? "无变更" : outcome.error ?? "任务失败" });
}

/** 返回下一次执行前应额外暂停的毫秒数（面板不可达时暂停）。 */
async function runTask(key: WorkerTask, name: string, task: () => Promise<string | null>): Promise<number> {
  try {
    const summary = await task();
    if (summary) log(`${name}：${summary}`);
    await record(key, { ok: true, summary: summary ?? "无变更" });
    return 0;
  } catch (error) {
    if (error instanceof PanelError) {
      log(`${name}失败（${error.kind}）：${error.message}`);
      await record(key, { ok: false, error: error.message });
      return error.retryable ? PANEL_DOWN_PAUSE : 0;
    }
    log(`${name}异常`, error);
    await record(key, { ok: false, error: error instanceof Error ? error.message : String(error) });
    return 0;
  }
}

async function main(): Promise<void> {
  const leader = await acquireLeadership();
  // 命名锁绑定在连接上：连接断开锁即释放，因此保活这条连接。
  const keepAlive = setInterval(() => {
    leader.query("SELECT 1").catch((error: unknown) => log("主锁连接异常", error));
  }, 60_000);
  let intervals = await readIntervals();
  log(`已成为活跃 worker（${describeIntervals(intervals)}）`);

  let nextReconcile = 0;
  let nextImport = 0;
  let nextTraffic = 0;
  let nextPayments = 0;
  let nextKeepalive = 0;

  try {
    while (!stopping) {
      const now = Date.now();
      let pause = 0;

      // 每轮重新读取调度间隔：后台修改后下一轮即生效。读取失败时沿用上一轮的值。
      const latest = await readIntervals().catch(() => intervals);
      if (describeIntervals(latest) !== describeIntervals(intervals)) {
        log(`调度间隔已更新（${describeIntervals(latest)}）`);
        intervals = latest;
      }

      // 订单处理不依赖 3x-ui，放在最前面：面板不可达导致的暂停不影响它；
      // 且排队套餐在本轮开通并标脏后，紧接着的同步即可把新套餐下发到 3x-ui。
      if (now >= nextPayments) {
        await runTask("payments", "订单处理", async () => {
          const r = await sweepOrderPayments();
          const activated = await activateQueuedSubscriptions();
          if (!r.queried && !r.closedOrders && !r.errors && !activated) return null;
          return `查单 ${r.queried}，确认收款 ${r.paid}，超时关单 ${r.closedOrders}，排队套餐生效 ${activated}${r.errors ? `，失败 ${r.errors}` : ""}`;
        });
        nextPayments = now + PAYMENTS_INTERVAL;
      }

      if (now >= nextKeepalive) {
        await runTask("epay_keepalive", "易支付保活", runEpayKeepalive);
        nextKeepalive = now + EPAY_KEEPALIVE_INTERVAL;
      }

      if (now >= nextImport) {
        pause = await runTask("import", "入站导入", async () => {
          const r = await importInbounds();
          const changed = r.created + r.updated + r.restored + r.missing;
          return changed ? `新增 ${r.created}，更新 ${r.updated}，恢复 ${r.restored}，失踪 ${r.missing}` : null;
        });
        nextImport = now + intervals.import;
      }

      // 流量先于对账：本轮刚超额的用户会被标脏，紧接着的同步即可停用。
      if (!pause && now >= nextTraffic) {
        pause = await runTask("traffic", "流量采集", async () => {
          const r = await collectTraffic();
          if (!r.users && !r.nodes) return null;
          const mb = (r.bytes / 1024 / 1024).toFixed(2);
          return `用户 ${r.users}，节点 ${r.nodes}，计入 ${mb} MB${r.overQuota ? `，超额 ${r.overQuota}` : ""}`;
        });
        nextTraffic = now + intervals.traffic;
      }

      if (!pause && now >= nextReconcile) {
        pause = await runTask("reconcile", "全量对账", async () => {
          const r = await reconcileClients("all");
          return r.changed || r.failed || r.orphansDeleted ? describe(r) : null;
        });
        nextReconcile = now + intervals.reconcile;
      } else if (!pause) {
        pause = await runTask("event", "事件同步", async () => {
          const userIds = await listDirtyUserIds();
          if (!userIds.length) return null;
          return describe(await reconcileClients({ userIds }));
        });
      }

      if (!stopping) await sleep(intervals.event + pause);
    }
  } finally {
    clearInterval(keepAlive);
    await leader.query("SELECT RELEASE_LOCK(?)", [LEADER_LOCK]).catch(() => {});
    leader.release();
  }
}

function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  log(`收到 ${signal}，处理完当前任务后退出`);
  wake?.();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main()
  .catch((error: unknown) => {
    if (!stopping) {
      log("worker 异常退出", error);
      process.exitCode = 1;
    }
  })
  .finally(async () => {
    log("已退出");
    await drainRuntimeLogs();
    await getDbPool().end().catch(() => {});
  });
