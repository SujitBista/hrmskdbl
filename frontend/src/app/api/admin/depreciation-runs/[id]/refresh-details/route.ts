import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "admin_token";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";

  let body: Record<string, unknown> = {};
  try {
    const parsed = (await request.json()) as unknown;
    if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    body = {};
  }

  let res: Response;
  try {
    res = await fetch(
      `${backendUrl}/api/admin/depreciation-runs/${id}/refresh-details`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );
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
    skippedAssets?: unknown;
    redirectToRunId?: number;
    error?: string;
  };
  if (!res.ok) {
    return NextResponse.json(
      { error: data.error ?? "Could not refresh depreciation run details." },
      { status: res.status }
    );
  }

  return NextResponse.json(data);
}
