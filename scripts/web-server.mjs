import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import next from "next";
import { jwtVerify } from "jose";
import { emitRuntimeLog, drainRuntimeLogs, safeLogPath, safeError } from "../src/lib/server/runtime-logs.ts";
import { pruneRuntimeLogs } from "../src/lib/server/log-retention.ts";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT || 3000);
const hostname = process.env.HOSTNAME || "0.0.0.0";
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port");

let handle;

async function actorIdFor(req) {
  const cookie = req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("aeranexa_session="));
  if (!cookie) return null;
  const secret = process.env.AUTH_SESSION_SECRET?.trim() || (dev ? "aeranexa-local-development-session-secret" : "");
  if (!secret) return null;
  try {
    const token = decodeURIComponent(cookie.slice("aeranexa_session=".length));
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"] });
    const actorId = Number(payload.sub);
    return payload.kind === "aeranexa-session" && Number.isSafeInteger(actorId) && actorId > 0 ? actorId : null;
  } catch { return null; }
}

function shouldLog(path) {
  return !path.startsWith("/_next/") && !path.startsWith("/__nextjs") &&
    !path.startsWith("/assets/") && !path.startsWith("/brand/") &&
    !path.startsWith("/icons/") && !path.startsWith("/flags/") &&
    !path.startsWith("/os-icons/") && !path.startsWith("/payment-icons/") &&
    !/\.(?:ico|png|jpg|jpeg|svg|webp|gif|css|js|map|woff2?|txt|webmanifest)$/.test(path);
}

const server = createServer((req, res) => {
  const path = safeLogPath(req.url || "/");
  const tracked = shouldLog(path);
  const requestId = randomUUID();
  const start = process.hrtime.bigint();
  const actorId = tracked ? actorIdFor(req) : Promise.resolve(null);
  let completed = false;
  if (tracked) {
    req.headers["x-request-id"] = requestId;
    res.setHeader("x-request-id", requestId);
  }
  const finish = (statusCode) => {
    if (completed || !tracked) return;
    completed = true;
    const durationMs = Math.max(0, Math.round(Number(process.hrtime.bigint() - start) / 1_000_000));
    void actorId.then((resolvedActorId) => {
      const fields = { service: "web", requestId, actorId: resolvedActorId, method: req.method || "GET", path, statusCode, durationMs };
      void emitRuntimeLog({ ...fields, category: "access", level: statusCode >= 500 ? "error" : "info", eventCode: "http.request", message: `${fields.method} ${path} ${statusCode}` });
      if (durationMs >= 1000) void emitRuntimeLog({ ...fields, category: "slow", level: "warn", eventCode: "http.slow", message: `${fields.method} ${path} took ${durationMs}ms` });
    });
  };
  res.once("finish", () => finish(res.statusCode));
  res.once("close", () => finish(499));
  Promise.resolve(handle(req, res)).catch((error) => {
    void emitRuntimeLog({ service: "web", category: "error", level: "error", eventCode: "http.handler_error", message: safeError(error), requestId, method: req.method || "GET", path });
    if (!res.headersSent) { res.statusCode = 500; res.end("Internal Server Error"); }
    else res.destroy(error);
  });
});

const app = next({ dev, hostname, port, httpServer: server });
handle = app.getRequestHandler();
await app.prepare();

server.listen(port, hostname, () => {
  process.stdout.write(`${JSON.stringify({ event: "web.started", port, hostname, mode: dev ? "development" : "production" })}\n`);
});

const retentionTimer = setInterval(() => {
  void pruneRuntimeLogs().then((deleted) => {
    if (deleted) void emitRuntimeLog({ service: "web", category: "error", level: "info", eventCode: "log.retention", message: `Removed ${deleted} expired runtime logs` });
  }).catch((error) => process.stderr.write(`${JSON.stringify({ event: "log.retention_failed", error: safeError(error) })}\n`));
}, 60 * 60_000);
retentionTimer.unref();
const firstPrune = setTimeout(() => { void pruneRuntimeLogs().catch((error) => process.stderr.write(`${JSON.stringify({ event: "log.retention_failed", error: safeError(error) })}\n`)); }, 60_000);
firstPrune.unref();

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  clearInterval(retentionTimer);
  clearTimeout(firstPrune);
  const closed = new Promise((resolve) => server.close(resolve));
  const forced = new Promise((resolve) => {
    const timer = setTimeout(() => { server.closeAllConnections(); resolve(); }, 10_000);
    timer.unref();
  });
  await Promise.race([closed, forced]);
  await drainRuntimeLogs();
  process.stdout.write(`${JSON.stringify({ event: "web.stopped", signal })}\n`);
  process.exit(0);
}
process.on("SIGINT", () => { void shutdown("SIGINT"); });
process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
