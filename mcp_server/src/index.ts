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

// Single McpServer instance — both transports share it.
const mcpServer = createRegistry();

// StreamableHTTP transport: POST /mcp
app.use("/mcp", createStreamableHttpRouter(mcpServer));

// SSE transport: GET /mcp/sse, POST /mcp/messages
app.use("/mcp", createSseRouter(mcpServer));

// Health check (unauthenticated)
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`MCP server running on http://localhost:${PORT}`);
  console.log(`Auth: ${process.env["MCP_AUTH_DISABLED"] === "true" ? "DISABLED (dev mode)" : "enabled"}`);
});
