import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CharacterSearchInputShape, characterSearchHandler } from "@open-ormus/shared";

export function register(server: McpServer): void {
  // Zod v3/v4 mismatch: CharacterSearchInputShape from shared (v4) with McpServer.tool() which expects v3.
  // Tracked: AGENTS.md §11, resolves before M3-05.
  server.tool(
    "mcp__openormus__character_search",
    "Search for a fictional character and retrieve their personality traits, backstory, and relationships",
    CharacterSearchInputShape as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    async (args: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await characterSearchHandler(args)),
        },
      ],
    })
  );
}
