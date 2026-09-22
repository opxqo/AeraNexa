import { NextResponse } from "next/server";
import { toApiError, unauthenticated } from "@/lib/server/errors";
import { subscribeMonitor, type MonitorRelayEvent } from "@/lib/server/monitor/relay";
import { getCurrentUser } from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEEPALIVE_MS = 15_000;
/** 到时由服务端关闭，EventSource 自动重连并重新鉴权，会话被撤销后不会一直推送。 */
const MAX_STREAM_MS = 10 * 60_000;

/**
 * 节点状态页的实时数据流（SSE）：snapshot / update / status 三种事件，
 * 数据来自服务端中继（src/lib/server/monitor/relay.ts），浏览器不接触 CF-Server-Monitor 地址与凭据。
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    const { status, payload } = toApiError(unauthenticated(), "monitor stream");
    return NextResponse.json(payload, { status });
  }

  const encoder = new TextEncoder();
  let close = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe = () => {};

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };

      const keepalive = setInterval(() => write(": keepalive\n\n"), KEEPALIVE_MS);
      const lifetime = setTimeout(() => close(), MAX_STREAM_MS);

      close = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        clearTimeout(lifetime);
        unsubscribe();
        request.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          // 已被客户端取消
        }
      };
      request.signal.addEventListener("abort", close);

      write("retry: 3000\n\n");
      unsubscribe = subscribeMonitor((event: MonitorRelayEvent) => {
        write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
      });
    },
    cancel() {
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
