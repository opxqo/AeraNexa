import assert from "node:assert/strict";
import { test } from "node:test";
import { generateRealityKeys, parseRealityTarget, realityClientInfo, realityPublicKey } from "../../src/lib/server/panel/reality.ts";

// Pair produced by AN and confirmed with `xray x25519 -i` (Xray 26.7.28).
const XRAY_PRIVATE = "MKKNVoWV-97w6M0k2WR4yDr-5zTFltutmZbLW14Uom4";
const XRAY_PUBLIC = "yNC46WHfDEwG-QakG_ytAMu2Hsvs29girmcImuSUTTA";

test("public key derivation matches Xray and generated pairs are consistent", () => {
  assert.equal(realityPublicKey(XRAY_PRIVATE), XRAY_PUBLIC);
  assert.equal(realityPublicKey("too-short"), null);
  const keys = generateRealityKeys();
  assert.equal(realityPublicKey(keys.privateKey), keys.publicKey);
  assert.match(keys.shortId, /^[0-9a-f]{16}$/);
});

test("camouflage target must be domain:port", () => {
  assert.deepEqual(parseRealityTarget(" DL.Google.com:443 "), { target: "dl.google.com:443", serverName: "dl.google.com" });
  for (const bad of ["dl.google.com", "https://dl.google.com:443", "1.2.3.4:443", "dl.google.com:0", "dl.google.com:443/x"]) {
    assert.throws(() => parseRealityTarget(bad), /域名:端口/, bad);
  }
});

test("client info is read from the node's inbound, including string-encoded stream settings", () => {
  const stream = { network: "tcp", security: "reality", realitySettings: { privateKey: XRAY_PRIVATE, serverNames: ["dl.google.com"], shortIds: ["5b808721e3c1a854"] } };
  const want = { publicKey: XRAY_PUBLIC, serverName: "dl.google.com", shortId: "5b808721e3c1a854" };
  assert.deepEqual(realityClientInfo({ streamSettings: stream }), want);
  assert.deepEqual(realityClientInfo({ streamSettings: JSON.stringify(stream) }), want);
  assert.equal(realityClientInfo({ streamSettings: { network: "tcp", security: "none" } }), null);
});
