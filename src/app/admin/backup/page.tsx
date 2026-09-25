import { requireAdminUser } from "@/lib/server/admin";
import { BACKUP_ENV_KEYS, LOG_TABLES } from "@/lib/server/backup";
import { BackupPanel } from "./backup-panel";

export const dynamic = "force-dynamic";

export default async function AdminBackupPage() {
  await requireAdminUser();
  const envKeys = BACKUP_ENV_KEYS.filter((key) => Boolean(process.env[key]?.trim()));

  return (
    <div className="admin-page-stack">
      <section className="admin-page-heading">
        <div>
          <p className="admin-kicker">AeraNexa 管理控制台</p>
          <h1>数据迁移</h1>
          <p>把整站数据和加密主密钥导出成一个文件，在新服务器上一键恢复。</p>
        </div>
      </section>
      <BackupPanel envKeys={envKeys} logTables={[...LOG_TABLES]} />
      <p className="admin-source-note">
        命令行同样可用：<span className="mono">pnpm backup:export [--logs]</span> 导出，
        <span className="mono">pnpm backup:restore 文件</span> 恢复（会自动建库建表，并把密钥写入 <span className="mono">.env.local</span>）。
      </p>
    </div>
  );
}
