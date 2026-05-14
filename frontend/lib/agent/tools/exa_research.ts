import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import {
  characterSearchHandler,
  showSearchHandler,
} from "@open-ormus/shared";
import type { CharacterSearchResult, ShowResult } from "@open-ormus/shared";

export const researchShowTool: Tool = {
  name: "research_show_online",
  description:
    "Look up a TV series, film, or book by title using Exa. " +
    "Returns the show's title, description, year, genre, and the list of main character names. " +
    "Call this FIRST when the user asks to import characters from a collection. " +
    "Then call research_character_online for each character name in the returned list.",
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

export const exaResearchTool: Tool = {
  name: "research_character_online",
  description:
    "Research a single fictional character online using Exa. " +
    "Returns a CharacterSearchResult with personality, backstory, and traits. " +
    "For best results, include the show/film context in the query (e.g. 'Sam Puckett, iCarly'). " +
    "After this tool returns, call mcp__openormus__character_save to persist the character.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description:
          "Character name with show context (e.g. 'Carly Shay, iCarly') or just the character name (e.g. 'Walter White').",
      },
    },
    required: ["query"],
  },
};

export async function handleExaResearch(args: {
  query: string;
}): Promise<CharacterSearchResult[] | { error: string }> {
  const result = await characterSearchHandler({ query: args.query });
  if ("error" in result) return { error: result.error };
  return [result];
}
