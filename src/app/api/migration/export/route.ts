import { Readable } from "node:stream";
import { recordAudit } from "@/lib/server/audit";
import { createBackupStream } from "@/lib/server/backup";
import { consumeMigrationToken, DATABASE_FINGERPRINT_HEADER, databaseFingerprint } from "@/lib/server/migration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 在线迁移的导出口：新面板凭迁移码里的令牌来拉取整站备份流。
 * 不依赖登录会话，只认一次性令牌；令牌在开始导出时即作废，传输中断需重新生成。
 */
export async function GET(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? "";
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip");
  // 在作废令牌之前拦下「迁移给自己」：同一个库边导出边被清空会丢数据；此时令牌保持可用
  const requester = request.headers.get(DATABASE_FINGERPRINT_HEADER);
  if (requester && requester === await databaseFingerprint()) {
    return Response.json({ error: "这个迁移码来自本面板自己（同一个数据库），迁移给自己会清空数据。请在旧面板上生成迁移码，再粘贴到新面板" }, { status: 409 });
  }
  const granted = token ? await consumeMigrationToken(token, ip) : null;
  if (!granted) {
    await recordAudit({ action: "admin.migration_rejected", resourceType: "migration", request, context: { reason: token ? "invalid_or_used" : "missing" } });
    return Response.json({ error: "迁移码无效、已使用或已过期，请在旧面板重新生成" }, { status: 401 });
  }
  await recordAudit({ action: "admin.migration_exported", resourceType: "migration", request, context: { includeLogs: granted.includeLogs } });

  const stream = Readable.toWeb(createBackupStream({ includeLogs: granted.includeLogs })) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    headers: {
      "Content-Type": "application/gzip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
