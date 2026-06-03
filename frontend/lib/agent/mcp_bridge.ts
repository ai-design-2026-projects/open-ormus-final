import { MCPServerStreamableHttp } from "@openai/agents";

const MCP_URL = process.env["MCP_SERVER_URL"] ?? "http://localhost:3001/mcp";

export type AgentMcpServer = MCPServerStreamableHttp;

/**
 * Builds a native MCP client for the OpenORMUS tool server. The JWT carries the
 * only trusted tenancy source; the MCP server derives userId from it. Tools are
 * auto-discovered — no hand-written schemas. Caller must connect() before use
 * and close() in a finally block.
 */
export function createMcpServer(jwt: string): AgentMcpServer {
  return new MCPServerStreamableHttp({
    url: MCP_URL,
    name: "openormus",
    requestInit: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}
