import express from "express";
import { createAuthMiddleware } from "./auth/middleware.js";
import { createRegistry } from "./registry/registry.js";
import { createStreamableHttpRouter } from "./transport/streamable-http.js";
import { createSseRouter } from "./transport/sse.js";

const app = express();
const PORT = process.env["PORT"] ?? 3001;

app.use(express.json());

// Auth middleware applied before all MCP routes.
// Set MCP_AUTH_DISABLED=true in .env.local for local dev.
app.use("/mcp", createAuthMiddleware());

// StreamableHTTP transport: POST /mcp
// Each session gets its own McpServer instance (see transport/streamable-http.ts).
app.use("/mcp", createStreamableHttpRouter());

// SSE transport: GET /mcp/sse, POST /mcp/messages
// SSE uses a shared McpServer instance (one connection per SSE session).
const mcpServer = createRegistry();
app.use("/mcp", createSseRouter(mcpServer));

// Health check (unauthenticated)
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`MCP server running on http://localhost:${PORT}`);
  console.log(`Auth: ${process.env["MCP_AUTH_DISABLED"] === "true" ? "DISABLED (dev mode)" : "enabled"}`);
});
