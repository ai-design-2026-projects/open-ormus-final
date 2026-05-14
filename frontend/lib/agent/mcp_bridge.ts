import type { Tool } from "@anthropic-ai/sdk/resources/messages";

const MCP_URL = process.env["MCP_SERVER_URL"] ?? "http://localhost:3001/mcp";

export type McpSession = { sessionId: string; jwt: string };

/**
 * Opens a StreamableHTTP session with the MCP server.
 * Must be called once per agent request before any tool calls.
 */
export async function initMcpSession(jwt: string): Promise<McpSession> {
  const response = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "openormus-agent", version: "1.0.0" },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`MCP init failed ${response.status}: ${body}`);
  }

  const sessionId = response.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("MCP server did not return mcp-session-id header");

  // Send initialized notification to complete handshake
  await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${jwt}`,
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });

  return { sessionId, jwt };
}

/**
 * Calls a named MCP tool and returns the parsed JSON result.
 * MCP tools always return { content: [{ type: "text", text: "..." }] }.
 */
export async function callMcpTool(
  session: McpSession,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${session.jwt}`,
      "mcp-session-id": session.sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  });

  type McpResponse = {
    result?: { content?: Array<{ type: string; text?: string }> };
    error?: { message: string };
  };

  let data: McpResponse;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    // Read SSE body, extract first data: line that contains a JSON-RPC response
    const raw = await response.text();
    const dataLine = raw
      .split("\n")
      .find((l) => l.startsWith("data:"));
    if (!dataLine) throw new Error(`No data line in SSE response from ${toolName}`);
    data = JSON.parse(dataLine.slice("data:".length).trim()) as McpResponse;
  } else {
    data = (await response.json()) as McpResponse;
  }

  if (data.error) throw new Error(data.error.message);

  const content = data.result as { content?: Array<{ type: string; text?: string }>; isError?: boolean } | undefined;
  const text = content?.content?.[0]?.text;
  if (text === undefined) throw new Error(`Empty response from MCP tool ${toolName}`);
  if (content?.isError) throw new Error(text);
  return JSON.parse(text) as unknown;
}

/** Tool definitions for the six MCP tools, in Anthropic Tool format. */
export function buildMcpTools(): Tool[] {
  return [
    {
      name: "mcp__openormus__character_list",
      description: "List all characters saved in your collection.",
      input_schema: { type: "object" as const, properties: {}, required: [] },
    },
    {
      name: "mcp__openormus__character_save",
      description: "Save a character to your collection. Pass the flat CharacterSaveInput fields (NOT a nested sheet).",
      input_schema: {
        type: "object" as const,
        properties: {
          name: { type: "string" },
          imageUrl: { type: "string", description: "Portrait URL or null" },
          shortDescription: { type: "string" },
          firstAppearanceDate: { type: "string", description: "ISO date string" },
          confidence: { type: "number", description: "Research confidence 0–3" },
          personality: {
            type: "object",
            description: "CharacterPersonality object",
            properties: {
              personalityTraits: { type: "array", items: { type: "string" } },
              backstory: { type: "string" },
              relationships: { type: "object", additionalProperties: { type: "string" } },
              speechPatterns: { type: "array", items: { type: "string" } },
              values: { type: "array", items: { type: "string" } },
              fears: { type: "array", items: { type: "string" } },
              goals: { type: "array", items: { type: "string" } },
              notableQuotes: { type: "array", items: { type: "string" } },
              abilities: { type: "array", items: { type: "string" } },
              copingStyle: { type: "array", items: { type: "string" } },
              knowledgeScope: { type: "object", additionalProperties: { type: "string" } },
            },
            required: [
              "personalityTraits", "backstory", "relationships", "speechPatterns",
              "values", "fears", "goals", "notableQuotes", "abilities", "copingStyle", "knowledgeScope",
            ],
          },
        },
        required: ["name", "imageUrl", "shortDescription", "firstAppearanceDate", "confidence", "personality"],
      },
    },
    {
      name: "mcp__openormus__character_update",
      description: "Update an existing character's sheet by ID.",
      input_schema: {
        type: "object" as const,
        properties: {
          id: { type: "string", description: "UUID of the character to update" },
          sheet: { type: "object", description: "New CharacterSearchResult object" },
        },
        required: ["id", "sheet"],
      },
    },
    {
      name: "mcp__openormus__character_delete",
      description: "Delete a character from your collection by ID.",
      input_schema: {
        type: "object" as const,
        properties: { id: { type: "string", description: "UUID of the character to delete" } },
        required: ["id"],
      },
    },
    {
      name: "mcp__openormus__character_db_search",
      description: "Search your saved characters by name or description using fuzzy similarity.",
      input_schema: {
        type: "object" as const,
        properties: {
          query: { type: "string" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: ["query"],
      },
    },
    {
      name: "mcp__openormus__scene_simulate",
      description: "Simulate a scene between fictional characters. Returns dialogue.",
      input_schema: {
        type: "object" as const,
        properties: {
          characterIds: { type: "array", items: { type: "string" }, description: "Array of character UUIDs" },
          setting: { type: "string", description: "Scene location and context" },
          prompt: { type: "string", description: "What the scene is about" },
        },
        required: ["characterIds", "setting", "prompt"],
      },
    },
  ];
}
