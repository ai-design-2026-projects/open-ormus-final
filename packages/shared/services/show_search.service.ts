import { z } from "zod";
import type { ShowSearchInput, ShowSearchResult } from "../schema/show_search";
import { ShowSearchResultSchema } from "../schema/show_search";
import { getExa } from "./exa";

type ExaClient = {
  answer(query: string, options?: Record<string, unknown>): Promise<{ answer: unknown }>;
};

// ─── Exa output schemas ───────────────────────────────────────────────────────

const SHOW_METADATA_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string", description: "2-3 sentences" },
          year: { type: ["integer", "null"], description: "Release year" },
          genre: { type: ["string", "null"] },
        },
        required: ["title", "description", "year", "genre"],
      },
    },
  },
  required: ["results"],
} as const;

const SHOW_CHARACTERS_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    characters: {
      type: "array",
      items: { type: "string" },
      description: "Names of main fictional characters only — never actor or cast names",
    },
  },
  required: ["characters"],
} as const;

// ─── System prompts ───────────────────────────────────────────────────────────

const SHOW_METADATA_SYSTEM_PROMPT =
  "You are a fiction catalogue expert. Given a search query, find up to 3 TV series, films, or books that best match. " +
  "Return fewer than 3 results if fewer genuinely match. " +
  "Return each unique title only once — use the most internationally recognised title. " +
  "Rank by relevance to the query.";

const SHOW_CHARACTERS_SYSTEM_PROMPT =
  "You are a fiction character expert. Given a TV series, film, or book title, list its main fictional characters. " +
  "The characters array must contain only the names of fictional characters in the story. " +
  "Never include actor names, cast members, or real-world people.";

// ─── Internal Zod validators ──────────────────────────────────────────────────

const ShowMetadataItemSchema = z.object({
  title: z.string(),
  description: z.string(),
  year: z.number().int().nullable(),
  genre: z.string().nullable(),
});

const ShowMetadataResultSchema = z.object({
  results: z.array(ShowMetadataItemSchema).max(3),
});

const ShowCharactersSchema = z.object({
  characters: z.array(z.string()),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAnswer(raw: unknown): unknown {
  if (typeof raw === "object" && raw !== null) return raw;
  const str = String(raw ?? "{}")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(str);
  } catch (err) {
    console.error("[parseAnswer] JSON.parse failed:", err, "raw:", str.slice(0, 200));
    throw err;
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function showSearchHandler(
  args: ShowSearchInput,
  exaClient: ExaClient = getExa() as unknown as ExaClient
): Promise<ShowSearchResult | { error: "parse_failed" | "search_failed" }> {
  try {
    // Call 1: show metadata
    const metaResult = await exaClient.answer(args.query, {
      systemPrompt: SHOW_METADATA_SYSTEM_PROMPT,
      outputSchema: SHOW_METADATA_OUTPUT_SCHEMA,
    });

    let parsedMeta: unknown;
    try {
      parsedMeta = parseAnswer(metaResult.answer);
    } catch {
      return { error: "parse_failed" };
    }

    const metaValidation = ShowMetadataResultSchema.safeParse(parsedMeta);
    if (!metaValidation.success) return { error: "parse_failed" };

    // Deduplicate by normalised title
    const seen = new Set<string>();
    const uniqueShows = metaValidation.data.results.filter((show) => {
      const key = normalizeTitle(show.title);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (uniqueShows.length === 0) return { error: "parse_failed" };

    // Call 2: characters per show — fail completely if any call fails
    const showsWithCharacters = await Promise.all(
      uniqueShows.map(async (show) => {
        const charResult = await exaClient.answer(show.title, {
          systemPrompt: SHOW_CHARACTERS_SYSTEM_PROMPT,
          outputSchema: SHOW_CHARACTERS_OUTPUT_SCHEMA,
        });

        let parsedChars: unknown;
        try {
          parsedChars = parseAnswer(charResult.answer);
        } catch {
          throw new Error(`parse_failed for characters of ${show.title}`);
        }

        const charValidation = ShowCharactersSchema.safeParse(parsedChars);
        if (!charValidation.success) {
          throw new Error(`invalid_characters for ${show.title}`);
        }

        return { ...show, characters: charValidation.data.characters };
      })
    );

    const validated = ShowSearchResultSchema.safeParse({ results: showsWithCharacters });
    if (!validated.success) return { error: "parse_failed" };
    return validated.data;
  } catch {
    return { error: "search_failed" };
  }
}
