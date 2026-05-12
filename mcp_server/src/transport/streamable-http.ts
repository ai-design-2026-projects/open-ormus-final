import { randomUUID } from "node:crypto";
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

// Session map: mcp-session-id header → transport instance
const sessions = new Map<string, StreamableHTTPServerTransport>();

export function createStreamableHttpRouter(mcpServer: McpServer): Router {
  const router = createRouter();

  router.post("/", async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId) {
      const transport = sessions.get(sessionId);
      if (!transport) {
        res.status(404).json({ error: "session_not_found" });
        return;
      }
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // No session ID — must be an initialize request to start a new session
    if (!isInitializeRequest(req.body)) {
      res.status(400).json({ error: "missing_session_id" });
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, transport);
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };

    // Cast needed: StreamableHTTPServerTransport getter returns `(() => void) | undefined`
    // but Transport interface declares `onclose?: () => void`; these are incompatible under
    // exactOptionalPropertyTypes despite the class implementing Transport.
    await mcpServer.connect(transport as Transport);
    await transport.handleRequest(req, res, req.body);
  });

  return router;
}
