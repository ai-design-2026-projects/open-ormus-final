import { randomUUID } from "node:crypto";
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createRegistry } from "../registry/registry.js";

// Session map: mcp-session-id header → transport instance
const sessions = new Map<string, StreamableHTTPServerTransport>();

export function createStreamableHttpRouter(): Router {
  const router = createRouter();

  router.post("/", async (req: Request, res: Response): Promise<void> => {
    const rawSessionId = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;

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

    // A new McpServer instance per session — McpServer.connect() cannot be called more than once
    // on the same instance (it throws "Already connected to a transport").
    const mcpServer = createRegistry();

    // Cast required: tsc reports TS2379 — Argument of type 'StreamableHTTPServerTransport' is not
    // assignable to parameter of type 'Transport' with 'exactOptionalPropertyTypes: true'.
    // The conflict is on 'onclose': the class getter returns `(() => void) | undefined` but the
    // Transport interface declares `onclose?: () => void` (no undefined in the value type under
    // exactOptionalPropertyTypes). The class structurally implements Transport at runtime.
    await mcpServer.connect(transport as Transport);
    await transport.handleRequest(req, res, req.body);
  });

  return router;
}
