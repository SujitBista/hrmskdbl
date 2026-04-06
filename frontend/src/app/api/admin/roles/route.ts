import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const COOKIE_NAME = "admin_token";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
  const res = await fetch(`${backendUrl}/api/admin/roles`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = (await res.json()) as { roles?: string[]; error?: string };

  if (!res.ok) {
    return NextResponse.json(
      { error: data.error ?? "Could not load roles." },
      { status: res.status }
    );
  }

  return NextResponse.json(data);
}
