import * as jose from "jose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const COOKIE_NAME = "admin_token";

export async function middleware(request: NextRequest) {
  const secret = process.env.JWT_SECRET;
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/admin/dashboard")) {
    if (!token || !secret) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    try {
      await jose.jwtVerify(token, new TextEncoder().encode(secret));
      return NextResponse.next();
    } catch {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
  }

  if (pathname === "/admin" || pathname === "/admin/") {
    if (token && secret) {
      try {
        await jose.jwtVerify(token, new TextEncoder().encode(secret));
        return NextResponse.redirect(new URL("/admin/dashboard", request.url));
      } catch {
        return NextResponse.next();
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/dashboard/:path*"],
};
