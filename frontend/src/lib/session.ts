import { cookies } from "next/headers";
import * as jose from "jose";

const COOKIE_NAME = "admin_token";

export type AdminSession = {
  id: number;
  email: string;
};

export async function getSession(): Promise<AdminSession | null> {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return null;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  try {
    const { payload } = await jose.jwtVerify(
      token,
      new TextEncoder().encode(secret)
    );
    if (payload.role !== "admin") {
      return null;
    }
    const id = Number(payload.sub);
    const email = typeof payload.email === "string" ? payload.email : "";
    if (!Number.isFinite(id) || !email) {
      return null;
    }
    return { id, email };
  } catch {
    return null;
  }
}
