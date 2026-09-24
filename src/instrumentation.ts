import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/server/bootstrap-admin");
  }
}

/** Next.js 未由 Route Handler 捕获的服务端异常。 */
export const onRequestError: Instrumentation.onRequestError = async (error, request) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { emitRuntimeLog, safeError, safeLogPath } = await import("@/lib/server/runtime-logs");
  await emitRuntimeLog({
    service: "web", category: "error", level: "error", eventCode: "next.request_error",
    message: safeError(error), method: request.method, path: safeLogPath(request.path),
    requestId: typeof request.headers["x-request-id"] === "string" ? request.headers["x-request-id"] : null,
  });
};
