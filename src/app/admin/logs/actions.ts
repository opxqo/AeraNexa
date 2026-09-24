"use server";

import { revalidatePath } from "next/cache";
import { getDbPool } from "@/lib/server/db";
import { requireAdminUser } from "@/lib/server/admin";
import { recordAudit } from "@/lib/server/audit";
import { invalidateLogSettings, LOG_CATEGORIES } from "@/lib/server/runtime-logs";

export async function saveLogCaptureSettingsAction(formData: FormData): Promise<void> {
  const admin = await requireAdminUser();
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    for (const category of LOG_CATEGORIES) {
      const enabled = formData.get(category) === "on" ? 1 : 0;
      await connection.execute(
        `INSERT INTO log_capture_settings (category, enabled, updated_by)
         VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), updated_by = VALUES(updated_by)`,
        [category, enabled, admin.id],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
  invalidateLogSettings();
  await recordAudit({ action: "admin.settings_saved", userId: admin.id, resourceType: "log_capture_settings", context: { categories: LOG_CATEGORIES.filter((category) => formData.get(category) === "on") } });
  revalidatePath("/admin/logs");
}
