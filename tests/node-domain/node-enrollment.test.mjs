import assert from "node:assert/strict";
import { createHash, X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { getDbPool } from "../../src/lib/server/db.ts";
import { createEnrollmentCode, enrollNode, EnrollmentError } from "../../src/lib/server/panel/node-enrollment.ts";

const dir = mkdtempSync(join(tmpdir(), "an-node-enroll-"));
const token = "enroll-test-token-1234567890abcdefgh";
const guid = "0123456789abcdef0123456789abcdef";
let server;
let baseUrl;
let pin;
const names = [];

before(async () => {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"), "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });
  const cert = readFileSync(join(dir, "cert.pem"));
  pin = createHash("sha256").update(new X509Certificate(cert).raw).digest("base64");
  server = https.createServer({ key: readFileSync(join(dir, "key.pem")), cert }, (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
    res.writeHead(200).end(JSON.stringify({ success: true, msg: "", obj: { panelVersion: "0.1.25-node", panelGuid: guid, xray: {}, publicIP: {} } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `https://127.0.0.1:${server.address().port}`;
});

after(async () => {
  const pool = getDbPool();
  if (names.length) {
    await pool.query("DELETE FROM node_panel_connections WHERE name IN (?)", [names]);
    await pool.query("DELETE FROM node_enrollment_codes WHERE name IN (?)", [names]);
  }
  await pool.end();
  if (server) await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

async function newCode(url = baseUrl) {
  const name = `enroll-test-${Math.random().toString(36).slice(2, 10)}`;
  names.push(name);
  const { code } = await createEnrollmentCode({ name, baseUrl: url, createdBy: 1 });
  return { name, code };
}

const report = (code, overrides = {}) => ({ code, token, certSha256: pin, listenPort: "2053", basePath: "/", version: "0.1.25-node", xrayVersion: "26.7.28", guid, ...overrides });

async function rejects(promise, status, pattern) {
  await assert.rejects(promise, (error) => error instanceof EnrollmentError && error.status === status && pattern.test(error.message));
}

test("a valid code registers a disabled connection after the pinned callback succeeds", async () => {
  const { name, code } = await newCode();
  const result = await enrollNode(report(code), "203.0.113.9");
  const [[row]] = await getDbPool().query("SELECT name, base_url, certificate_sha256, is_enabled FROM node_panel_connections WHERE id = ?", [result.connectionId]);
  assert.deepEqual({ ...row, is_enabled: Number(row.is_enabled) }, { name, base_url: baseUrl, certificate_sha256: Buffer.from(pin, "base64").toString("hex"), is_enabled: 0 });
  const [[codeRow]] = await getDbPool().query("SELECT connection_id, used_ip FROM node_enrollment_codes WHERE name = ?", [name]);
  assert.equal(Number(codeRow.connection_id), result.connectionId);
  assert.equal(codeRow.used_ip, "203.0.113.9");
});

test("a code works once; replay and expired codes are refused", async () => {
  const { code } = await newCode();
  await enrollNode(report(code), null);
  await rejects(enrollNode(report(code), null), 403, /无效或已过期/);
  const expired = await newCode();
  await getDbPool().query("UPDATE node_enrollment_codes SET expires_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 MINUTE) WHERE name = ?", [expired.name]);
  await rejects(enrollNode(report(expired.code), null), 403, /无效或已过期/);
});

test("mismatched guid or certificate is refused, saves nothing and still burns the code", async () => {
  for (const [overrides, status, pattern] of [
    [{ guid: "ffffffffffffffffffffffffffffffff" }, 422, /实例标识不一致/],
    [{ certSha256: Buffer.alloc(32, 1).toString("base64") }, 422, /指纹不匹配/],
    [{ token: "wrong-token-1234567890abcdefghijkl" }, 422, /回连节点/],
  ]) {
    const { name, code } = await newCode();
    await rejects(enrollNode(report(code, overrides), null), status, pattern);
    const [[count]] = await getDbPool().query("SELECT COUNT(*) AS n FROM node_panel_connections WHERE name = ?", [name]);
    assert.equal(Number(count.n), 0);
    await rejects(enrollNode(report(code), null), 403, /无效或已过期/);
  }
});
