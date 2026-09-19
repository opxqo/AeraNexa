import { NextRequest, NextResponse } from "next/server";

const targetBaseUrl =
  process.env.V2BOARD_API_URL ||
  process.env.BACKEND_API_URL ||
  "http://127.0.0.1:8000/api/v1";

async function proxyRequest(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const subPath = path.join("/");
  const search = request.nextUrl.search;
  const targetUrl = `${targetBaseUrl.replace(/\/+$/, "")}/${subPath}${search}`;

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    // 排除特定逐跳标头
    if (!["host", "connection", "content-length"].includes(key.toLowerCase())) {
      headers[key] = value;
    }
  });

  try {
    let body: any = undefined;
    if (["POST", "PUT", "PATCH"].includes(request.method)) {
      const contentType = request.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        body = await request.text();
      } else if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
        body = await request.arrayBuffer();
      } else {
        body = await request.text();
      }
    }

    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
    });

    const responseData = await response.arrayBuffer();
    const respHeaders: Record<string, string> = {};
    response.headers.forEach((val, key) => {
      respHeaders[key] = val;
    });

    return new NextResponse(responseData, {
      status: response.status,
      statusText: response.statusText,
      headers: respHeaders,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        message: `后端服务连接异常 (${targetBaseUrl})，请确认 V2Board 服务是否启动或检查环境变量配置。`,
        detail: err.message,
      },
      { status: 502 },
    );
  }
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const DELETE = proxyRequest;
export const PATCH = proxyRequest;
