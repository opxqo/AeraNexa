import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { getCurrentUser } from "@/lib/server/users";
import { recordAudit } from "@/lib/server/audit";
import { restoreBackup } from "@/lib/server/backup";
import { emitRuntimeLog, safeError } from "@/lib/server/runtime-logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 上传备份文件（请求体即文件本身）覆盖当前数据库。
 * /api 不经过 proxy，请求体不会被整体缓冲，大文件按流处理。
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "无权恢复备份" }, { status: 403 });
  if (!request.body) return Response.json({ error: "请选择备份文件" }, { status: 400 });

  try {
    const result = await restoreBackup(Readable.fromWeb(request.body as NodeReadableStream<Uint8Array>));
    // 写在恢复后的库里；执行者的用户 ID 属于旧库，恢复后可能不存在，只记在 context 里。
    await recordAudit({
      action: "admin.backup_restored", resourceType: "backup", request,
      context: { restoredBy: user.email, backupCreatedAt: result.createdAt, includesLogs: result.includesLogs, complete: result.complete, envDiff: result.envDiff.map((item) => item.key) },
    });
    return Response.json(result);
  } catch (error) {
    void emitRuntimeLog({ service: "web", category: "error", level: "error", eventCode: "backup.restore_failed", message: safeError(error), path: "/api/admin/backup/restore" });
    return Response.json({ error: error instanceof Error ? error.message : "恢复失败" }, { status: 400 });
  }
}
