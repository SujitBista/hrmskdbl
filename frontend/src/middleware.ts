import * as jose from "jose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const ADMIN_COOKIE = "admin_token";

export async function middleware(request: NextRequest) {
  const secret = process.env.JWT_SECRET;
  const adminToken = request.cookies.get(ADMIN_COOKIE)?.value;
  const { pathname } = request.nextUrl;

  if (pathname === "/login" || pathname === "/login/") {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  if (pathname.startsWith("/dashboard")) {
    return NextResponse.redirect(new URL("/admin", request.url));
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
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("x-pathname", pathname);
      return NextResponse.next({
        request: { headers: requestHeaders },
      });
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
          return NextResponse.redirect(
            new URL("/admin/dashboard/asset-register", request.url)
          );
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
