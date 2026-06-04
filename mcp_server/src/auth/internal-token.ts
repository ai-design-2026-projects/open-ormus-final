import jwt from "jsonwebtoken";

export function mintInternalToken(userId: string): string {
  const secret = process.env["JWT_SECRET"];
  if (!secret) throw new Error("JWT_SECRET not configured");
  return jwt.sign({ userId, internal: true }, secret, { expiresIn: 60 });
}
