import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json({ message: "找回密码需要先配置邮箱服务，当前尚未启用" }, { status: 501 });
}
