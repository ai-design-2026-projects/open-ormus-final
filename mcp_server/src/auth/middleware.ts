import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

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

export function createAuthMiddleware(): AuthMiddleware {
  return (req: Request, res: Response, next: NextFunction): void => {
    // TODO: Remove dev bypass and enforce JWT when frontend /api/auth/tool-token lands (M3-04)
    if (process.env["MCP_AUTH_DISABLED"] === "true") {
      req.userId = "dev-user";
      next();
      return;
    }

    const authHeader = req.headers["authorization"];
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "missing_token" });
      return;
    }

    const token = authHeader.slice(7);
    const secret = process.env["JWT_SECRET"];
    if (!secret) {
      res.status(500).json({ error: "jwt_secret_not_configured" });
      return;
    }

    try {
      const payload = jwt.verify(token, secret) as { userId: string };
      req.userId = payload["userId"];
      next();
    } catch {
      res.status(401).json({ error: "invalid_token" });
    }
  };
}
