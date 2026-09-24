import "server-only";

import type { RowDataPacket } from "mysql2";
import { getDbPool } from "./db";
import { getNumberSetting } from "./settings";
import { LOG_CATEGORIES, safeLogMessage, safeLogPath, type LogCategory } from "./runtime-logs";
import { describeLogEvent } from "../log-descriptions";

export type LogFilters = {
  view: "audit" | "access" | "runtime" | "alerts" | "settings";
  page: number;
  from: string;
  to: string;
  category: string;
  level: string;
  actor: string;
  path: string;
  requestId: string;
};

export type LogRow = {
  id: number; createdAt: string; service: string; category: string; level: string;
  eventCode: string; explanation: string; message: string; requestId: string; actor: string; path: string;
  method: string; status: string; duration: string; details: string;
};

const PAGE_SIZE = 50;

function dateBound(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+08:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function displayDate(value: Date | string): string {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}

function safeStoredDetails(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[truncated]";
  if (typeof value === "string") {
    if (depth === 0) {
      try { return safeStoredDetails(JSON.parse(value), depth + 1); } catch { /* 历史记录可能是普通文本。 */ }
    }
    return safeLogMessage(value);
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safeStoredDetails(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [
      key,
      /password|passwd|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key/i.test(key)
        ? "[redacted]" : safeStoredDetails(item, depth + 1),
    ]));
  }
  return value;
}

