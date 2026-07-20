import { cookies } from "next/headers";
import { shouldUseSecureAuthCookie } from "@/lib/should-use-secure-auth-cookie";
import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "admin_token";

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: shouldUseSecureAuthCookie(request),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return NextResponse.json({ ok: true });
}
