import type { LogRow } from "./server/log-query";
import { LOG_CATEGORY_LABELS_ZH, LOG_LEVEL_LABELS } from "./log-descriptions";

export const LOG_EXPORT_LIMIT = 50_000;
export const LOG_EXPORT_HEADER = [
  "时间", "服务", "类别", "级别", "中文解释", "事件代码", "事件信息",
  "操作者", "请求方法", "请求路径", "状态码", "耗时", "请求 ID", "详情",
];

export function csvCell(value: unknown): string {
  let text = String(value ?? "").replaceAll("\0", "");
  // Excel 等表格软件会执行以这些字符开头的单元格；单引号强制按文本显示。
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function csvLine(values: readonly unknown[]): string {
  return `${values.map(csvCell).join(",")}\r\n`;
}

export function logRowToCsv(row: LogRow): string {
  return csvLine([
    row.createdAt, row.service, LOG_CATEGORY_LABELS_ZH[row.category] ?? row.category,
    LOG_LEVEL_LABELS[row.level] ?? row.level, row.explanation, row.eventCode, row.message,
    row.actor, row.method, row.path, row.status, row.duration, row.requestId, row.details,
  ]);
}
