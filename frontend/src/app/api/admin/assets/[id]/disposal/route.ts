import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "admin_token";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
  let res: Response;
  try {
    res = await fetch(
      `${backendUrl}/api/admin/assets/${encodeURIComponent(id)}/disposal`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Could not reach the API server." },
      { status: 502 }
    );
  }

  let data: { error?: string } = {};
  try {
    data = (await res.json()) as { error?: string };
  } catch {
    return NextResponse.json(
      { error: "Invalid response from API server." },
      { status: 502 }
    );
  }

  return NextResponse.json(data, { status: res.status });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
  let res: Response;
  try {
    res = await fetch(
      `${backendUrl}/api/admin/assets/${encodeURIComponent(id)}/disposal`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Could not reach the API server." },
      { status: 502 }
    );
  }

  let data: { error?: string } = {};
  try {
    data = (await res.json()) as { error?: string };
  } catch {
    return NextResponse.json(
      { error: "Invalid response from API server." },
      { status: 502 }
    );
  }

  return NextResponse.json(data, { status: res.status });
}
