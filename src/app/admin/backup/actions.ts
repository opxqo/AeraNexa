"use server";

import { requireAdminUser } from "@/lib/server/admin";
import { recordAudit } from "@/lib/server/audit";
import { countActiveMigrationTokens, createMigrationCode, revokeMigrationTokens } from "@/lib/server/migration";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(task: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await task() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "操作失败" };
  }
}

/** 旧面板：生成一次性迁移码。迁移码里带着本站对外地址，新面板据此回连。 */
export async function createMigrationCodeAction(origin: string, includeLogs: boolean) {
  return run(async () => {
    const admin = await requireAdminUser();
    const created = await createMigrationCode(admin.id, { origin, includeLogs });
    // 审计只记来源地址与范围，不记迁移码本身
    await recordAudit({ action: "admin.migration_token_created", userId: admin.id, resourceType: "migration", context: { origin: created.origin, includeLogs } });
    return { ...created, active: await countActiveMigrationTokens() };
  });
}

export async function revokeMigrationCodesAction() {
  return run(async () => {
    const admin = await requireAdminUser();
    const revoked = await revokeMigrationTokens();
    await recordAudit({ action: "admin.migration_tokens_revoked", userId: admin.id, resourceType: "migration", context: { revoked } });
    return { revoked };
  });
}
