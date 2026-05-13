import type { ShowSearchInput, ShowSearchResult } from "../schema/show_search";
import { ShowSearchResultSchema } from "../schema/show_search";
import { getExa } from "./exa";

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

type ExaClient = {
  answer(query: string, options?: Record<string, unknown>): Promise<{ answer: unknown }>;
};

export async function showSearchHandler(
  args: ShowSearchInput,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exaClient: ExaClient = getExa() as unknown as ExaClient
): Promise<ShowSearchResult | { error: "parse_failed" | "search_failed" }> {
  try {
    const result = await exaClient.answer(args.query, {
      systemPrompt: SHOW_SYSTEM_PROMPT,
      outputSchema: SHOW_OUTPUT_SCHEMA,
    });

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
