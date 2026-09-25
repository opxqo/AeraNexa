import type { RowDataPacket } from "mysql2";
import { getDbPool } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/users";
import type { AdminNavCounts } from "@/lib/admin-navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 后台导航上的待办数字：待回复工单、待支付订单、3x-ui 同步失败的用户。 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "无权访问" }, { status: 403 });

  const [rows] = await getDbPool().query<RowDataPacket[]>(`
    SELECT
      (SELECT COUNT(*) FROM tickets WHERE status = 0 AND reply_status = 0) AS tickets,
      (SELECT COUNT(*) FROM orders WHERE status = 0) AS orders,
      (SELECT COUNT(*) FROM panel_clients WHERE sync_status = 'failed') AS sync_failed
  `);
  const counts: AdminNavCounts = {
    tickets: Number(rows[0]?.tickets ?? 0),
    orders: Number(rows[0]?.orders ?? 0),
    syncFailed: Number(rows[0]?.sync_failed ?? 0),
  };
  return Response.json(counts, { headers: { "Cache-Control": "no-store" } });
}
