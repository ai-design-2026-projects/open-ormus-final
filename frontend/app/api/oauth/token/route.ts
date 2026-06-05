import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { verifyAuthCode, verifyPkce } from "@/lib/oauth";

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function mintBearerToken(userId: string): string {
  const secret = process.env["JWT_SECRET"];
  if (!secret) throw new Error("JWT_SECRET not configured");
  const now = Math.floor(Date.now() / 1000);
  const ttl = parseInt(process.env["MCP_TOKEN_TTL_SECONDS"] ?? "86400", 10) || 86400;
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ userId, iat: now, exp: now + ttl }));
  const sig = b64url(
    createHmac("sha256", secret).update(`${header}.${payload}`).digest()
  );
  return `${header}.${payload}.${sig}`;
}

export async function POST(req: NextRequest) {
  let body: URLSearchParams;
  try {
    const text = await req.text();
    body = new URLSearchParams(text);
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const grantType = body.get("grant_type");
  const code = body.get("code");
  const codeVerifier = body.get("code_verifier");

  if (grantType !== "authorization_code") {
    return NextResponse.json(
      { error: "unsupported_grant_type" },
      { status: 400 }
    );
  }
  if (!code || !codeVerifier) {
    return NextResponse.json(
      {
        error: "invalid_request",
        error_description: "missing code or code_verifier",
      },
      { status: 400 }
    );
  }

  // Verify auth code
  let authCodeData: { userId: string; codeChallenge: string };
  try {
    authCodeData = verifyAuthCode(code);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "invalid_grant";
    return NextResponse.json(
      { error: "invalid_grant", error_description: msg },
      { status: 400 }
    );
  }

  // Verify PKCE
  if (!verifyPkce(codeVerifier, authCodeData.codeChallenge)) {
    return NextResponse.json(
      { error: "invalid_grant", error_description: "code_verifier mismatch" },
      { status: 400 }
    );
  }

  // Issue bearer token
  let accessToken: string;
  try {
    accessToken = mintBearerToken(authCodeData.userId);
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  const ttl = parseInt(process.env["MCP_TOKEN_TTL_SECONDS"] ?? "86400", 10) || 86400;
  return NextResponse.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ttl,
  });
}
