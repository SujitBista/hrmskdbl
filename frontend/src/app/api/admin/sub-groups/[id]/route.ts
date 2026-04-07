import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "admin_token";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const res = await fetch(
    `${backendUrl}/api/admin/sub-groups/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }
  );

  const data = (await res.json()) as {
    subGroup?: unknown;
    error?: string;
  };

  if (!res.ok) {
    return NextResponse.json(
      { error: data.error ?? "Could not update asset sub group." },
      { status: res.status }
    );
  }

  return NextResponse.json(data);
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";

  const res = await fetch(
    `${backendUrl}/api/admin/sub-groups/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (res.status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  const data = (await res.json().catch(() => ({}))) as { error?: string };

  return NextResponse.json(
    { error: data.error ?? "Could not delete asset sub group." },
    { status: res.status }
  );
}
