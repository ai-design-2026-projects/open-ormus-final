import { describe, test, expect, mock } from "bun:test";
import { createHmac } from "crypto";

process.env["JWT_SECRET"] = "test-secret";

// Helper: build a valid signed cookie value
function makePkceCookie(
  redirectUri: string,
  state: string,
  codeChallenge: string
): string {
  const secret = "test-secret";
  const payload = JSON.stringify({ redirectUri, state, codeChallenge });
  const encodedPayload = Buffer.from(payload).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${encodedPayload}.${sig}`;
}

// Mock supabase createClient
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "user-123" } } }),
    },
  }),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";

function makeRequest(cookieValue?: string): NextRequest {
  const url = new URL("http://localhost:3000/api/oauth/callback");
  const req = new NextRequest(url);
  if (cookieValue) {
    req.cookies.set("__oauth_pkce", cookieValue);
  }
  return req;
}

describe("GET /api/oauth/callback", () => {
  test("returns 400 when __oauth_pkce cookie is missing", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("missing_pkce_cookie");
  });

  test("returns 400 when cookie signature is invalid", async () => {
    const res = await GET(makeRequest("invalid.cookie.value"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_pkce_cookie");
  });

  test("redirects to redirect_uri with code and state for valid request", async () => {
    const cookie = makePkceCookie(
      "http://localhost:3001/callback",
      "my-state",
      "challenge-abc"
    );
    const res = await GET(makeRequest(cookie));
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("code=");
    expect(location).toContain("state=my-state");
    expect(location).toContain("localhost:3001/callback");
  });

  test("clears __oauth_pkce cookie in redirect response", async () => {
    const cookie = makePkceCookie(
      "http://localhost:3001/callback",
      "state-xyz",
      "challenge-def"
    );
    const res = await GET(makeRequest(cookie));
    expect(res.status).toBe(307);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("__oauth_pkce=");
    expect(setCookie).toContain("Max-Age=0");
  });
});
