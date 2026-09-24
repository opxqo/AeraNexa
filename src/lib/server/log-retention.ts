import type { RowDataPacket } from "mysql2";
import { getDbPool } from "./db";
import { safeError } from "./runtime-logs";

/** 每个 Web 实例都可调度；MySQL 命名锁让同一时刻只有一个实例清理。 */
export async function pruneRuntimeLogs(): Promise<number> {
  const connection = await getDbPool().getConnection();
  let locked = false;
  let deleted = 0;
  try {
    const [rows] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK('aeranexa:log-retention', 0) AS acquired");
    locked = Number(rows[0]?.acquired) === 1;
    if (!locked) return 0;
    for (let i = 0; i < 20; i++) {
      const [result] = await connection.query<import("mysql2").ResultSetHeader>(
        "DELETE FROM runtime_logs WHERE created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 DAY) ORDER BY created_at, id LIMIT 1000",
      );
      deleted += result.affectedRows;
      if (result.affectedRows < 1000) break;
    }
    return deleted;
  } finally {
    if (locked) await connection.query("SELECT RELEASE_LOCK('aeranexa:log-retention')").catch((error: unknown) => {
      process.stderr.write(`${JSON.stringify({ event: "log.retention_unlock_failed", error: safeError(error) })}\n`);
    });
    connection.release();
  }
}
