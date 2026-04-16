import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "admin_token";

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
  const searchParams = request.nextUrl.searchParams.toString();
  const qs = searchParams ? `?${searchParams}` : "";

  let res: Response;
  try {
    res = await fetch(`${backendUrl}/api/admin/depreciation-runs${qs}`, {
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

  const data = (await res.json()) as { runs?: unknown; error?: string };
  if (!res.ok) {
    return NextResponse.json(
      { error: data.error ?? "Could not load depreciation runs." },
      { status: res.status }
    );
  }

  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
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
    res = await fetch(`${backendUrl}/api/admin/depreciation-runs`, {
      method: "POST",
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

  const data = (await res.json()) as {
    run?: unknown;
    detailsInserted?: number;
    error?: string;
  };
  if (!res.ok) {
    return NextResponse.json(
      { error: data.error ?? "Could not create depreciation run." },
      { status: res.status }
    );
  }

  return NextResponse.json(data);
}
