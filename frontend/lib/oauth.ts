import { createHash, createHmac } from "crypto";

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const computed = b64url(createHash("sha256").update(codeVerifier).digest());
  return computed === codeChallenge;
}

export function mintAuthCode(userId: string, codeChallenge: string): string {
  const secret = process.env["JWT_SECRET"];
  if (!secret) throw new Error("JWT_SECRET not configured");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ userId, type: "oauth_code", codeChallenge, iat: now, exp: now + 120 })
  );
  const sig = b64url(
    createHmac("sha256", secret).update(`${header}.${payload}`).digest()
  );
  return `${header}.${payload}.${sig}`;
}

export function verifyAuthCode(code: string): { userId: string; codeChallenge: string } {
  const secret = process.env["JWT_SECRET"];
  if (!secret) throw new Error("JWT_SECRET not configured");
  const parts = code.split(".");
  if (parts.length !== 3) throw new Error("invalid_code");
  const [header, payload, sig] = parts as [string, string, string];
  const expectedSig = b64url(
    createHmac("sha256", secret).update(`${header}.${payload}`).digest()
  );
  if (sig !== expectedSig) throw new Error("invalid_code");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<string, unknown>;
  if (data["type"] !== "oauth_code") throw new Error("invalid_code");
  const now = Math.floor(Date.now() / 1000);
  if (typeof data["exp"] === "number" && data["exp"] < now) throw new Error("code_expired");
  return {
    userId: data["userId"] as string,
    codeChallenge: data["codeChallenge"] as string,
  };
}
