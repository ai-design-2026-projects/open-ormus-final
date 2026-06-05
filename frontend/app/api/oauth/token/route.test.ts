import { describe, test, expect } from "bun:test";
import { createHmac, createHash } from "crypto";
import { NextRequest } from "next/server";
import { POST } from "./route";

process.env["JWT_SECRET"] = "test-secret";

// Helper: b64url encode
function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

// Helper: create a valid auth code (matches lib/oauth.ts mintAuthCode logic)
function mintAuthCode(userId: string, codeChallenge: string): string {
  const secret = "test-secret";
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      userId,
      type: "oauth_code",
      codeChallenge,
      iat: now,
      exp: now + 120,
    })
  );
  const sig = b64url(
    createHmac("sha256", secret).update(`${header}.${payload}`).digest()
  );
  return `${header}.${payload}.${sig}`;
}

// Helper: derive code_challenge from code_verifier (S256)
function s256(verifier: string): string {
  return b64url(createHash("sha256").update(verifier).digest());
}

function makeRequest(params: Record<string, string>): NextRequest {
  const body = new URLSearchParams(params).toString();
  return new NextRequest("http://localhost:3000/api/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

describe("POST /api/oauth/token", () => {
  const codeVerifier = "my-code-verifier-string";
  const codeChallenge = s256(codeVerifier);

  test("returns access_token for valid code + verifier", async () => {
    const code = mintAuthCode("user-abc", codeChallenge);
    const res = await POST(
      makeRequest({
        grant_type: "authorization_code",
        code,
        code_verifier: codeVerifier,
        redirect_uri: "http://localhost:3001/callback",
        client_id: "claude-code",
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
    };
    expect(body.token_type).toBe("Bearer");
    expect(typeof body.access_token).toBe("string");
    expect(body.access_token.split(".")).toHaveLength(3);
    expect(body.expires_in).toBe(86400);
  });

  test("returns 400 for wrong grant_type", async () => {
    const res = await POST(makeRequest({ grant_type: "client_credentials" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unsupported_grant_type");
  });

  test("returns 400 when code missing", async () => {
    const res = await POST(
      makeRequest({
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
  });

  test("returns 400 for invalid code", async () => {
    const res = await POST(
      makeRequest({
        grant_type: "authorization_code",
        code: "bad.code.here",
        code_verifier: codeVerifier,
      })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_grant");
  });

  test("returns 400 for wrong code_verifier (PKCE mismatch)", async () => {
    const code = mintAuthCode("user-abc", codeChallenge);
    const res = await POST(
      makeRequest({
        grant_type: "authorization_code",
        code,
        code_verifier: "wrong-verifier",
      })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_grant");
  });
});
