import { z } from "zod";
import {
  type CharacterSearchInput,
  type CharacterSearchResult,
  CharacterSearchResultSchema,
  type CharacterBasics,
  CharacterBasicsSchema,
  type CharacterPersonality,
  type CharacterDetailsInput,
} from "../schema/character_search";
import { getExa } from "./exa";

type ExaClient = {
  answer(query: string, options?: Record<string, unknown>): Promise<{ answer: unknown }>;
};

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
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

// ─── Internal Exa output schemas (≤10 fields each) ────────────────────────────

const BASICS_OUTPUT_SCHEMA = {
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
  },
  required: ["name", "imageUrl", "shortDescription", "firstAppearanceDate", "confidence"],
} as const;

const PERSONALITY_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    personalityTraits: { type: "array", items: { type: "string" } },
    backstory: { type: "string" },
    speechPatterns: { type: "array", items: { type: "string" } },
    values: { type: "array", items: { type: "string" } },
    fears: { type: "array", items: { type: "string" } },
    goals: { type: "array", items: { type: "string" } },
    notableQuotes: { type: "array", items: { type: "string" } },
    abilities: { type: "array", items: { type: "string" } },
    copingStyle: { type: "array", items: { type: "string" } },
  },
  required: [
    "personalityTraits", "backstory", "speechPatterns", "values",
    "fears", "goals", "notableQuotes", "abilities", "copingStyle",
  ],
} as const;

const CONNECTIONS_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    relationships: {
      type: "array",
      items: {
        type: "object",
        properties: {
          characterName: { type: "string", description: "Name of the related character" },
          description: { type: "string", description: "Nature of the relationship" },
        },
        required: ["characterName", "description"],
      },
    },
    knowledgeScope: {
      type: "array",
      items: {
        type: "object",
        properties: {
          domain: { type: "string", description: "Knowledge domain or topic" },
          description: { type: "string", description: "Level or nature of expertise" },
        },
        required: ["domain", "description"],
      },
    },
  },
  required: ["relationships", "knowledgeScope"],
} as const;

// ─── Internal Zod validators for sub-results ──────────────────────────────────

const PersonalityPartSchema = z.object({
  personalityTraits: z.array(z.string()),
  backstory: z.string(),
  speechPatterns: z.array(z.string()),
  values: z.array(z.string()),
  fears: z.array(z.string()),
  goals: z.array(z.string()),
  notableQuotes: z.array(z.string()),
  abilities: z.array(z.string()),
  copingStyle: z.array(z.string()),
});

const ConnectionsPartSchema = z.object({
  relationships: z.array(z.object({ characterName: z.string(), description: z.string() })),
  knowledgeScope: z.array(z.object({ domain: z.string(), description: z.string() })),
});

// ─── System prompts ────────────────────────────────────────────────────────────

const BASICS_SYSTEM_PROMPT = `You are a fictional character analyst. Given a search query identifying a fictional character (e.g. "Berlin, Money Heist"), populate the basic identity fields.

Confidence scale:
- 3: complete data from multiple consistent sources
- 2: partial data or minor inconsistencies across sources
- 1: sparse data, heavy inference required
- 0: character not identifiable from the query

If confidence is 0, set all string fields to "" and imageUrl to null.`;

const PERSONALITY_SYSTEM_PROMPT = `You are a fictional character analyst. Populate the personality fields for the identified character. Draw from canonical sources. Be specific and detailed.`;

const CONNECTIONS_SYSTEM_PROMPT = `You are a fictional character analyst. Populate the relationships and knowledge scope for the identified character.

For relationships: list each significant relationship as an entry with the related character's name and a brief description of the relationship.
For knowledgeScope: list each domain of knowledge as an entry with the domain name and a description of this character's level or type of expertise.`;

// ─── Exported handlers ─────────────────────────────────────────────────────────

