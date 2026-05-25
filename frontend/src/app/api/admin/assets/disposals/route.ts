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
    res = await fetch(`${backendUrl}/api/admin/assets/disposals${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
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

  if (!res.ok) {
    return NextResponse.json(
      { error: data.error ?? "Could not load disposed assets." },
      { status: res.status }
    );
  }

  return NextResponse.json(data);
}
