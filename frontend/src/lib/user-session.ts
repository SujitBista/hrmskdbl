import { cookies } from "next/headers";
import * as jose from "jose";

const COOKIE_NAME = "user_token";

export type UserSession = {
  id: number;
  email: string;
  jobRole: string;
  perm_view: boolean;
  perm_edit: boolean;
  perm_delete: boolean;
};

function asBool(v: unknown): boolean {
  return v === true || v === "true";
}

export async function getUserSession(): Promise<UserSession | null> {
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
    if (payload.role !== "user") {
      return null;
    }
    const id = Number(payload.sub);
    const email = typeof payload.email === "string" ? payload.email : "";
    const jobRole =
      typeof payload.jobRole === "string" ? payload.jobRole : "";
    if (!Number.isFinite(id) || !email || !jobRole) {
      return null;
    }
    return {
      id,
      email,
      jobRole,
      perm_view: asBool(payload.perm_view),
      perm_edit: asBool(payload.perm_edit),
      perm_delete: asBool(payload.perm_delete),
    };
  } catch {
    return null;
  }
}
