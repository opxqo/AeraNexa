import "server-only";

import type { RowDataPacket } from "mysql2";
import { getDbPool } from "../db";
import { isVisionFlowEnabled } from "../settings";
import { addClient, deleteClient, detachClient, listRawInbounds, PanelError, updateClient } from "./client";
import { PANEL_NAME } from "./import-inbounds";
import {
  collectActualClients,
  computeDesiredClient,
  diffClient,
  SYNC_PROTOCOLS,
  visionEligible,
  type DesiredClient,
  type PanelOp,
  type UserEntitlement,
} from "./sync-model";

/**
 * Reconciler（docs/node-domain-design.md §4.3）：让 3x-ui 收敛到数据库描述的状态。
 *
 * - `{ userIds }`：处理被标脏的用户（事件驱动，worker 每几秒一轮）；
 * - `"all"`：全量对账（worker 每分钟一轮），兜底漏标、到期、以及有人在 3x-ui 面板里手工改动。
 *
 * 3x-ui 不可达时整轮抛出（由 worker 暂停后重试，不累加 attempts）；
 * 3x-ui 拒绝某个用户的操作时只把该用户标为 failed 并退避，不影响其他用户。
 */

export type ReconcileResult = {
  checked: number;
  changed: number;
  failed: number;
  orphansDeleted: number;
  ops: number;
};

type ClientRow = RowDataPacket & {
  user_id: number;
  email: string;
  sub_id: string;
  desired_version: number;
  sync_status: string;
  user_email: string;
  /** 失败后处于退避期：全量对账也不重试，避免每分钟打一次必然失败的请求。 */
  backing_off: number;
  uuid: string;
  is_active: number;
  plan_id: number | null;
  expired_at: number | null;
  transfer_enable: number;
  used_bytes: number;
  group_id: number | null;
  device_limit: number;
};

type AssignableNode = { nodeId: number; inboundId: number; protocol: string; vision: boolean };

const MAX_BACKOFF_SECONDS = 30 * 60;

function backoffSeconds(attempts: number): number {
  return Math.min(MAX_BACKOFF_SECONDS, 10 * 2 ** Math.min(attempts, 12));
}

