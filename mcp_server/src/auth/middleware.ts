import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";

// Augment Express Request to carry userId set by this middleware.
// Tools must read userId from req — never from tool arguments (AGENTS.md §6 JWT).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void;

const JwtPayloadSchema = z.object({ userId: z.string() });

export function createAuthMiddleware(): AuthMiddleware {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers["authorization"];
    const secret = process.env["JWT_SECRET"];

    // In dev mode, try JWT first; fall back to dev identity only when no token is present.
    // TODO: Remove dev bypass when frontend /api/auth/tool-token is enforced (M3-04)
    if (process.env["MCP_AUTH_DISABLED"] === "true") {
      if (authHeader?.startsWith("Bearer ") && secret) {
        try {
          const raw = jwt.verify(authHeader.slice(7), secret);
          const payload = JwtPayloadSchema.parse(raw);
          req.userId = payload.userId;
          next();
          return;
        } catch {
          // fall through to dev bypass
        }
      }
      req.userId = "00000000-0000-0000-0000-000000000000";
      next();
      return;
    }

    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "missing_token" });
      return;
    }

    const token = authHeader.slice(7);
    if (!secret) {
      res.status(500).json({ error: "jwt_secret_not_configured" });
      return;
    }

    try {
      const raw = jwt.verify(token, secret);
      const payload = JwtPayloadSchema.parse(raw);
      req.userId = payload.userId;
      next();
    } catch {
      res.status(401).json({ error: "invalid_token" });
    }
  };
}
