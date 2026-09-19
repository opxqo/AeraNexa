import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/users";
import type { RowDataPacket } from "mysql2";
import { getDbPool } from "@/lib/server/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "未登录或登录已过期" }, { status: 401 });

    const baseUrl = (process.env.SUBSCRIBE_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
    const subscribeUrl = `${baseUrl}/api/v1/client/subscribe?token=${encodeURIComponent(user.subscription_token)}`;
    const [plans] = await getDbPool().execute<RowDataPacket[]>("SELECT id, name, transfer_enable, speed_limit, is_renewable FROM plans WHERE id = ? LIMIT 1", [user.plan_id]);
    const plan = plans[0];

    return NextResponse.json({
      data: {
        plan_id: user.plan_id,
        token: user.subscription_token,
        expired_at: user.expired_at === null ? null : Number(user.expired_at),
        u: Number(user.upload_bytes),
        d: Number(user.download_bytes),
        transfer_enable: Number(user.transfer_enable),
        email: user.email,
        uuid: user.uuid,
        plan: plan ? { id: Number(plan.id), name: String(plan.name), transfer_enable: Number(plan.transfer_enable), speed_limit: plan.speed_limit === null ? null : Number(plan.speed_limit), renew: plan.is_renewable ? 1 : 0 } : undefined,
        subscribe_url: subscribeUrl,
      },
    });
  } catch (error) {
    console.error("AeraNexa subscription lookup failed", error);
    return NextResponse.json({ message: "用户系统暂不可用，请检查数据库配置" }, { status: 503 });
  }
}
