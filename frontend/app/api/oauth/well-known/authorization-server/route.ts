export async function GET() {
  const siteUrl = process.env["NEXT_PUBLIC_SITE_URL"] ?? "http://localhost:3000";
  return Response.json({
    issuer: siteUrl,
    authorization_endpoint: `${siteUrl}/api/oauth/authorize`,
    token_endpoint: `${siteUrl}/api/oauth/token`,
    registration_endpoint: `${siteUrl}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  });
}
