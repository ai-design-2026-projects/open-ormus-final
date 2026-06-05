import { NextRequest, NextResponse } from "next/server";

// RFC 7591 Dynamic Client Registration — stateless.
// We don't need client secrets since PKCE handles security.
// Any client that registers gets a client_id derived from its redirect_uris.
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const redirectUris = body["redirect_uris"];
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return NextResponse.json(
      { error: "invalid_redirect_uri", error_description: "redirect_uris required" },
      { status: 400 }
    );
  }

  // Stateless client_id — stable for the same redirect URIs
  const clientId = Buffer.from(JSON.stringify(redirectUris)).toString("base64url").slice(0, 32);

  return NextResponse.json(
    {
      client_id: clientId,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    { status: 201 }
  );
}
