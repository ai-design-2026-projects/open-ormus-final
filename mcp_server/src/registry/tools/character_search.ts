import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CharacterSearchInputShape,
  type CharacterSearchInput,
  type CharacterSearchResult,
  CharacterSearchResultSchema,
} from "@open-ormus/shared";
import { exa } from "../../exa.js";

export const SYSTEM_PROMPT = `You are a fictional character analyst. Given a search query identifying a fictional character (e.g. "Berlin, Money Heist"), populate every field in the output schema with accurate data from your sources.

Confidence scale:
- 3: complete data from multiple consistent sources
- 2: partial data or minor inconsistencies across sources
- 1: sparse data, heavy inference required
- 0: character not identifiable from the query

If confidence is 0, set all string fields to "" and all arrays/objects to empty.`;

const CHARACTER_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    imageUrl: { type: ["string", "null"] },
    shortDescription: { type: "string", description: "1–2 sentences" },
    firstAppearanceDate: {
      type: "string",
      description: 'ISO 8601 date, e.g. "2017-05-02"; "0000-01-01" if unknown',
    },
    confidence: { type: "integer", minimum: 0, maximum: 3 },
    personality: {
      type: "object",
      properties: {
        personalityTraits: { type: "array", items: { type: "string" } },
        backstory: { type: "string" },
        relationships: {
          type: "object",
          additionalProperties: { type: "string" },
        },
        speechPatterns: { type: "array", items: { type: "string" } },
        values: { type: "array", items: { type: "string" } },
        fears: { type: "array", items: { type: "string" } },
        goals: { type: "array", items: { type: "string" } },
        notableQuotes: { type: "array", items: { type: "string" } },
        abilities: { type: "array", items: { type: "string" } },
        copingStyle: { type: "array", items: { type: "string" } },
        knowledgeScope: {
          type: "object",
          additionalProperties: { type: "string" },
        },
      },
      required: [
        "personalityTraits",
        "backstory",
        "relationships",
        "speechPatterns",
        "values",
        "fears",
        "goals",
        "notableQuotes",
        "abilities",
        "copingStyle",
        "knowledgeScope",
      ],
    },
  },
  required: [
    "name",
    "imageUrl",
    "shortDescription",
    "firstAppearanceDate",
    "confidence",
    "personality",
  ],
} as const;

type CharacterSearchToolResult =
  | CharacterSearchResult
  | { error: "character_not_found" | "parse_failed" | "search_failed" };

export async function characterSearchHandler(
  args: CharacterSearchInput
): Promise<CharacterSearchToolResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (exa.answer as any)(
      (args as any).query, // eslint-disable-line @typescript-eslint/no-explicit-any
      {
        systemPrompt: SYSTEM_PROMPT,
        outputSchema: CHARACTER_OUTPUT_SCHEMA,
      }
    );

    // outputSchema → result.answer is already an object; fallback handles legacy string responses
    let parsed: unknown;
    try {
      if (typeof result.answer === "object" && result.answer !== null) {
        parsed = result.answer;
      } else {
        const raw = String(result.answer)
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, "")
          .trim();
        parsed = JSON.parse(raw);
      }
    } catch {
      return { error: "parse_failed" };
    }

    const validation = CharacterSearchResultSchema.safeParse(parsed);
    if (!validation.success) {
      return { error: "parse_failed" };
    }

    if (validation.data.confidence === 0) {
      return { error: "character_not_found" };
    }

    return validation.data;
  } catch {
    return { error: "search_failed" };
  }
}

export function register(server: McpServer): void {
  // Zod v3/v4 mismatch: CharacterSearchInputShape from shared (v4) with McpServer.tool() which expects v3
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.tool(
    "mcp__openormus__character_search",
    "Search for a fictional character and retrieve their personality traits, backstory, and relationships",
    CharacterSearchInputShape as any,
    async (args: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const result = await characterSearchHandler(args as CharacterSearchInput);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result),
          },
        ],
      };
    }
  );
}
