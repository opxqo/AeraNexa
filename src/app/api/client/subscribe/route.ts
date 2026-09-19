import { NextResponse, type NextRequest } from "next/server";
import { wantsClash } from "@/lib/server/panel/clash";
import { readDeviceInfo } from "@/lib/server/devices";
import { getSubscriptionFeed } from "@/lib/server/subscription-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 用户订阅：`GET /api/client/subscribe?token=…`。
 * 凭据只有 token（即 users.subscription_token），不依赖登录态；「重置安全信息」会轮换它。
 *
 * 格式：`flag=clash|meta|mihomo|stash` 或 Clash 系 User-Agent → Clash YAML，否则 Base64。
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const token = params.get("token") ?? "";
  const format = wantsClash(params.get("flag"), request.headers.get("user-agent")) ? "clash" : "base64";
  let feed;
  try {
    feed = await getSubscriptionFeed(token, format, readDeviceInfo(request.headers));
  } catch (error) {
    console.error("[subscribe] failed", error);
    return new NextResponse("subscription temporarily unavailable", { status: 503 });
  }
  if (!feed) return new NextResponse("not found", { status: 404 });

  const { upload, download, total, expire } = feed.userInfo;
  return new NextResponse(feed.body, {
    status: 200,
    headers: {
      ...feed.headers,
      "Content-Type": feed.contentType,
      "Cache-Control": "no-store",
      "Content-Disposition": "attachment; filename*=UTF-8''AeraNexa",
      "Profile-Update-Interval": "12",
      "Subscription-Userinfo": `upload=${upload}; download=${download}; total=${total}; expire=${expire}`,
    },
  });
}
