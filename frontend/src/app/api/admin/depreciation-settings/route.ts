import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "admin_token";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";

  let res: Response;
  try {
    res = await fetch(`${backendUrl}/api/admin/depreciation-settings`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      {
        error:
          "Could not reach the API server. Start the backend (e.g. npm run dev in backend) and check BACKEND_URL.",
      },
      { status: 502 }
    );
  }

  let data = {} as {
    settings?: unknown;
    auditLogs?: unknown;
    error?: string;
  };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    return NextResponse.json(
      { error: "Invalid response from API server." },
      { status: 502 }
    );
  }
  if (!res.ok) {
    return NextResponse.json(
      { error: data.error ?? "Could not load depreciation settings." },
      { status: res.status }
    );
  }

  return NextResponse.json(data);
}

export async function PUT(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(`${backendUrl}/api/admin/depreciation-settings`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      {
        error:
          "Could not reach the API server. Start the backend (e.g. npm run dev in backend) and check BACKEND_URL.",
      },
      { status: 502 }
    );
  }

  let data = {} as {
    settings?: unknown;
    auditLogs?: unknown;
    error?: string;
  };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    return NextResponse.json(
      { error: "Invalid response from API server." },
      { status: 502 }
    );
  }
  if (!res.ok) {
    return NextResponse.json(
      { error: data.error ?? "Could not save depreciation settings." },
      { status: res.status }
    );
  }

  return NextResponse.json(data);
}
