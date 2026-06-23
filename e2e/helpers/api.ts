import type { APIRequestContext } from "@playwright/test";
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_BACKEND_URL } from "./constants";

export type AuthSession = {
  token: string;
  headers: Record<string, string>;
};

export async function loginAdmin(
  request: APIRequestContext
): Promise<AuthSession> {
  const res = await request.post(`${E2E_BACKEND_URL}/api/auth/login`, {
    data: {
      email: E2E_ADMIN_EMAIL,
      password: E2E_ADMIN_PASSWORD,
    },
  });
  if (!res.ok()) {
    throw new Error(
      `Admin login failed (${res.status()}): ${await res.text()}`
    );
  }
  const body = (await res.json()) as { token?: string };
  if (!body.token) {
    throw new Error("Admin login response missing token.");
  }
  return {
    token: body.token,
    headers: {
      Authorization: `Bearer ${body.token}`,
      "Content-Type": "application/json",
    },
  };
}

export async function apiJson<T>(
  request: APIRequestContext,
  auth: AuthSession,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  urlPath: string,
  data?: unknown
): Promise<{ status: number; body: T; text: string }> {
  const url = urlPath.startsWith("http")
    ? urlPath
    : `${E2E_BACKEND_URL}${urlPath}`;
  const res = await request.fetch(url, {
    method,
    headers: auth.headers,
    data: data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await res.text();
  let body: T;
  try {
    body = text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    body = { raw: text } as T;
  }
  return { status: res.status(), body, text };
}
