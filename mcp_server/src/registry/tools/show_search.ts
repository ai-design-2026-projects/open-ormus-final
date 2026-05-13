import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ShowSearchInputShape, showSearchHandler } from "@open-ormus/shared";

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__show_search",
    "Search for TV series, films, or books by title or theme and retrieve metadata with character names",
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
