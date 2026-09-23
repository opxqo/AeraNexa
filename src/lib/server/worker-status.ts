import "server-only";

import type { RowDataPacket } from "mysql2";
import { getDbPool } from "./db";
import { getNumberSetting } from "./settings";

/**
 * 节点 worker 的运行状态（docs/node-domain-design.md 第 8 步：后台可观测性）。
 *
 * worker 每执行一个任务就写一行 worker_runs；事件同步每轮都会执行，因此最近一次完成时间即心跳。
 * 本文件会被 worker 直接引用（Node 剥离类型运行），只能使用可擦除的 TS 语法。
 */

export type WorkerTask = "import" | "traffic" | "reconcile" | "event" | "payments";

export const WORKER_TASKS: ReadonlyArray<{ task: WorkerTask; label: string }> = [
  { task: "event", label: "事件同步" },
  { task: "reconcile", label: "全量对账" },
  { task: "traffic", label: "流量采集" },
  { task: "import", label: "入站导入" },
  { task: "payments", label: "支付查单" },
];

export async function recordWorkerRun(
  task: WorkerTask,
  outcome: { ok: boolean; summary?: string | null; error?: string | null },
): Promise<void> {
  const ok = outcome.ok ? 1 : 0;
  const summary = outcome.summary ? outcome.summary.slice(0, 500) : null;
  const error = outcome.error ? outcome.error.slice(0, 2000) : null;
  // 成功时刷新摘要并清空错误；失败时保留上一次成功的摘要，只记录错误。
  await getDbPool().execute(
    `INSERT INTO worker_runs (task, last_finished_at, last_ok, last_ok_at, last_summary, last_error)
     VALUES (?, CURRENT_TIMESTAMP, ?, IF(? = 1, CURRENT_TIMESTAMP, NULL), ?, ?)
     ON DUPLICATE KEY UPDATE
       last_finished_at = CURRENT_TIMESTAMP,
       last_ok = ?,
       last_ok_at = IF(? = 1, CURRENT_TIMESTAMP, last_ok_at),
       last_summary = IF(? = 1, ?, last_summary),
       last_error = IF(? = 1, NULL, ?)`,
    [task, ok, ok, summary, error, ok, ok, ok, summary, ok, error],
  );
}

export type WorkerRunView = {
  task: WorkerTask;
  label: string;
  /** 距最近一次完成的秒数；从未运行为 null。以数据库时钟计算，不受应用服务器时区影响。 */
  finishedAgoSeconds: number | null;
  ok: boolean;
  summary: string;
  error: string;
};

export type SyncFailure = {
  userId: number;
  email: string;
  attempts: number;
  lastError: string;
  /** 距下次自动重试的秒数，≤0 表示已到期、等待 worker 下一轮。 */
  retryInSeconds: number | null;
};

export type SyncOverview = {
  runs: WorkerRunView[];
  /** 最近一次任何任务完成的时间是否在阈值内。 */
  workerAlive: boolean;
  lastSeenAgoSeconds: number | null;
  staleAfterSeconds: number;
  counts: { synced: number; pending: number; failed: number };
  failures: SyncFailure[];
};

const FAILURE_LIST_LIMIT = 20;

export async function loadSyncOverview(): Promise<SyncOverview> {
  const pool = getDbPool();
  const [[runRows], [countRows], [failureRows], eventIntervalMs] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT task, last_summary, last_error, last_ok AS ok,
              TIMESTAMPDIFF(SECOND, last_finished_at, CURRENT_TIMESTAMP) AS finished_ago
         FROM worker_runs`,
    ),
    pool.query<RowDataPacket[]>("SELECT sync_status, COUNT(*) AS total FROM panel_clients GROUP BY sync_status"),
    pool.query<RowDataPacket[]>(
      `SELECT pc.user_id, u.email, pc.attempts, pc.last_error,
              TIMESTAMPDIFF(SECOND, CURRENT_TIMESTAMP, pc.next_attempt_at) AS retry_in
         FROM panel_clients pc
         JOIN users u ON u.id = pc.user_id
        WHERE pc.sync_status = 'failed'
        ORDER BY pc.updated_at DESC
        LIMIT ${FAILURE_LIST_LIMIT}`,
    ),
    getNumberSetting("worker.event_interval_ms"),
  ]);

  const byTask = new Map(runRows.map((row) => [String(row.task), row]));
  const runs = WORKER_TASKS.map(({ task, label }): WorkerRunView => {
    const row = byTask.get(task);
    return {
      task,
      label,
      finishedAgoSeconds: row ? Math.max(0, Number(row.finished_ago)) : null,
      ok: row ? Boolean(Number(row.ok)) : false,
      summary: row?.last_summary ? String(row.last_summary) : "",
      error: row?.last_error ? String(row.last_error) : "",
    };
  });

  const seen = runs.map((run) => run.finishedAgoSeconds).filter((age): age is number => age !== null);
  const lastSeenAgoSeconds = seen.length ? Math.min(...seen) : null;
  // 每轮至少执行一次任务；3x-ui 不可达时每轮额外暂停 30 秒，阈值留足余量。
  const staleAfterSeconds = Math.max(120, Math.ceil((eventIntervalMs * 3) / 1000) + 60);

  const counts = { synced: 0, pending: 0, failed: 0 };
  for (const row of countRows) {
    const status = String(row.sync_status);
    if (status === "synced" || status === "pending" || status === "failed") counts[status] = Number(row.total);
  }

  return {
    runs,
    workerAlive: lastSeenAgoSeconds !== null && lastSeenAgoSeconds <= staleAfterSeconds,
    lastSeenAgoSeconds,
    staleAfterSeconds,
    counts,
    failures: failureRows.map((row) => ({
      userId: Number(row.user_id),
      email: String(row.email),
      attempts: Number(row.attempts),
      lastError: row.last_error ? String(row.last_error) : "",
      retryInSeconds: row.retry_in === null ? null : Number(row.retry_in),
    })),
  };
}
