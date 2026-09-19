import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

const sessionCookieName = "aeranexa_session";

function redirectToLogin(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.delete(sessionCookieName);
  return response;
}

function getSessionSecret(): Uint8Array {
  const configured = process.env.AUTH_SESSION_SECRET?.trim();
  if (configured) return new TextEncoder().encode(configured);

  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SESSION_SECRET is required in production");
  }

  return new TextEncoder().encode("aeranexa-local-development-session-secret");
}

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(sessionCookieName)?.value;
  if (!token) return redirectToLogin(request);

  try {
    const { payload } = await jwtVerify(token, getSessionSecret(), {
      algorithms: ["HS256"],
    });
    const userId = Number(payload.sub);
    if (
      payload.kind !== "aeranexa-session" ||
      typeof payload.sid !== "string" ||
      !payload.sid ||
      !Number.isSafeInteger(userId) ||
      userId < 1
    ) {
      return redirectToLogin(request);
    }
    return NextResponse.next();
  } catch {
    return redirectToLogin(request);
  }
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/knowledge/:path*",
    "/plan/:path*",
    "/node/:path*",
    "/order/:path*",
    "/invite/:path*",
    "/profile/:path*",
    "/ticket/:path*",
    "/traffic/:path*",
    "/admin/:path*",
  ],
};
