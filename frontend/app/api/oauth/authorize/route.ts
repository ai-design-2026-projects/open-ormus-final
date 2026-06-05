import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { createClient } from "@/lib/supabase/server";

function pkceStateCookieValue(
  redirectUri: string,
  state: string,
  codeChallenge: string
): string {
  const secret = process.env["JWT_SECRET"];
  if (!secret) throw new Error("JWT_SECRET not configured");
  const payload = JSON.stringify({ redirectUri, state, codeChallenge });
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const responseType = searchParams.get("response_type");
  const clientId = searchParams.get("client_id");
  const redirectUri = searchParams.get("redirect_uri");
  const codeChallenge = searchParams.get("code_challenge");
  const codeChallengeMethod = searchParams.get("code_challenge_method");
  const state = searchParams.get("state") ?? "";

  // Validate required params
  if (responseType !== "code") {
    return NextResponse.json(
      { error: "unsupported_response_type" },
      { status: 400 }
    );
  }
  if (!clientId || !redirectUri || !codeChallenge) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "missing required params" },
      { status: 400 }
    );
  }
  if (codeChallengeMethod !== "S256") {
    return NextResponse.json(
      { error: "invalid_request", error_description: "code_challenge_method must be S256" },
      { status: 400 }
    );
  }

  // Check if user already has an active session — skip login if so
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const nextPath = user ? "/api/oauth/callback" : "/login?next=/api/oauth/callback";

  // Store PKCE state in signed cookie
  const cookieValue = pkceStateCookieValue(redirectUri, state, codeChallenge);
  const response = NextResponse.redirect(
    new URL(nextPath, req.nextUrl.origin)
  );
  response.cookies.set("__oauth_pkce", cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
    secure: process.env["NODE_ENV"] === "production",
  });
  return response;
}
