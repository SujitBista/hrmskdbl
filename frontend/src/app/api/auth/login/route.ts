import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "admin_token";

export async function POST(request: NextRequest) {
  const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const res = await fetch(`${backendUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as { token?: string; admin?: unknown; error?: string };

  if (!res.ok) {
    return NextResponse.json(
      { error: data.error ?? "Login failed." },
      { status: res.status }
    );
  }

  if (!data.token || !data.admin) {
    return NextResponse.json(
      { error: "Unexpected response from server." },
      { status: 502 }
    );
  }

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, data.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return NextResponse.json({ admin: data.admin });
}
