import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const COOKIE_NAME = "admin_token";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";

  let res: Response;
  try {
    res = await fetch(`${backendUrl}/api/admin/depreciation-runs/${id}/void`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
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

  const data = (await res.json()) as { run?: unknown; error?: string };
  if (!res.ok) {
    return NextResponse.json(
      { error: data.error ?? "Could not void depreciation run." },
      { status: res.status }
    );
  }

  return NextResponse.json(data);
}
