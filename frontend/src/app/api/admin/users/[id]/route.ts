import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "admin_token";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
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

  const res = await fetch(`${backendUrl}/api/admin/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as {
    user?: unknown;
    error?: string;
  };

  if (!res.ok) {
    return NextResponse.json(
      { error: data.error ?? "Could not update user." },
      { status: res.status }
    );
  }

  return NextResponse.json(data);
}

export async function DELETE(
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
  const res = await fetch(`${backendUrl}/api/admin/users/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  let data: { error?: string } = {};
  try {
    data = (await res.json()) as { error?: string };
  } catch {
    /* empty */
  }

  return NextResponse.json(
    { error: data.error ?? "Could not delete user." },
    { status: res.status }
  );
}
