import { getCurrentUser } from "@/lib/server/users";
import { recordAudit } from "@/lib/server/audit";
import { restoreBackup } from "@/lib/server/backup";
import { openRemoteBackup, parseMigrationCode } from "@/lib/server/migration";
import { emitRuntimeLog, safeError } from "@/lib/server/runtime-logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 新面板：用旧面板的迁移码直接拉取备份流并覆盖当前数据库。 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "无权恢复备份" }, { status: 403 });

  const body = await request.json().catch(() => null) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code : "";
  try {
    const { origin } = parseMigrationCode(code);
    const result = await restoreBackup(await openRemoteBackup(code));
    // 写在恢复后的库里；执行者属于新库旧数据，恢复后可能不存在，只记在 context 里。
    await recordAudit({
      action: "admin.backup_restored", resourceType: "backup", request,
      context: { restoredBy: user.email, source: origin, backupCreatedAt: result.createdAt, includesLogs: result.includesLogs, complete: result.complete, envDiff: result.envDiff.map((item) => item.key) },
    });
    return Response.json(result);
  } catch (error) {
    void emitRuntimeLog({ service: "web", category: "error", level: "error", eventCode: "backup.remote_restore_failed", message: safeError(error), path: "/api/admin/backup/restore-remote" });
    return Response.json({ error: error instanceof Error ? error.message : "在线迁移失败" }, { status: 400 });
  }
}
