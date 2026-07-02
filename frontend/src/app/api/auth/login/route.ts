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

  let res: Response;
  try {
    res = await fetch(`${backendUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      {
        error:
          "Could not reach the API server. Start the backend (e.g. npm run dev) and check BACKEND_URL.",
      },
      { status: 502 }
    );
  }

  let data = {} as { token?: string; admin?: unknown; error?: string };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    return NextResponse.json(
      { error: "Unexpected response from server." },
      { status: 502 }
    );
  }

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

  const response = NextResponse.json({ admin: data.admin });
  response.cookies.set(COOKIE_NAME, data.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return response;
}
