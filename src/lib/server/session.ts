import "server-only";

import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { getDbPool } from "./db";

export const SESSION_COOKIE_NAME = "aeranexa_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

function getSessionSecret(): Uint8Array {
  const configured = process.env.AUTH_SESSION_SECRET?.trim();
  if (configured) return new TextEncoder().encode(configured);

  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SESSION_SECRET is required in production");
  }

  return new TextEncoder().encode("aeranexa-local-development-session-secret");
}

type SessionRow = RowDataPacket & { user_id: number | string };

async function verifySessionToken(token: string) {
  const { payload } = await jwtVerify(token, getSessionSecret(), {
    algorithms: ["HS256"],
  });
  const userId = Number(payload.sub);
  const sessionId = typeof payload.sid === "string" ? payload.sid : "";
  if (
    payload.kind !== "aeranexa-session" ||
    !Number.isSafeInteger(userId) ||
    userId < 1 ||
    !sessionId
  ) {
    return null;
  }
  return { userId, sessionId };
}

export async function createSessionToken(userId: number, sessionId: string): Promise<string> {
  return new SignJWT({ kind: "aeranexa-session", sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSessionSecret());
}

export async function setSessionCookie(userId: number): Promise<void> {
  const sessionId = randomUUID();
  await getDbPool().execute(
    "INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND))",
    [sessionId, userId, SESSION_MAX_AGE],
  );

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, await createSessionToken(userId, sessionId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    try {
      const session = await verifySessionToken(token);
      if (session) {
        await getDbPool().execute(
          "UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
          [session.sessionId, session.userId],
        );
      }
    } catch {
      // Invalid tokens still need their browser cookie removed.
    }
  }

  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function revokeUserSessions(userId: number): Promise<void> {
  await getDbPool().execute(
    "UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL",
    [userId],
  );
}

export async function getSessionUserId(): Promise<number | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const session = await verifySessionToken(token);
    if (!session) return null;

    const [rows] = await getDbPool().execute<SessionRow[]>(
      `SELECT user_id
       FROM auth_sessions
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP
       LIMIT 1`,
      [session.sessionId, session.userId],
    );
    return rows[0] ? Number(rows[0].user_id) : null;
  } catch {
    return null;
  }
}
