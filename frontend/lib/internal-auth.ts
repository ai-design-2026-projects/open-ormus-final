import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

const PayloadSchema = z.object({
  userId: z.string(),
  exp: z.number(),
  internal: z.literal(true),
});

export function validateInternalToken(authHeader: string | null): string {
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("missing_token");
  }

  const token = authHeader.slice(7);
  const secret = process.env["JWT_SECRET"];
  if (!secret) throw new Error("jwt_secret_not_configured");

  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("invalid_token");

  const [header, payload, sig] = parts as [string, string, string];

  const expectedSig = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) throw new Error("invalid_token");

  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    throw new Error("invalid_token");
  }

  const parsed = PayloadSchema.safeParse(data);
  if (!parsed.success) throw new Error("invalid_token");

  if (parsed.data.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("token_expired");
  }

  return parsed.data.userId;
}
