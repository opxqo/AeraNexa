import "server-only";

import type { PoolConnection } from "mysql2/promise";

/**
 * 业务域 → 节点域的唯一入口（docs/node-domain-design.md §4.2）。
 *
 * 业务代码改完用户的套餐 / 到期 / 额度 / 启停 / 凭据后调用这里「标脏」，
 * 由节点 worker 把 3x-ui 收敛到数据库描述的状态。这里从不调用 3x-ui。
 *
 * 在事务里调用时传入事务连接，保证「开通」与「要求同步」原子提交（outbox）。
 * 即使漏标，worker 每分钟的全量对账也会兜底，只是生效更慢。
 */

type SqlExecutor = Pick<PoolConnection, "execute">;

/** 3x-ui 客户端 email 固定为 u{userId}，不使用真实邮箱（避免泄露、改邮箱不影响）。 */
export function panelClientEmail(userId: number): string {
  return `u${userId}`;
}

export async function markPanelClientDirty(db: SqlExecutor, userId: number): Promise<void> {
  await db.execute(
    `INSERT INTO panel_clients (user_id, email, sub_id, next_attempt_at)
     VALUES (?, ?, LEFT(REPLACE(UUID(), '-', ''), 16), CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       desired_version = desired_version + 1,
       sync_status = 'pending',
       attempts = 0,
       next_attempt_at = CURRENT_TIMESTAMP`,
    [userId, panelClientEmail(userId)],
  );
}

/**
 * 影响面较大的变更（权限组、节点启停 / 分组、套餐改组）后调用：
 * 所有已有客户端的用户与所有持有套餐的用户都标脏。用户量大时再按影响面收窄。
 */
export async function markAllPanelClientsDirty(db: SqlExecutor): Promise<void> {
  await db.execute(
    `UPDATE panel_clients
        SET desired_version = desired_version + 1, sync_status = 'pending', attempts = 0,
            next_attempt_at = CURRENT_TIMESTAMP`,
  );
  await db.execute(
    `INSERT IGNORE INTO panel_clients (user_id, email, sub_id, next_attempt_at)
     SELECT u.id, CONCAT('u', u.id), LEFT(REPLACE(UUID(), '-', ''), 16), CURRENT_TIMESTAMP
       FROM users u
      WHERE u.plan_id IS NOT NULL`,
  );
}
