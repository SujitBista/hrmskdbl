import * as jose from "jose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const ADMIN_COOKIE = "admin_token";
const USER_COOKIE = "user_token";

async function verifyUserToken(
  token: string,
  secret: string
): Promise<boolean> {
  try {
    const { payload } = await jose.jwtVerify(
      token,
      new TextEncoder().encode(secret)
    );
    return payload.role === "user";
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const secret = process.env.JWT_SECRET;
  const adminToken = request.cookies.get(ADMIN_COOKIE)?.value;
  const userToken = request.cookies.get(USER_COOKIE)?.value;
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/dashboard")) {
    if (!userToken || !secret) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    const ok = await verifyUserToken(userToken, secret);
    if (!ok) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return NextResponse.next();
  }

  if (pathname === "/login" || pathname === "/login/") {
    if (userToken && secret) {
      const ok = await verifyUserToken(userToken, secret);
      if (ok) {
        return NextResponse.redirect(new URL("/dashboard", request.url));
      }
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/admin/dashboard")) {
    if (!adminToken || !secret) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    try {
      const { payload } = await jose.jwtVerify(
        adminToken,
        new TextEncoder().encode(secret)
      );
      if (payload.role !== "admin") {
        return NextResponse.redirect(new URL("/admin", request.url));
      }
      return NextResponse.next();
    } catch {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
  }

  if (pathname === "/admin" || pathname === "/admin/") {
    if (adminToken && secret) {
      try {
        const { payload } = await jose.jwtVerify(
          adminToken,
          new TextEncoder().encode(secret)
        );
        if (payload.role === "admin") {
          return NextResponse.redirect(new URL("/admin/dashboard", request.url));
        }
      } catch {
        return NextResponse.next();
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/login",
    "/login/:path*",
    "/dashboard",
    "/dashboard/:path*",
    "/admin",
    "/admin/dashboard",
    "/admin/dashboard/:path*",
  ],
};
