import "server-only";

import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getDbPool } from "../db";
import { getServerStatus, listRawInbounds, PanelError } from "./client";
import {
  defaultPublicHost,
  inboundManagedNodeFields,
  inboundManagedNodeFieldsMatch,
  parseInbound,
  type PanelInbound,
} from "./inbounds";

/**
 * 把 3x-ui 主控上的入站导入为 `nodes`（docs/node-domain-design.md §4.5）。
 *
 * - 新入站：插入为「未启用 + 隐藏」，等管理员配置对外地址与分组后再启用；
 * - 已有入站：刷新名称、协议、服务端口与快照；对外地址 / 端口、排序等由后台维护，不覆盖；
 * - 3x-ui 中已不存在：只置 `missing_since`，从不自动删除。
 *
 * 对 3x-ui 只读。可由后台按钮与 worker 同时调用，靠 MySQL 命名锁串行化。
 */

export const PANEL_NAME = "3x-ui";
const IMPORT_LOCK = "aeranexa:inbound-import";

export type InboundImportResult = {
  panelVersion: string;
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  restored: number;
  missing: number;
  skipped: number;
};

type ExistingNode = RowDataPacket & {
  id: number;
  name: string;
  protocol: string;
  server_port: number | null;
  external_inbound_id: string;
  snapshot_hash: string | null;
  missing_since: Date | null;
};

export async function importInbounds(): Promise<InboundImportResult> {
  // 先完成所有网络请求，再开事务：不能让慢面板拖着数据库锁。
  const status = await getServerStatus();
  const rawInbounds = await listRawInbounds();

  const inbounds: PanelInbound[] = [];
  let skipped = 0;
  for (const raw of rawInbounds) {
    const parsed = parseInbound(raw);
    if (parsed) inbounds.push(parsed);
    else skipped += 1;
  }

  const connection = await getDbPool().getConnection();
  let locked = false;
  try {
    const [lockRows] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK(?, 10) AS acquired", [IMPORT_LOCK]);
    if (Number(lockRows[0]?.acquired) !== 1) {
      throw new PanelError("rejected", "另一个入站导入正在进行，请稍后再试");
    }
    locked = true;

    await connection.beginTransaction();
    const [existingRows] = await connection.query<ExistingNode[]>(
      `SELECT id, name, protocol, server_port, external_inbound_id, snapshot_hash, missing_since
         FROM nodes
        WHERE external_panel = ? AND external_inbound_id IS NOT NULL
        FOR UPDATE`,
      [PANEL_NAME],
    );

    // 面板返回 0 个入站而本地已有映射：更像是连错了面板或面板刚重装，
    // 此时把所有节点标记失踪会让后续同步器把用户全部摘掉，宁可拒绝。
    if (inbounds.length === 0 && existingRows.length > 0) {
      throw new PanelError("rejected", `3x-ui 返回 0 个入站，而本地已有 ${existingRows.length} 个映射节点；为防误操作未做任何修改`);
    }

    const existingById = new Map(existingRows.map((row) => [String(row.external_inbound_id), row]));
    const seen = new Set<string>();
    const result: InboundImportResult = {
      panelVersion: status.panelVersion,
      total: inbounds.length,
      created: 0,
      updated: 0,
      unchanged: 0,
      restored: 0,
      missing: 0,
      skipped,
    };

    for (const inbound of inbounds) {
      const externalId = String(inbound.id);
      seen.add(externalId);
      const existing = existingById.get(externalId);
      const snapshotJson = JSON.stringify(inbound.snapshot);
      const managed = inboundManagedNodeFields(inbound);

      if (!existing) {
        await connection.execute(
          `INSERT INTO nodes
             (external_panel, external_inbound_id, origin_node_guid, name, protocol, host, port, server_port,
              inbound_snapshot, snapshot_hash, is_visible, is_enabled, is_online, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0)`,
          [
            PANEL_NAME,
            externalId,
            inbound.originNodeGuid || null,
            managed.name,
            managed.protocol,
            defaultPublicHost(inbound, { panelGuid: status.panelGuid, publicIp: status.publicIpv4 }).slice(0, 255),
            managed.serverPort,
            inbound.port,
            snapshotJson,
            inbound.snapshotHash,
          ],
        );
        result.created += 1;
        continue;
      }

      const wasMissing = existing.missing_since !== null;
      if (!wasMissing
        && existing.snapshot_hash === inbound.snapshotHash
        && inboundManagedNodeFieldsMatch({
          name: existing.name,
          protocol: existing.protocol,
          serverPort: existing.server_port === null ? null : Number(existing.server_port),
        }, inbound)) {
        result.unchanged += 1;
        continue;
      }

      await connection.execute(
        `UPDATE nodes
            SET name = ?, protocol = ?, server_port = ?, origin_node_guid = ?, inbound_snapshot = ?, snapshot_hash = ?,
                missing_since = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [managed.name, managed.protocol, managed.serverPort, inbound.originNodeGuid || null, snapshotJson, inbound.snapshotHash, existing.id],
      );
      if (wasMissing) result.restored += 1;
      else result.updated += 1;
    }

    const newlyMissing = existingRows
      .filter((row) => !seen.has(String(row.external_inbound_id)) && row.missing_since === null)
      .map((row) => row.id);
    if (newlyMissing.length) {
      const [update] = await connection.query<ResultSetHeader>(
        `UPDATE nodes SET missing_since = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id IN (${newlyMissing.map(() => "?").join(",")}) AND missing_since IS NULL`,
        newlyMissing,
      );
      result.missing = update.affectedRows;
    }

    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [IMPORT_LOCK]).catch(() => {});
    connection.release();
  }
}
