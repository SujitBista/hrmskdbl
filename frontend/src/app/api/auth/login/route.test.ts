import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

describe("POST /api/auth/login", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockBackendLogin() {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            token: "jwt-token",
            admin: { id: 1, email: "admin@saptakoshi.com" },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
      )
    );
  }

  async function postLogin(url: string, headers?: Record<string, string>) {
    mockBackendLogin();
    return POST(
      new NextRequest(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          email: "admin@saptakoshi.com",
          password: "Hrms@2026!",
        }),
      })
    );
  }

  it("does not mark the auth cookie as secure for plain HTTP LAN access", async () => {
    const response = await postLogin("http://192.168.1.229:3000/api/auth/login");
    const setCookie = response.headers.get("set-cookie");

    expect(setCookie).toContain("admin_token=jwt-token");
    expect(setCookie).not.toContain("Secure");
  });

  it("marks the auth cookie as secure when the request is HTTPS", async () => {
    const response = await postLogin("https://example.com/api/auth/login");
    const setCookie = response.headers.get("set-cookie");

    expect(setCookie).toContain("admin_token=jwt-token");
    expect(setCookie).toContain("Secure");
  });

  it("trusts x-forwarded-proto when running behind a proxy", async () => {
    const response = await postLogin(
      "http://127.0.0.1:3000/api/auth/login",
      { "x-forwarded-proto": "https" }
    );
    const setCookie = response.headers.get("set-cookie");

    expect(setCookie).toContain("admin_token=jwt-token");
    expect(setCookie).toContain("Secure");
  });
});
