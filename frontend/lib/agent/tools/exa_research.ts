import { z } from "zod";
import type { AnthropicTool } from "../types";
import {
  characterBasicsHandler,
  characterDetailsHandler,
  showSearchHandler,
} from "@open-ormus/shared";
import type {
  CharacterBasics,
  CharacterSaveInput,
  ShowResult,
} from "@open-ormus/shared";

// ─── Show research (unchanged) ────────────────────────────────────────────────

export const researchShowTool: AnthropicTool = {
  name: "research_show_online",
  description:
    "Look up a TV series, film, or book by title using Exa. " +
    "Returns the show's title, description, year, genre, and the list of main character names. " +
    "Call this FIRST when the user asks to import characters from a collection. " +
    "Then call research_character_basics for each character name in the returned list.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "Show/film/book title (e.g. 'iCarly', 'Breaking Bad', 'Harry Potter').",
      },
    },
    required: ["query"],
  },
};

export async function handleShowResearch(args: {
  query: string;
}): Promise<ShowResult | { error: string }> {
  const result = await showSearchHandler({ query: args.query });
  if ("error" in result) return { error: result.error };
  if (result.results.length === 0) return { error: "show_not_found" };
  const first = result.results[0];
  if (!first) return { error: "show_not_found" };
  return first;
}

// ─── Character basics (step 1 of 2) ──────────────────────────────────────────

export const researchCharacterBasicsTool: AnthropicTool = {
  name: "research_character_basics",
  description:
    "Research the basic identity of a fictional character using Exa. " +
    "Returns name, shortDescription, firstAppearanceDate, and imageUrl. " +
    "Call this FIRST when researching any character. " +
    "If the result has an error, the character was not found — stop and inform the user. " +
    "Otherwise call research_character_details with ALL fields from this result plus the original query.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description:
          "Character name with show context (e.g. 'Walter White, Breaking Bad') or just the name.",
      },
    },
    required: ["query"],
  },
};

export async function handleCharacterBasicsResearch(args: {
  query: string;
}): Promise<CharacterBasics | { error: string }> {
  const result = await characterBasicsHandler({ query: args.query });
  if ("error" in result) return { error: result.error };
  return result;
}

// ─── Character details (step 2 of 2) ─────────────────────────────────────────

// Extended input: all basics fields + original query.
// Handler returns the full character_save-compatible object — pass it directly.
export const CharacterDetailsResearchInputSchema = z.object({
  query: z.string().min(1),
  name: z.string().min(1),
  imageUrl: z.string().nullable(),
  shortDescription: z.string(),
  firstAppearanceDate: z.string().nullable(),
});
export type CharacterDetailsResearchInput = z.infer<typeof CharacterDetailsResearchInputSchema>;

export const researchCharacterDetailsTool: AnthropicTool = {
  name: "research_character_details",
  description:
    "Research the full personality, backstory, and connections of a confirmed fictional character. " +
    "Must be called AFTER research_character_basics — pass ALL fields from that result plus the original query. " +
    "Returns a complete character profile ready to pass directly to mcp__openormus__character_save.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "Original search query used in research_character_basics.",
      },
      name: {
        type: "string",
        description: "Character name from research_character_basics.",
      },
      imageUrl: {
        type: ["string", "null"] as unknown as "string",
        description: "imageUrl from research_character_basics.",
      },
      shortDescription: {
        type: "string",
        description: "shortDescription from research_character_basics.",
      },
      firstAppearanceDate: {
        type: ["string", "null"] as unknown as "string",
        description: "firstAppearanceDate from research_character_basics.",
      },
    },
    required: ["query", "name", "imageUrl", "shortDescription", "firstAppearanceDate"],
  },
};

export async function handleCharacterDetailsResearch(
  args: CharacterDetailsResearchInput
): Promise<CharacterSaveInput | { error: string }> {
  const result = await characterDetailsHandler({
    query: args.query,
    name: args.name,
    shortDescription: args.shortDescription,
  });
  if ("error" in result) return { error: result.error };
  return {
    name: args.name,
    imageUrl: args.imageUrl,
    shortDescription: args.shortDescription,
    firstAppearanceDate: args.firstAppearanceDate,
    personality: result,
  };
}
