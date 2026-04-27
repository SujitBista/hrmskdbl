import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const COOKIE_NAME = "admin_token";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
  let res: Response;
  try {
    res = await fetch(
      `${backendUrl}/api/admin/depreciation-runs/ensure-current`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
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

  let data = {} as {
    run?: unknown;
    detailsInserted?: number;
    skippedAssets?: unknown;
    error?: string;
  };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    return NextResponse.json(
      { error: "Invalid response from API server." },
      { status: 502 }
    );
  }
  if (!res.ok) {
    return NextResponse.json(
      {
        error:
          data.error ??
          "Could not calculate depreciation for the current fiscal year.",
      },
      { status: res.status }
    );
  }

  return NextResponse.json(data);
}