export async function characterBasicsHandler(
  args: CharacterSearchInput,
  exaClient: ExaClient = getExa() as unknown as ExaClient
): Promise<CharacterBasics | { error: "character_not_found" | "parse_failed" | "search_failed" }> {
  try {
    const result = await withRetry(() =>
      exaClient.answer(args.query, {
        systemPrompt: BASICS_SYSTEM_PROMPT,
        outputSchema: BASICS_OUTPUT_SCHEMA,
      })
    );

    let parsed: unknown;
    try {
      parsed = parseAnswer(result.answer);
    } catch {
      return { error: "parse_failed" };
    }

    const validation = CharacterBasicsSchema.safeParse(parsed);
    if (!validation.success) {
      console.error("[characterBasicsHandler] schema validation failed:", validation.error.format());
      return { error: "parse_failed" };
    }
    if (validation.data.confidence === 0) return { error: "character_not_found" };
    return validation.data;
  } catch {
    return { error: "search_failed" };
  }
}

export async function characterDetailsHandler(
  args: CharacterDetailsInput,
  exaClient: ExaClient = getExa() as unknown as ExaClient
): Promise<CharacterPersonality | { error: "parse_failed" | "search_failed" }> {
  const enrichedQuery = `${args.name}: ${args.shortDescription}, ${args.query}`;

  try {
    const [personalityResult, connectionsResult] = await Promise.all([
      withRetry(() =>
        exaClient.answer(enrichedQuery, {
          systemPrompt: PERSONALITY_SYSTEM_PROMPT,
          outputSchema: PERSONALITY_OUTPUT_SCHEMA,
        })
      ),
      withRetry(() =>
        exaClient.answer(enrichedQuery, {
          systemPrompt: CONNECTIONS_SYSTEM_PROMPT,
          outputSchema: CONNECTIONS_OUTPUT_SCHEMA,
        })
      ),
    ]);

    let parsedPersonality: unknown;
    let parsedConnections: unknown;
    try {
      parsedPersonality = parseAnswer(personalityResult.answer);
      parsedConnections = parseAnswer(connectionsResult.answer);
    } catch {
      return { error: "parse_failed" };
    }

    const personalityValidation = PersonalityPartSchema.safeParse(parsedPersonality);
    if (!personalityValidation.success) {
      console.error("[characterDetailsHandler] personality validation failed:", personalityValidation.error.format());
      return { error: "parse_failed" };
    }

    const connectionsValidation = ConnectionsPartSchema.safeParse(parsedConnections);
    if (!connectionsValidation.success) {
      console.error("[characterDetailsHandler] connections validation failed:", connectionsValidation.error.format());
      return { error: "parse_failed" };
    }

    return {
      ...personalityValidation.data,
      relationships: Object.fromEntries(
        connectionsValidation.data.relationships.map((r) => [r.characterName, r.description])
      ),
      knowledgeScope: Object.fromEntries(
        connectionsValidation.data.knowledgeScope.map((k) => [k.domain, k.description])
      ),
    };
  } catch {
    return { error: "search_failed" };
  }
}

export async function characterSearchHandler(
  args: CharacterSearchInput,
  exaClient: ExaClient = getExa() as unknown as ExaClient
): Promise<CharacterSearchResult | { error: "character_not_found" | "parse_failed" | "search_failed" }> {
  const basics = await characterBasicsHandler(args, exaClient);
  if ("error" in basics) return basics;

  const details = await characterDetailsHandler(
    { query: args.query, name: basics.name, shortDescription: basics.shortDescription },
    exaClient
  );
  if ("error" in details) return details;

  const merged = {
    name: basics.name,
    imageUrl: basics.imageUrl,
    shortDescription: basics.shortDescription,
    firstAppearanceDate: basics.firstAppearanceDate,
    confidence: basics.confidence,
    personality: details,
  };

  const validation = CharacterSearchResultSchema.safeParse(merged);
  if (!validation.success) return { error: "parse_failed" };
  return validation.data;
}
