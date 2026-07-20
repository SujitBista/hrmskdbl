import type { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { shouldUseSecureAuthCookie } from "./should-use-secure-auth-cookie";

function makeRequest(
  url: string,
  headers?: Record<string, string>
): NextRequest {
  return {
    headers: new Headers(headers),
    nextUrl: new URL(url),
  } as NextRequest;
}

describe("shouldUseSecureAuthCookie", () => {
  it("returns false for plain HTTP requests", () => {
    expect(
      shouldUseSecureAuthCookie(
        makeRequest("http://192.168.1.229:3000/api/auth/login")
      )
    ).toBe(false);
  });

  it("returns true for HTTPS requests", () => {
    expect(
      shouldUseSecureAuthCookie(
        makeRequest("https://example.com/api/auth/login")
      )
    ).toBe(true);
  });

  it("prefers the forwarded protocol from the reverse proxy", () => {
    expect(
      shouldUseSecureAuthCookie(
        makeRequest("http://127.0.0.1:3000/api/auth/login", {
          "x-forwarded-proto": "https",
        })
      )
    ).toBe(true);
  });
});
