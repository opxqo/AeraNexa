"use server";

import { revalidatePath } from "next/cache";
import { requireAdminUser } from "@/lib/server/admin";
import { recordAudit } from "@/lib/server/audit";
import { saveSettings } from "@/lib/server/settings";
import { createEpayKeepaliveNow, getEpayKeepaliveOverview, KEEPALIVE_SETTING_KEYS } from "@/lib/server/payments/epay-keepalive";
import { checkEpayMerchant, createEpayTestPayment, getEpayTestStatus } from "@/lib/server/payments/epay-test";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(task: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await task() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "操作失败" };
  }
}

export async function checkEpayMerchantAction(methodId: number) {
  return run(async () => {
    await requireAdminUser();
    return checkEpayMerchant(methodId);
  });
}

export async function createEpayTestPaymentAction(methodId: number, amountCents: number) {
  return run(async () => {
    const admin = await requireAdminUser();
    return createEpayTestPayment(methodId, amountCents, admin.id);
  });
}

export async function getEpayTestStatusAction(outTradeNo: string) {
  return run(async () => {
    await requireAdminUser();
    return getEpayTestStatus(outTradeNo);
  });
}

export async function saveEpayKeepaliveSettingsAction(enabled: boolean, intervalHours: number) {
  return run(async () => {
    const admin = await requireAdminUser();
    const changed = await saveSettings({
      values: { [KEEPALIVE_SETTING_KEYS.enabled]: enabled ? "true" : "false", [KEEPALIVE_SETTING_KEYS.intervalHours]: String(intervalHours) },
      clearSecrets: [],
    }, admin.id);
    if (changed.length) {
      await recordAudit({ action: "admin.settings_saved", userId: admin.id, resourceType: "system_settings", resourceId: changed.join(","), context: { changed, enabled, intervalHours } });
    }
    revalidatePath("/admin/payments");
    return getEpayKeepaliveOverview();
  });
}

export async function runEpayKeepaliveNowAction() {
  return run(async () => {
    const admin = await requireAdminUser();
    const summary = await createEpayKeepaliveNow(admin.id);
    return { summary, overview: await getEpayKeepaliveOverview() };
  });
}

export async function getEpayKeepaliveOverviewAction() {
  return run(async () => {
    await requireAdminUser();
    return getEpayKeepaliveOverview();
  });
}