function parseSnapshot(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function loadAssignableNodes(): Promise<Map<number, AssignableNode[]>> {
  const [rows] = await getDbPool().query<RowDataPacket[]>(
    `SELECT nag.group_id, n.id AS node_id, n.external_inbound_id, n.protocol, n.inbound_snapshot
       FROM node_access_groups nag
       JOIN nodes n ON n.id = nag.node_id
      WHERE n.external_panel = ? AND n.is_enabled = 1 AND n.missing_since IS NULL
        AND n.external_inbound_id IS NOT NULL`,
    [PANEL_NAME],
  );
  const byGroup = new Map<number, AssignableNode[]>();
  for (const row of rows) {
    const inboundId = Number(row.external_inbound_id);
    const protocol = String(row.protocol);
    if (!Number.isInteger(inboundId) || inboundId <= 0 || !SYNC_PROTOCOLS.has(protocol)) continue;
    const groupId = Number(row.group_id);
    const list = byGroup.get(groupId) ?? [];
    list.push({ nodeId: Number(row.node_id), inboundId, protocol, vision: visionEligible(parseSnapshot(row.inbound_snapshot)) });
    byGroup.set(groupId, list);
  }
  return byGroup;
}

async function loadClientRows(scope: { userIds: number[] } | "all"): Promise<ClientRow[]> {
  const pool = getDbPool();
  if (scope === "all") {
    // 全量时顺手补齐：持有套餐但还没有 panel_clients 行的用户（例如漏标的历史数据）。
    await pool.execute(
      `INSERT IGNORE INTO panel_clients (user_id, email, sub_id, next_attempt_at)
       SELECT u.id, CONCAT('u', u.id), LEFT(REPLACE(UUID(), '-', ''), 16), CURRENT_TIMESTAMP
         FROM users u WHERE u.plan_id IS NOT NULL`,
    );
  } else if (scope.userIds.length === 0) {
    return [];
  }

  const where = scope === "all" ? "" : `WHERE pc.user_id IN (${scope.userIds.map(() => "?").join(",")})`;
  const [rows] = await pool.query<ClientRow[]>(
    `SELECT pc.user_id, pc.email, pc.sub_id, pc.desired_version, pc.sync_status,
            (pc.sync_status = 'failed' AND pc.next_attempt_at > CURRENT_TIMESTAMP) AS backing_off,
            u.email AS user_email, u.uuid, u.is_active, u.plan_id, u.expired_at, u.transfer_enable,
            (u.upload_bytes + u.download_bytes) AS used_bytes, p.group_id,
            COALESCE(u.device_limit_override, p.device_limit, 0) AS device_limit
       FROM panel_clients pc
       JOIN users u ON u.id = pc.user_id
       LEFT JOIN plans p ON p.id = u.plan_id
       ${where}`,
    scope === "all" ? [] : scope.userIds,
  );
  return rows;
}

function toEntitlement(row: ClientRow, nodes: AssignableNode[], visionEnabled: boolean): UserEntitlement {
  return {
    userId: Number(row.user_id),
    email: String(row.user_email ?? ""),
    uuid: String(row.uuid),
    isActive: Boolean(Number(row.is_active)),
    planId: row.plan_id === null ? null : Number(row.plan_id),
    expiredAt: row.expired_at === null ? null : Number(row.expired_at),
    transferEnable: Number(row.transfer_enable),
    usedBytes: Number(row.used_bytes),
    subId: String(row.sub_id),
    deviceLimit: Number(row.device_limit),
    inboundIds: nodes.map((node) => node.inboundId),
    visionFlow: visionEnabled && nodes.some((node) => node.vision),
  };
}

async function applyOp(op: PanelOp): Promise<void> {
  switch (op.type) {
    case "add":
      return addClient(op.client, op.inboundIds);
    case "update":
      return updateClient(op.email, op.client);
    case "detach":
      return detachClient(op.email, op.inboundIds);
    case "delete":
      return deleteClient(op.email);
  }
}

async function markSynced(row: ClientRow, desired: DesiredClient | null, nodes: AssignableNode[]): Promise<void> {
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    // proxy_accounts 记录「此刻实际挂在哪些节点上」，供后台展示与排障（§3.3）。
    await connection.execute("DELETE FROM proxy_accounts WHERE user_id = ?", [row.user_id]);
    if (desired) {
      for (const node of nodes) {
        await connection.execute(
          `INSERT INTO proxy_accounts
             (user_id, node_id, external_client_id, external_email, protocol, is_enabled, sync_status, last_synced_at)
           VALUES (?, ?, ?, ?, ?, ?, 'synced', CURRENT_TIMESTAMP)`,
          [row.user_id, node.nodeId, row.email, row.email, node.protocol, desired.client.enable ? 1 : 0],
        );
      }
    }
    // 乐观并发：处理期间又被标脏（desired_version 变大）则保持 pending，下一轮继续。
    await connection.execute(
      `UPDATE panel_clients
          SET synced_version = ?,
              sync_status = IF(desired_version = ?, 'synced', 'pending'),
              next_attempt_at = IF(desired_version = ?, NULL, CURRENT_TIMESTAMP),
              attempts = 0, last_error = NULL, last_synced_at = CURRENT_TIMESTAMP
        WHERE user_id = ?`,
      [row.desired_version, row.desired_version, row.desired_version, row.user_id],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function markFailed(userId: number, message: string): Promise<void> {
  const [rows] = await getDbPool().execute<RowDataPacket[]>("SELECT attempts FROM panel_clients WHERE user_id = ?", [userId]);
  const attempts = Number(rows[0]?.attempts ?? 0);
  await getDbPool().execute(
    `UPDATE panel_clients
        SET sync_status = 'failed', attempts = attempts + 1, last_error = ?,
            next_attempt_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND)
      WHERE user_id = ?`,
    [message.slice(0, 2000), backoffSeconds(attempts), userId],
  );
}

export async function reconcileClients(scope: { userIds: number[] } | "all"): Promise<ReconcileResult> {
  const result: ReconcileResult = { checked: 0, changed: 0, failed: 0, orphansDeleted: 0, ops: 0 };

  // 先读 3x-ui：不可达就整轮放弃，不动任何用户的状态。
  const actualClients = collectActualClients(await listRawInbounds());
  const [rows, nodesByGroup, visionEnabled] = await Promise.all([
    loadClientRows(scope),
    loadAssignableNodes(),
    isVisionFlowEnabled(),
  ]);
  const nowSeconds = Math.floor(Date.now() / 1000);

  for (const row of rows) {
    result.checked += 1;
    const nodes = row.group_id === null ? [] : (nodesByGroup.get(Number(row.group_id)) ?? []);
    const desired = computeDesiredClient(toEntitlement(row, nodes, visionEnabled), nowSeconds);
    const actual = actualClients.get(row.email) ?? null;
    actualClients.delete(row.email);
    const ops = diffClient(row.email, desired, actual);

    if (ops.length === 0 && row.sync_status === "synced") continue;
    if (scope === "all" && Number(row.backing_off)) continue;

    try {
      for (const op of ops) {
        await applyOp(op);
        result.ops += 1;
      }
      await markSynced(row, desired, nodes);
      if (ops.length) result.changed += 1;
    } catch (error) {
      // 面板整体不可达：中止整轮，交给 worker 暂停重试。
      if (error instanceof PanelError && error.retryable) throw error;
      result.failed += 1;
      await markFailed(Number(row.user_id), error instanceof Error ? error.message : String(error));
    }
  }

  // 全量时清理孤儿：3x-ui 里有 u{id} 客户端，但 AeraNexa 没有对应的 panel_clients 行
  // （用户已被删除，外键级联删掉了行）。u{数字} 命名空间只属于 AeraNexa，其他客户端从不触碰。
  if (scope === "all") {
    for (const email of actualClients.keys()) {
      try {
        await deleteClient(email);
        result.orphansDeleted += 1;
        result.ops += 1;
      } catch (error) {
        if (error instanceof PanelError && error.retryable) throw error;
        result.failed += 1;
      }
    }
  }

  return result;
}

/** worker 事件轮询：取到期待处理的标脏用户。 */
export async function listDirtyUserIds(limit = 100): Promise<number[]> {
  const [rows] = await getDbPool().query<RowDataPacket[]>(
    `SELECT user_id FROM panel_clients
      WHERE sync_status IN ('pending', 'failed') AND next_attempt_at IS NOT NULL AND next_attempt_at <= CURRENT_TIMESTAMP
      ORDER BY next_attempt_at ASC
      LIMIT ?`,
    [limit],
  );
  return rows.map((row) => Number(row.user_id));
}
