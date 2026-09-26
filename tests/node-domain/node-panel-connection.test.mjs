import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import https from "node:https";
import { after, before, test } from "node:test";
import { X509Certificate } from "node:crypto";
import { addClient, deleteClient, detachClient, getServerStatus, isAllowedPanelEndpoint, listRawInbounds, normalizeCertificateSha256, updateClient } from "../../src/lib/server/panel/client.ts";
import { normalizeNodeBaseUrl } from "../../src/lib/server/panel/node-connections.ts";

const dir = mkdtempSync(join(tmpdir(), "an-node-panel-"));
let server;
let target;
const calls = [];
const token = "local-test-token-12345678901234567890";

before(async () => {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"), "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });
  const key = readFileSync(join(dir, "key.pem"));
  const cert = readFileSync(join(dir, "cert.pem"));
  const pin = createHash("sha256").update(new X509Certificate(cert).raw).digest("hex");
  server = https.createServer({ key, cert }, (req, res) => {
    const path = req.url ?? "";
    calls.push(`${req.method} ${path}`);
    res.setHeader("Content-Type", "application/json");
    if (req.headers.authorization === "Bearer slow-test-token-12345678901234567890") { setTimeout(() => res.writeHead(200).end(JSON.stringify({ success: true, obj: null })), 200); return; }
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
    const obj = path.endsWith("server/status") ? { panelVersion: "0.1.24", panelGuid: "test", xray: { state: "running", version: "26.7.28" }, publicIP: {} }
      : path.endsWith("inbounds/list") ? [{ id: 1, protocol: "vless", clientStats: [] }] : null;
    res.writeHead(200).end(JSON.stringify({ success: true, msg: "", obj }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  target = { baseUrl: `https://127.0.0.1:${server.address().port}`, token, certificateSha256: pin, timeoutMs: 2000 };
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

test("node address and pin validation", () => {
  assert.equal(normalizeNodeBaseUrl(" https://localhost:2053/base/ "), "https://localhost:2053/base");
  assert.throws(() => normalizeNodeBaseUrl("http://localhost:2053"));
  assert.throws(() => normalizeNodeBaseUrl("https://user:pass@localhost"));
  assert.throws(() => normalizeNodeBaseUrl("https://localhost/?x=1"));
  assert.equal(normalizeCertificateSha256(target.certificateSha256.toUpperCase()), target.certificateSha256);
  assert.equal(normalizeCertificateSha256(Buffer.from(target.certificateSha256, "hex").toString("base64")), target.certificateSha256);
});

test("six allowlisted calls reach the pinned TLS endpoint", async () => {
  calls.length = 0;
  assert.equal((await getServerStatus(target)).panelVersion, "0.1.24");
  assert.equal((await listRawInbounds(target)).length, 1);
  const client = { email: "an-test", id: "00000000-0000-4000-8000-000000000001", enable: true };
  await addClient(client, [1], target);
  await updateClient("an-test", client, target);
  await detachClient("an-test", [1], target);
  await deleteClient("an-test", target);
  assert.deepEqual(calls, [
    "GET /panel/api/server/status", "GET /panel/api/inbounds/list", "POST /panel/api/clients/add",
    "POST /panel/api/clients/update/an-test", "POST /panel/api/clients/an-test/detach", "POST /panel/api/clients/del/an-test",
  ]);
  assert.equal(isAllowedPanelEndpoint("POST", "server/restartXrayService"), false);
});

test("wrong certificate and wrong token fail closed", async () => {
  const before = calls.length;
  await assert.rejects(getServerStatus({ ...target, certificateSha256: "0".repeat(64) }), /指纹不匹配/);
  assert.equal(calls.length, before, "a mismatched pin must not send an HTTP request");
  await assert.rejects(getServerStatus({ ...target, token: "wrong-token" }), /Token|401/);
});

test("slow endpoints stop at the configured timeout", async () => {
  await assert.rejects(getServerStatus({ ...target, token: "slow-test-token-12345678901234567890", timeoutMs: 30 }), /超时/);
});
