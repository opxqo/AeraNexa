"use server";

import { requireAdminUser } from "@/lib/server/admin";
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
