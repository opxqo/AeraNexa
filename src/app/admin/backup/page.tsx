import { headers } from "next/headers";
import { requireAdminUser } from "@/lib/server/admin";
import { BACKUP_ENV_KEYS, LOG_TABLES } from "@/lib/server/backup";
import { countActiveMigrationTokens } from "@/lib/server/migration";
import { BackupPanel } from "./backup-panel";
import { AdminPage } from "@/components/admin-page";

export const dynamic = "force-dynamic";

/** 本站对外地址：反向代理透传的 Host / 协议优先；没有协议头时本机地址按 http、其余按 https。 */
async function detectOrigin(): Promise<string> {
  const list = await headers();
  const host = list.get("x-forwarded-host")?.split(",")[0]?.trim() || list.get("host") || "";
  if (!host) return "";
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = list.get("x-forwarded-proto")?.split(",")[0]?.trim() || (local ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function AdminBackupPage() {
  await requireAdminUser();
  const envKeys = BACKUP_ENV_KEYS.filter((key) => Boolean(process.env[key]?.trim()));
  const [origin, activeCodes] = await Promise.all([detectOrigin(), countActiveMigrationTokens()]);

  return (
    <AdminPage title="数据迁移" description="换服务器时把整站数据和加密主密钥搬到新面板：两个面板在线直连，或者通过备份文件中转。">
      <BackupPanel envKeys={envKeys} logTables={[...LOG_TABLES]} origin={origin} activeCodes={activeCodes} />
      <p className="admin-footnote">
        命令行同样可用：<span className="mono">pnpm backup:export [--logs]</span> 导出；
        <span className="mono">pnpm backup:restore 文件</span> 或 <span className="mono">pnpm backup:restore --from 迁移码</span> 恢复（会自动建库建表，并把密钥写入 <span className="mono">.env.local</span>）。
      </p>
    </AdminPage>
  );
}
