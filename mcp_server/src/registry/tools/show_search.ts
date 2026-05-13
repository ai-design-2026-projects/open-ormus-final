import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ShowSearchInput, ShowSearchResult } from "@open-ormus/shared";
import {
  ShowSearchInputShape,
  ShowSearchResultSchema,
} from "@open-ormus/shared";
import { exa } from "../../exa.js";

const SHOW_SYSTEM_PROMPT = `You are a fiction catalogue expert. Given a search query (e.g. "Berlin" or "Money Heist"), find up to 3 TV series, films, or books that best match. Return fewer than 3 results if fewer genuinely match. Rank by relevance to the query.`;

const SHOW_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string", description: "2–3 sentences" },
          characters: {
            type: "array",
            items: { type: "string" },
            maxItems: 8,
            description: "Main character names only",
          },
          year: { type: ["integer", "null"], description: "Release year" },
          genre: { type: ["string", "null"] },
        },
        required: ["title", "description", "characters", "year", "genre"],
      },
    },
  },
  required: ["results"],
} as const;

type ShowSearchToolResult =
  | ShowSearchResult
  | { error: "parse_failed" | "search_failed" };

export async function showSearchHandler(
  args: ShowSearchInput
): Promise<ShowSearchToolResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (exa.answer as any)(args.query, {
      systemPrompt: SHOW_SYSTEM_PROMPT,
      outputSchema: SHOW_OUTPUT_SCHEMA,
    });

    // outputSchema → result.answer is already an object; fallback handles legacy string responses
    let parsed: unknown;
    try {
      if (typeof result.answer === "object" && result.answer !== null) {
        parsed = result.answer;
      } else {
        const raw = String(result.answer ?? "{}")
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, "")
          .trim();
        parsed = JSON.parse(raw);
      }
    } catch {
      return { error: "parse_failed" };
    }

    const validated = ShowSearchResultSchema.safeParse(parsed);
    if (!validated.success) {
      return { error: "parse_failed" };
    }

    return validated.data;
  } catch {
    return { error: "search_failed" };
  }
}

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__show_search",
    "Search for TV series, films, or books by title or theme and retrieve metadata with character names",
    ShowSearchInputShape,
    // @ts-expect-error -- TS2589: type instantiation depth from Zod v3/v4 workspace mismatch. Tracked: AGENTS.md §11, resolves before M3-05.
    async (args: ShowSearchInput) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await showSearchHandler(args)),
        },
      ],
    })
  );
}