function buildLogQuery(filters: LogFilters, beforeId?: number) {
  const audit = filters.view === "audit";
  const clauses: string[] = [];
  const values: unknown[] = [];
  const from = dateBound(filters.from);
  const to = dateBound(filters.to);
  if (from) { clauses.push(`${audit ? "a" : "r"}.created_at >= ?`); values.push(from); }
  if (to) { clauses.push(`${audit ? "a" : "r"}.created_at <= ?`); values.push(to); }
  if (filters.requestId && /^[0-9a-f-]{1,36}$/i.test(filters.requestId)) {
    clauses.push(`${audit ? "a" : "r"}.request_id LIKE ?`); values.push(`${filters.requestId}%`);
  }
  if (filters.actor) {
    clauses.push("(u.email LIKE ? OR u.nickname LIKE ?)");
    values.push(`%${filters.actor.slice(0, 80)}%`, `%${filters.actor.slice(0, 80)}%`);
  }
  if (filters.path) {
    clauses.push(`${audit ? "a" : "r"}.request_path LIKE ?`);
    values.push(`%${filters.path.slice(0, 100)}%`);
  }
  if (!audit) {
    if (filters.view === "access") clauses.push("r.category IN ('access', 'slow')");
    if (filters.view === "runtime") clauses.push("r.category NOT IN ('access', 'slow')");
    if (LOG_CATEGORIES.includes(filters.category as LogCategory)) { clauses.push("r.category = ?"); values.push(filters.category); }
    if (["info", "warn", "error"].includes(filters.level)) { clauses.push("r.level = ?"); values.push(filters.level); }
  }
  if (beforeId !== undefined) { clauses.push(`${audit ? "a" : "r"}.id < ?`); values.push(beforeId); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const table = audit
    ? "FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id"
    : "FROM runtime_logs r LEFT JOIN users u ON u.id = r.actor_id";
  const select = audit
    ? "a.id, a.created_at, a.action AS event_code, a.resource_type, a.resource_id, a.request_id, a.request_method, a.request_path, a.ip_address, a.context AS details, u.email AS actor"
    : "r.id, r.created_at, r.service, r.category, r.level, r.event_code, r.message, r.request_id, r.request_method, r.request_path, r.status_code, r.duration_ms, r.details, u.email AS actor";
  return { audit, table, where, select, values, alias: audit ? "a" : "r" };
}

function mapLogRow(row: RowDataPacket, audit: boolean): LogRow {
  const eventCode = String(row.event_code);
  const category = audit ? "audit" : String(row.category);
  return {
    id: Number(row.id), createdAt: displayDate(row.created_at),
    service: audit ? "审计" : String(row.service), category,
    level: audit ? "info" : String(row.level), eventCode,
    explanation: describeLogEvent(eventCode, category, audit ? null : row.status_code === null ? null : Number(row.status_code)),
    message: audit ? [row.resource_type, row.resource_id].filter(Boolean).join(" · ") : String(row.message),
    requestId: String(row.request_id ?? ""), actor: String(row.actor ?? ""),
    path: row.request_path ? safeLogPath(String(row.request_path)) : "",
    method: String(row.request_method ?? ""), status: audit ? "" : String(row.status_code ?? ""),
    duration: audit ? "" : row.duration_ms === null ? "" : `${row.duration_ms} ms`,
    details: audit
      ? JSON.stringify(safeStoredDetails({ ip: row.ip_address, context: safeStoredDetails(row.details) }))
      : JSON.stringify(safeStoredDetails(row.details ?? null)),
  };
}

export async function loadLogRows(filters: LogFilters): Promise<{ rows: LogRow[]; total: number; pageSize: number }> {
  const { audit, table, where, select, values, alias } = buildLogQuery(filters);
  const [counts] = await getDbPool().query<RowDataPacket[]>(`SELECT COUNT(*) AS total ${table} ${where}`, values);
  const total = Number(counts[0]?.total ?? 0);
  const offset = (filters.page - 1) * PAGE_SIZE;
  const [rows] = await getDbPool().query<RowDataPacket[]>(
    `SELECT ${select} ${table} ${where} ORDER BY ${alias}.id DESC LIMIT ? OFFSET ?`,
    [...values, PAGE_SIZE, offset],
  );
  return { total, pageSize: PAGE_SIZE, rows: rows.map((row) => mapLogRow(row, audit)) };
}

/** 导出按 ID 游标取数，不受后台当前页影响，也不会重复执行总数统计。 */
export async function loadLogExportBatch(filters: LogFilters, beforeId: number | undefined, limit = 500): Promise<LogRow[]> {
  const { audit, table, where, select, values, alias } = buildLogQuery(filters, beforeId);
  const [rows] = await getDbPool().query<RowDataPacket[]>(
    `SELECT ${select} ${table} ${where} ORDER BY ${alias}.id DESC LIMIT ?`,
    [...values, limit],
  );
  return rows.map((row) => mapLogRow(row, audit));
}

export async function loadLogSettings(): Promise<Record<LogCategory, boolean>> {
  const [rows] = await getDbPool().query<RowDataPacket[]>("SELECT category, enabled FROM log_capture_settings");
  const disabled = new Set(rows.filter((row) => !Number(row.enabled)).map((row) => String(row.category)));
  return Object.fromEntries(LOG_CATEGORIES.map((category) => [category, !disabled.has(category)])) as Record<LogCategory, boolean>;
}

export async function loadLogAlerts(): Promise<{ errors: number; slow: number; payment: number; bot: number; workerStale: boolean; workerStaleAfter: number; ingestion: Array<{ service: string; healthy: boolean; dropped: number; error: string }> }> {
  const [[counts], [worker], [health], eventIntervalMs] = await Promise.all([
    getDbPool().query<RowDataPacket[]>(`SELECT
      SUM(category = 'error' AND level = 'error') AS errors,
      SUM(category = 'slow') AS slow,
      SUM(category = 'payment' AND level = 'error') AS payment,
      SUM(category = 'bot' AND level = 'error') AS bot
      FROM runtime_logs WHERE created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 MINUTE)`),
    getDbPool().query<RowDataPacket[]>("SELECT MIN(TIMESTAMPDIFF(SECOND, last_finished_at, CURRENT_TIMESTAMP)) AS age FROM worker_runs"),
    getDbPool().query<RowDataPacket[]>("SELECT service, last_success_at, last_failure_at, last_error, dropped_count FROM log_ingestion_status"),
    getNumberSetting("worker.event_interval_ms"),
  ]);
  const row = counts[0] ?? {};
  const workerStaleAfter = Math.max(120, Math.ceil((eventIntervalMs * 3) / 1000) + 60);
  return {
    errors: Number(row.errors ?? 0), slow: Number(row.slow ?? 0),
    payment: Number(row.payment ?? 0), bot: Number(row.bot ?? 0),
    workerStale: !worker.length || worker[0].age === null || Number(worker[0].age) > workerStaleAfter,
    workerStaleAfter,
    ingestion: health.map((item) => ({
      service: String(item.service),
      healthy: !item.last_failure_at || Boolean(item.last_success_at && new Date(item.last_success_at) >= new Date(item.last_failure_at)),
      dropped: Number(item.dropped_count ?? 0), error: String(item.last_error ?? ""),
    })),
  };
}
