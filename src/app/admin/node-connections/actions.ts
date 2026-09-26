"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAudit } from "@/lib/server/audit";
import { requireAdminUser } from "@/lib/server/admin";
import { addClient, deleteClient, detachClient, getServerStatus, listRawInbounds, updateClient } from "@/lib/server/panel/client";
import { getEnabledNodeTarget, recordNodeConnectionTest, saveNodeConnection } from "@/lib/server/panel/node-connections";

function idOf(data: FormData): number {
  const id = Number(data.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("节点连接编号无效");
  return id;
}

function finish(message: string, failed = false): never {
  revalidatePath("/admin/node-connections");
  redirect(`/admin/node-connections?${failed ? "error" : "notice"}=${encodeURIComponent(message)}`);
}

export async function saveNodeConnectionAction(data: FormData): Promise<void> {
  const admin = await requireAdminUser();
  let message = "节点连接已保存";
  let failed = false;
  try {
    const rawId = String(data.get("id") ?? "");
    const id = rawId ? idOf(data) : undefined;
    const savedId = await saveNodeConnection({
      id,
      name: String(data.get("name") ?? ""),
      baseUrl: String(data.get("baseUrl") ?? ""),
      certificateSha256: String(data.get("certificateSha256") ?? ""),
      token: String(data.get("token") ?? ""),
      enabled: data.get("enabled") === "on",
    });
    await recordAudit({ action: "admin.node_connection_saved", userId: admin.id, resourceType: "node_panel_connection", resourceId: savedId, context: { enabled: data.get("enabled") === "on", tokenUpdated: Boolean(data.get("token")) } });
  } catch (error) {
    failed = true;
    message = error instanceof Error ? error.message : "保存失败";
  }
  finish(message, failed);
}

export async function testNodeConnectionAction(data: FormData): Promise<void> {
  const admin = await requireAdminUser();
  const id = idOf(data);
  let message = "";
  let failed = false;
  try {
    const target = await getEnabledNodeTarget(id);
    const status = await getServerStatus(target);
    const inbounds = await listRawInbounds(target);
    message = `连接成功：3x-node ${status.panelVersion}，${inbounds.length} 个入站`;
    await recordNodeConnectionTest(id, null);
  } catch (error) {
    failed = true;
    message = error instanceof Error ? error.message : "连接失败";
    await recordNodeConnectionTest(id, message).catch(() => {});
  }
  await recordAudit({ action: "admin.node_connection_tested", userId: admin.id, resourceType: "node_panel_connection", resourceId: id, context: { mode: "read", ok: !failed } });
  finish(message, failed);
}

/** A disposable identity exercises all six allowlisted endpoints; cleanup is attempted even on failure. */
export async function testNodeClientLifecycleAction(data: FormData): Promise<void> {
  const admin = await requireAdminUser();
  const id = idOf(data);
  let message = "";
  let failed = false;
  const email = `an-test-${randomUUID().slice(0, 12)}`;
  try {
    const target = await getEnabledNodeTarget(id);
    const inbounds = await listRawInbounds(target) as Array<Record<string, unknown>>;
    const inbound = inbounds.find((item) => item.protocol === "vless" && Number.isInteger(Number(item.id)));
    if (!inbound) throw new Error("测试节点没有 VLESS 入站，请先在隔离节点准备测试入站");
    const inboundId = Number(inbound.id);
    const client = { email, id: randomUUID(), enable: true, flow: "", totalGB: 0, expiryTime: 0, subId: randomUUID().replace(/-/g, "").slice(0, 16), comment: "AN isolated compatibility test" };
    await getServerStatus(target);
    try {
      await addClient(client, [inboundId], target);
      await updateClient(email, { ...client, comment: "AN isolated compatibility update" }, target);
      await detachClient(email, [inboundId], target);
      await addClient(client, [inboundId], target);
      const present = await listRawInbounds(target);
      if (!JSON.stringify(present).includes(email)) throw new Error("客户端写入后未在入站列表中出现");
      message = "六个接口通过：查询、创建、更新、摘除、重新挂载、删除";
    } finally {
      await deleteClient(email, target);
    }
    await recordNodeConnectionTest(id, null);
  } catch (error) {
    failed = true;
    message = error instanceof Error ? error.message : "客户端联调失败";
    await recordNodeConnectionTest(id, message).catch(() => {});
  }
  await recordAudit({ action: "admin.node_connection_tested", userId: admin.id, resourceType: "node_panel_connection", resourceId: id, context: { mode: "client_lifecycle", ok: !failed } });
  finish(message, failed);
}
