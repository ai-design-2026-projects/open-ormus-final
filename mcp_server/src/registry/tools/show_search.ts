import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOL_DESCRIPTIONS, ShowSearchInputShape, showSearchHandler } from "@open-ormus/shared";

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__show_research",
    TOOL_DESCRIPTIONS.show_research,
    ShowSearchInputShape,
    // Zod v3/v4 mismatch: ShowSearchInputShape from shared (v4) with McpServer.tool() which expects v3.
    // Tracked: AGENTS.md §11, resolves before M3-05.
    async (args: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await showSearchHandler(args)),
        },
      ],
    })
  );
}
