import "server-only";

import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getDbPool } from "../db";
import { markPanelClientDirty } from "../node-sync";
import { listRawInbounds } from "./client";
import { PANEL_NAME } from "./import-inbounds";
import { collectCounters, counterDelta, dayBucketUtc, userIdFromEmail, type Counter } from "./traffic-model";

/**
 * TrafficCollector（docs/node-domain-design.md §4.4），worker 每分钟一轮。
 *
 * 单事务内完成：累加 users.upload_bytes / download_bytes（计费口径）、写日粒度流量明细、
 * 推进游标；本轮刚跨过额度的用户随即标脏，由 Reconciler 在 3x-ui 停用。
 * 超额到停用之间最多相差一个采集周期 + 一个事件周期。
 */

export type CollectResult = { users: number; nodes: number; bytes: number; overQuota: number };

type CursorRow = RowDataPacket & { cursor_key: string; last_up: number; last_down: number };

export async function collectTraffic(): Promise<CollectResult> {
  const counters = collectCounters(await listRawInbounds());
  const result: CollectResult = { users: 0, nodes: 0, bytes: 0, overQuota: 0 };
  const keys = [
    ...[...counters.clients.keys()].map((email) => `client:${email}`),
    ...[...counters.inbounds.keys()].map((id) => `inbound:${id}`),
  ];
  if (!keys.length) return result;

  const bucket = dayBucketUtc(Date.now());
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();

    const [cursorRows] = await connection.query<CursorRow[]>(
      `SELECT cursor_key, last_up, last_down FROM panel_traffic_cursors WHERE cursor_key IN (?) FOR UPDATE`,
      [keys],
    );
    const cursors = new Map<string, Counter>(
      cursorRows.map((row) => [row.cursor_key, { up: Number(row.last_up), down: Number(row.last_down) }]),
    );

    // ---- 用户（计费）----
    for (const [email, current] of counters.clients) {
      const userId = userIdFromEmail(email);
      const delta = counterDelta(cursors.get(`client:${email}`) ?? null, current);
      const total = delta.up + delta.down;
      if (!userId || total === 0) continue;

      const [users] = await connection.execute<RowDataPacket[]>(
        `SELECT upload_bytes + download_bytes AS used, transfer_enable FROM users WHERE id = ? FOR UPDATE`,
        [userId],
      );
      if (!users[0]) continue; // 用户已删除：游标照常推进，孤儿客户端由 Reconciler 清理
      const usedBefore = Number(users[0].used);
      const quota = Number(users[0].transfer_enable);

      await connection.execute(
        `UPDATE users SET upload_bytes = upload_bytes + ?, download_bytes = download_bytes + ? WHERE id = ?`,
        [delta.up, delta.down, userId],
      );
      // node_id 为 NULL（一个客户端挂多个入站，3x-ui 只给合计）——唯一键对 NULL 不生效，手工 upsert。
      const [updated] = await connection.execute<ResultSetHeader>(
        `UPDATE user_traffic_records SET upload_bytes = upload_bytes + ?, download_bytes = download_bytes + ?
          WHERE user_id = ? AND node_id IS NULL AND server_rate = 1.00 AND record_type = 'day' AND record_at = ?`,
        [delta.up, delta.down, userId, bucket],
      );
      if (updated.affectedRows === 0) {
        await connection.execute(
          `INSERT INTO user_traffic_records (user_id, node_id, upload_bytes, download_bytes, server_rate, record_type, record_at)
           VALUES (?, NULL, ?, ?, 1.00, 'day', ?)`,
          [userId, delta.up, delta.down, bucket],
        );
      }

      result.users += 1;
      result.bytes += total;
      if (quota > 0 && usedBefore < quota && usedBefore + total >= quota) {
        await markPanelClientDirty(connection, userId);
        result.overQuota += 1;
      }
    }

    // ---- 节点（统计）----
    const [nodeRows] = await connection.query<RowDataPacket[]>(
      `SELECT id, external_inbound_id FROM nodes WHERE external_panel = ? AND external_inbound_id IS NOT NULL`,
      [PANEL_NAME],
    );
    const nodeByInbound = new Map(nodeRows.map((row) => [Number(row.external_inbound_id), Number(row.id)]));
    for (const [inboundId, current] of counters.inbounds) {
      const nodeId = nodeByInbound.get(inboundId);
      const delta = counterDelta(cursors.get(`inbound:${inboundId}`) ?? null, current);
      if (!nodeId || delta.up + delta.down === 0) continue;
      await connection.execute(
        `INSERT INTO node_traffic_records (node_id, upload_bytes, download_bytes, record_type, record_at)
         VALUES (?, ?, ?, 'day', ?)
         ON DUPLICATE KEY UPDATE upload_bytes = upload_bytes + VALUES(upload_bytes),
                                 download_bytes = download_bytes + VALUES(download_bytes)`,
        [nodeId, delta.up, delta.down, bucket],
      );
      result.nodes += 1;
    }

    // ---- 游标 ----
    const cursorValues: Array<string | number> = [];
    for (const [email, current] of counters.clients) cursorValues.push(`client:${email}`, current.up, current.down);
    for (const [inboundId, current] of counters.inbounds) cursorValues.push(`inbound:${inboundId}`, current.up, current.down);
    await connection.query(
      `INSERT INTO panel_traffic_cursors (cursor_key, last_up, last_down, collected_at)
       VALUES ${keys.map(() => "(?, ?, ?, CURRENT_TIMESTAMP)").join(", ")}
       ON DUPLICATE KEY UPDATE last_up = VALUES(last_up), last_down = VALUES(last_down), collected_at = VALUES(collected_at)`,
      cursorValues,
    );

    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}
