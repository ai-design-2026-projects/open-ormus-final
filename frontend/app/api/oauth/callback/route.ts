import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { mintAuthCode } from "@/lib/oauth";

function parsePkceStateCookie(cookieValue: string): {
  redirectUri: string;
  state: string;
  codeChallenge: string;
} {
  const secret = process.env["JWT_SECRET"];
  if (!secret) throw new Error("JWT_SECRET not configured");

  const lastDot = cookieValue.lastIndexOf(".");
  if (lastDot === -1) throw new Error("invalid_cookie");

  const encodedPayload = cookieValue.slice(0, lastDot);
  const sig = cookieValue.slice(lastDot + 1);

  const payload = Buffer.from(encodedPayload, "base64url").toString("utf8");
  const expectedSig = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");

  // Constant-time comparison
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (
    sigBuf.length !== expectedBuf.length ||
    !timingSafeEqual(sigBuf, expectedBuf)
  ) {
    throw new Error("invalid_cookie");
  }

  return JSON.parse(payload) as {
    redirectUri: string;
    state: string;
    codeChallenge: string;
  };
}

export async function GET(req: NextRequest) {
  // Read PKCE cookie
  const cookieValue = req.cookies.get("__oauth_pkce")?.value;
  if (!cookieValue) {
    return NextResponse.json({ error: "missing_pkce_cookie" }, { status: 400 });
  }

  let pkceState: { redirectUri: string; state: string; codeChallenge: string };
  try {
    pkceState = parsePkceStateCookie(cookieValue);
  } catch {
    return NextResponse.json({ error: "invalid_pkce_cookie" }, { status: 400 });
  }

  // Get authenticated user
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Not logged in — redirect back to login
    return NextResponse.redirect(
      new URL("/login?next=/api/oauth/callback", req.nextUrl.origin)
    );
  }

  // Mint auth code
  let code: string;
  try {
    code = mintAuthCode(user.id, pkceState.codeChallenge);
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  // Redirect to client with code
  const redirectUrl = new URL(pkceState.redirectUri);
  redirectUrl.searchParams.set("code", code);
  if (pkceState.state) {
    redirectUrl.searchParams.set("state", pkceState.state);
  }

  const response = NextResponse.redirect(redirectUrl);
  // Clear the PKCE cookie
  response.cookies.set("__oauth_pkce", "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
  });
  return response;
}
