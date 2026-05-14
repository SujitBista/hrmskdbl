import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "admin_token";

export async function GET(
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
  const fy = request.nextUrl.searchParams.get("fiscalYearStart");
  const qs = new URLSearchParams();
  if (fy != null && fy.trim() !== "") {
    qs.set("fiscalYearStart", fy.trim());
  }
  const backendQs = qs.toString();
  let res: Response;
  try {
    res = await fetch(
      `${backendUrl}/api/admin/assets/${encodeURIComponent(id)}/allocation-profile${backendQs ? `?${backendQs}` : ""}`,
      { headers: { Authorization: `Bearer ${token}` } }
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
      { error: data.error ?? "Could not load allocation profile." },
      { status: res.status }
    );
  }

  return NextResponse.json(data);
}
