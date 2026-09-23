import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { listQueuedOrders } from "@/lib/server/client-portal";
import { getDbPool } from "@/lib/server/db";
import { getSubscribeBaseUrl } from "@/lib/server/settings";
import { toApiError, unauthenticated } from "@/lib/server/errors";
import { getCurrentUser } from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) throw unauthenticated();

    const baseUrl = await getSubscribeBaseUrl();
    const subscribeUrl = `${baseUrl}/api/client/subscribe?token=${encodeURIComponent(user.subscription_token)}`;

    const [plans] = await getDbPool().execute<RowDataPacket[]>(
      "SELECT id, name, transfer_enable, speed_limit, is_renewable FROM plans WHERE id = ? LIMIT 1",
      [user.plan_id],
    );
    const plan = plans[0];

    const upload = Number(user.upload_bytes) || 0;
    const download = Number(user.download_bytes) || 0;
    const quota = Number(user.transfer_enable) || 0;
    const used = upload + download;
    const expiredAt = user.expired_at === null ? null : Number(user.expired_at);
    // 到期天数与当前时间由服务端下发，避免前端在渲染期调用 Date.now() 造成水合不一致。
    const nowSeconds = Math.floor(Date.now() / 1000);

    return NextResponse.json({
      data: {
        plan_id: user.plan_id,
        token: user.subscription_token,
        expired_at: expiredAt,
        u: upload,
        d: download,
        // transfer_enable / u / d 均为字节；used 与 remain 由服务端算好，避免前端口径不一致。
        transfer_enable: quota,
        used_bytes: used,
        remain_bytes: Math.max(0, quota - used),
        usage_percent: quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0,
        server_time: nowSeconds,
        days_remaining: expiredAt === null ? null : Math.max(0, Math.ceil((expiredAt - nowSeconds) / 86400)),
        email: user.email,
        uuid: user.uuid,
        plan: plan
          ? {
              id: Number(plan.id),
              name: String(plan.name),
              transfer_enable: Number(plan.transfer_enable),
              speed_limit: plan.speed_limit === null ? null : Number(plan.speed_limit),
              renew: plan.is_renewable ? 1 : 0,
            }
          : undefined,
        subscribe_url: subscribeUrl,
        // 已付款、排队等当前套餐到期后生效的套餐（按生效顺序）。
        queued_plans: await listQueuedOrders(user.id),
      },
    });
  } catch (error) {
    const { status, payload } = toApiError(error, "user getSubscribe");
    return NextResponse.json(payload, { status });
  }
}
