import { Readable } from "node:stream";
import { getCurrentUser } from "@/lib/server/users";
import { recordAudit } from "@/lib/server/audit";
import { createBackupStream } from "@/lib/server/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 下载迁移备份：整站数据 + 加密主密钥，明文（仅 gzip），只允许管理员。 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("请先登录", { status: 401 });
  if (user.role !== "admin") return new Response("无权导出备份", { status: 403 });

  const includeLogs = new URL(request.url).searchParams.get("logs") === "1";
  await recordAudit({ action: "admin.backup_exported", userId: user.id, resourceType: "backup", request, context: { includeLogs } });

  const timestamp = new Date().toISOString().replaceAll(/[-:]/g, "").replace("T", "-").slice(0, 13);
  const stream = Readable.toWeb(createBackupStream({ includeLogs })) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="aeranexa-backup-${timestamp}.ndjson.gz"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
