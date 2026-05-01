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
    res = await fetch(`${backendUrl}/api/admin/asset-allocations${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      {
        error:
          "Could not reach the API server. Start the backend and check BACKEND_URL.",
      },
      { status: 502 }
    );
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid response from API server." },
      { status: 502 }
    );
  }

  if (!res.ok) {
    const errBody = data as { error?: string };
    return NextResponse.json(
      { error: errBody.error ?? "Could not load asset allocations." },
      { status: res.status }
    );
  }

  return NextResponse.json(data);
}
