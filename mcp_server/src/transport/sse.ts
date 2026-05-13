import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createRegistry } from "../registry/registry.js";
import { userIdStorage } from "../auth/context.js";

// Session map: sessionId → SSE transport
// Separate map from StreamableHTTP — different transport type.
const sseSessions = new Map<string, SSEServerTransport>();

export function createSseRouter(): Router {
  const router = createRouter();

  // Client opens SSE stream here. Server responds with `event: endpoint` pointing
  // to POST /mcp/messages?sessionId=<id>. Client then posts messages there.
  router.get("/sse", async (_req: Request, res: Response): Promise<void> => {
    const mcpServer = createRegistry();
    const transport = new SSEServerTransport("/mcp/messages", res);
    sseSessions.set(transport.sessionId, transport);

    transport.onclose = () => {
      sseSessions.delete(transport.sessionId);
    };

    await mcpServer.connect(transport);
    await transport.start();
  });

  // Client posts messages to this endpoint after receiving the session ID from /sse.
  // Each POST is a tool call — userId is threaded here per-request from the validated JWT.
  router.post("/messages", async (req: Request, res: Response): Promise<void> => {
    const rawSessionId = req.query["sessionId"];
    const sessionId = typeof rawSessionId === "string" ? rawSessionId : undefined;
    if (!sessionId) {
      res.status(400).json({ error: "missing_sessionId" });
      return;
    }

    const transport = sseSessions.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }

    await userIdStorage.run(req.userId, () =>
      transport.handlePostMessage(req, res, req.body)
    );
  });

  return router;
}
