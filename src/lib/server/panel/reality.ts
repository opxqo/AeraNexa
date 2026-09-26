import "server-only";

import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes } from "node:crypto";

/** Xray 的 REALITY 密钥是 32 字节 X25519 原始值的 base64url（无填充），与 JWK 的 d/x 字段一致。 */
export function generateRealityKeys(): { privateKey: string; publicKey: string; shortId: string } {
  const { privateKey } = generateKeyPairSync("x25519");
  const jwk = privateKey.export({ format: "jwk" });
  if (!jwk.d || !jwk.x) throw new Error("X25519 密钥生成失败");
  return { privateKey: jwk.d, publicKey: jwk.x, shortId: randomBytes(8).toString("hex") };
}

const PKCS8_X25519_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");

/** 由节点上实际使用的私钥推导客户端公钥，不依赖任何另存的 publicKey 字段。 */
export function realityPublicKey(privateKey: string): string | null {
  const raw = Buffer.from(privateKey, "base64url");
  if (raw.length !== 32) return null;
  try {
    const key = createPrivateKey({ key: Buffer.concat([PKCS8_X25519_PREFIX, raw]), format: "der", type: "pkcs8" });
    return createPublicKey(key).export({ format: "jwk" }).x ?? null;
  } catch {
    return null;
  }
}

/** 伪装目标须为 域名:端口；SNI 取同一域名。 */
export function parseRealityTarget(value: string): { target: string; serverName: string } {
  const match = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+):(\d{1,5})$/.exec(value.trim());
  const port = Number(match?.[2]);
  if (!match || port < 1 || port > 65535 || !/[A-Za-z]/.test(match[1].split(".").pop() ?? "")) throw new Error("伪装目标须为 域名:端口，例如 dl.google.com:443");
  return { target: `${match[1].toLowerCase()}:${port}`, serverName: match[1].toLowerCase() };
}

function objectOf(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return objectOf(JSON.parse(value)); } catch { return {}; }
  }
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export type RealityClientInfo = { publicKey: string; serverName: string; shortId: string };

/** 从节点返回的入站里取出客户端连接所需参数；非 REALITY 入站返回 null。 */
export function realityClientInfo(inbound: Record<string, unknown>): RealityClientInfo | null {
  const stream = objectOf(inbound.streamSettings);
  if (stream.security !== "reality") return null;
  const reality = objectOf(stream.realitySettings);
  const publicKey = typeof reality.privateKey === "string" ? realityPublicKey(reality.privateKey) : null;
  const first = (value: unknown) => (Array.isArray(value) && typeof value[0] === "string" ? value[0] : "");
  return { publicKey: publicKey ?? "（无法推导）", serverName: first(reality.serverNames), shortId: first(reality.shortIds) };
}
