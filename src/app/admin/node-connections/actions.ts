"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAudit } from "@/lib/server/audit";
import { requireAdminUser } from "@/lib/server/admin";
import { addClient, addLabVlessInbound, deleteClient, detachClient, getServerStatus, listRawInbounds, updateClient } from "@/lib/server/panel/client";
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
    const traffic = (inbounds as Array<Record<string, unknown>>).map((item) => `#${String(item.id)} 上行 ${Number(item.up) || 0} / 下行 ${Number(item.down) || 0} 字节`).join("；");
    message = `连接成功：3x-node ${status.panelVersion}，${inbounds.length} 个入站${traffic ? `（${traffic}）` : ""}`;
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

const LAB_INBOUND_PREFIX = "an-lab-vless";

/** Creates one plain VLESS/TCP inbound so the lifecycle test has something to attach to. */
export async function createLabInboundAction(data: FormData): Promise<void> {
  const admin = await requireAdminUser();
  const id = idOf(data);
  const port = Number(data.get("port"));
  let message = "";
  let failed = false;
  try {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("入站端口须为 1024–65535 的整数");
    const target = await getEnabledNodeTarget(id);
    const inbounds = await listRawInbounds(target) as Array<Record<string, unknown>>;
    const tag = `${LAB_INBOUND_PREFIX}-${port}`;
    if (inbounds.some((item) => item.tag === tag || Number(item.port) === port)) {
      throw new Error("该端口已被其他入站占用");
    }
    await addLabVlessInbound({
      remark: tag, enable: true, listen: "", port, protocol: "vless", tag,
      settings: { decryption: "none", clients: [{ id: randomUUID(), email: `an-lab-seed-${randomUUID().slice(0, 8)}`, enable: true, flow: "", subId: randomUUID().replace(/-/g, "").slice(0, 16) }] },
      streamSettings: { network: "tcp", security: "none", tcpSettings: { header: { type: "none" } } },
      sniffing: { enabled: false },
    }, target);
    message = `测试 VLESS 入站已创建（容器内端口 ${port}，无加密，仅供联调）`;
    await recordNodeConnectionTest(id, null);
  } catch (error) {
    failed = true;
    message = error instanceof Error ? error.message : "创建测试入站失败";
    await recordNodeConnectionTest(id, message).catch(() => {});
  }
  await recordAudit({ action: "admin.node_connection_tested", userId: admin.id, resourceType: "node_panel_connection", resourceId: id, context: { mode: "create_lab_inbound", ok: !failed, port } });
  finish(message, failed);
}

/** Adds a few disposable clients to a lab inbound so per-client counters can be told apart. */
export async function createLabClientsAction(data: FormData): Promise<void> {
  const admin = await requireAdminUser();
  const id = idOf(data);
  const inboundId = Number(data.get("inboundId"));
  const count = Number(data.get("count"));
  let message = "";
  let failed = false;
  try {
    if (!Number.isInteger(inboundId) || inboundId < 1) throw new Error("入站编号无效");
    if (!Number.isInteger(count) || count < 1 || count > 5) throw new Error("客户端数量须为 1–5");
    const target = await getEnabledNodeTarget(id);
    const inbounds = await listRawInbounds(target) as Array<Record<string, unknown>>;
    const inbound = inbounds.find((item) => Number(item.id) === inboundId);
    if (!inbound || typeof inbound.tag !== "string" || !inbound.tag.startsWith(LAB_INBOUND_PREFIX)) {
      throw new Error("只能向 an-lab-vless 测试入站添加客户端");
    }
    for (let i = 0; i < count; i += 1) {
      const suffix = randomUUID().slice(0, 8);
      await addClient({ email: `an-lab-user-${suffix}`, id: randomUUID(), enable: true, flow: "", totalGB: 0, expiryTime: 0, subId: randomUUID().replace(/-/g, "").slice(0, 16), comment: "AN isolated traffic test" }, [inboundId], target);
    }
    message = `已向入站 #${inboundId} 添加 ${count} 个测试客户端，请在下方「入站与客户端流量」中查看`;
    await recordNodeConnectionTest(id, null);
  } catch (error) {
    failed = true;
    message = error instanceof Error ? error.message : "创建测试客户端失败";
    await recordNodeConnectionTest(id, message).catch(() => {});
  }
  await recordAudit({ action: "admin.node_connection_tested", userId: admin.id, resourceType: "node_panel_connection", resourceId: id, context: { mode: "create_lab_clients", ok: !failed, inboundId, count } });
  finish(message, failed);
}
