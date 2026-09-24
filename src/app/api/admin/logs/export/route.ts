import { getCurrentUser } from "@/lib/server/users";
import { recordAudit } from "@/lib/server/audit";
import { loadLogExportBatch, type LogFilters } from "@/lib/server/log-query";
import { csvLine, logRowToCsv, LOG_EXPORT_HEADER, LOG_EXPORT_LIMIT } from "@/lib/log-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("请先登录", { status: 401 });
  if (user.role !== "admin") return new Response("无权导出日志", { status: 403 });

  const params = new URL(request.url).searchParams;
  const view = params.get("view");
  if (view !== "audit" && view !== "access" && view !== "runtime") {
    return new Response("请选择可导出的日志类别", { status: 400 });
  }
  const filters: LogFilters = {
    view, page: 1, from: params.get("from") ?? "", to: params.get("to") ?? "",
    category: params.get("category") ?? "", level: params.get("level") ?? "",
    actor: params.get("actor") ?? "", path: params.get("path") ?? "",
    requestId: params.get("requestId") ?? "",
  };
  // 在发送 CSV 响应前验证查询；否则数据库错误会产生损坏的下载文件。
  const firstBatch = await loadLogExportBatch(filters, undefined, 500);
  await recordAudit({
    action: "admin.logs_exported", userId: user.id, resourceType: "log_export",
    request, context: { view, filtered: ["from", "to", "category", "level", "actor", "path", "requestId"].filter((key) => Boolean(params.get(key))) },
  });

  const encoder = new TextEncoder();
  let pending = firstBatch;
  let beforeId: number | undefined;
  let exported = 0;
  let started = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!started) {
          controller.enqueue(encoder.encode(`\uFEFF${csvLine(LOG_EXPORT_HEADER)}`));
          started = true;
        }
        if (!pending.length) { controller.close(); return; }
        controller.enqueue(encoder.encode(pending.map(logRowToCsv).join("")));
        exported += pending.length;
        beforeId = pending.at(-1)?.id;
        if (pending.length < 500 || exported >= LOG_EXPORT_LIMIT || beforeId === undefined) {
          controller.close();
          return;
        }
        pending = await loadLogExportBatch(filters, beforeId, Math.min(500, LOG_EXPORT_LIMIT - exported));
      } catch (error) {
        controller.error(error);
      }
    },
  });

  const timestamp = new Date().toISOString().replaceAll(/[-:]/g, "").slice(0, 15);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="aeranexa-${view}-${timestamp}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
