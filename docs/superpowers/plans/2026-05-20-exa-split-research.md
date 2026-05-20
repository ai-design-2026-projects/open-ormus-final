# Exa Split Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single monolithic Exa character search call with a sequential-then-parallel split: basics first (5 fields), then personality (9 fields) + connections (2 fields) in parallel; expose 2 agent tools; preserve backward-compatible `characterSearchHandler`.

**Architecture:** `characterBasicsHandler` fires one Exa call (≤10 fields). On success, `characterDetailsHandler` builds an enriched query from the confirmed name + shortDescription and fires two parallel Exa calls (9 + 2 fields). `characterSearchHandler` chains both and remains the public API for non-agent callers. The agent gets two separate tools so it can show the user a confirmed identity before committing to the full enrichment.

**Tech Stack:** TypeScript, Zod v4, exa-js, Bun test, Anthropic SDK (`@anthropic-ai/sdk`)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `packages/shared/schema/character_search.ts` | Modify | Add `CharacterBasicsSchema` + `CharacterBasics` type |
| `packages/shared/services/character_search.service.ts` | Rewrite | Split into 3 handlers + `withRetry` + 3 internal Exa sub-schemas |
| `packages/shared/services/character_search.service.test.ts` | Modify | Update mocks; add tests for basics/details handlers and retry |
| `packages/shared/index.ts` | Modify | Export new schema + handlers |
| `frontend/lib/agent/tools/exa_research.ts` | Modify | Replace single character tool with 2 tools |
| `frontend/lib/agent/loop.ts` | Modify | Update imports + tool dispatch |
| `frontend/lib/agent/prompt.ts` | Modify | Update agent instructions for 2-step character research |

---

## Task 1: Add CharacterBasicsSchema to the shared schema

**Files:**
- Modify: `packages/shared/schema/character_search.ts`

- [ ] **Step 1: Add `CharacterBasicsSchema` and `CharacterBasics` type**

Open `packages/shared/schema/character_search.ts`. After the existing `CharacterSearchInputSchema` block and before `CharacterPersonalityShape`, add:

```ts
// Step 1 result — basic character identity (5 fields, within Exa limit)
export const CharacterBasicsSchema = z.object({
  name: z.string(),
  imageUrl: z.string().nullable(),
  shortDescription: z.string(),
  firstAppearanceDate: z.string(),
  confidence: z.number().int().min(0).max(3) as z.ZodType<0 | 1 | 2 | 3>,
});
export type CharacterBasics = z.infer<typeof CharacterBasicsSchema>;
```

- [ ] **Step 2: Verify typecheck passes**

```bash
bun run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/schema/character_search.ts
git commit -m "feat(schema): add CharacterBasicsSchema for Exa split step 1"
```

---

## Task 2: Write failing tests for new service handlers

**Files:**
- Modify: `packages/shared/services/character_search.service.test.ts`

The existing tests cover `characterSearchHandler`. Add tests for the two new handlers and retry behavior. The new tests will fail until Task 3 implements the handlers.

**Key insight for mocks:** all three Exa sub-calls (basics, personality, connections) accept the same flat mock object — Zod `.safeParse()` picks only the fields each sub-schema declares, ignoring the rest.

- [ ] **Step 1: Update the mock objects and add new describe blocks**

Replace the entire contents of `packages/shared/services/character_search.service.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import {
  characterSearchHandler,
  characterBasicsHandler,
  characterDetailsHandler,
} from "./character_search.service";

// ── Shared flat mock payload ──────────────────────────────────────────────────
// All fields at root level. Zod safeParse strips what each sub-schema doesn't need.
const flatCharacter = {
  name: "Walter White",
  imageUrl: null,
  shortDescription: "Chemistry teacher turned drug lord.",
  firstAppearanceDate: "2008-01-20",
  confidence: 3 as const,
  // personality fields (flat — matches PERSONALITY_OUTPUT_SCHEMA)
  personalityTraits: ["intelligent", "prideful"],
  backstory: "High school chemistry teacher diagnosed with cancer.",
  speechPatterns: ["measured", "precise"],
  values: ["family", "pride"],
  fears: ["obscurity", "death"],
  goals: ["provide for family", "build empire"],
  notableQuotes: ["I am the one who knocks."],
  abilities: ["chemistry", "manipulation"],
  copingStyle: ["denial", "rationalization"],
  // connections fields (flat — matches CONNECTIONS_OUTPUT_SCHEMA)
  relationships: { "Jesse Pinkman": "former student and partner" },
  knowledgeScope: { chemistry: "expert" },
};

const mockSuccess = { answer: async () => ({ answer: flatCharacter }) };
const mockThrows = {
  answer: async () => {
    throw new Error("network fail");
  },
};
const mockNotFound = {
  answer: async () => ({
    answer: {
      ...flatCharacter,
      confidence: 0,
      name: "",
      shortDescription: "",
    },
  }),
};

// ── characterBasicsHandler ────────────────────────────────────────────────────

describe("characterBasicsHandler", () => {
  test("returns basics on valid Exa response", async () => {
    const result = await characterBasicsHandler({ query: "Walter White" }, mockSuccess);
    if ("error" in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.name).toBe("Walter White");
    expect(result.confidence).toBe(3);
    expect(result.shortDescription).toBe("Chemistry teacher turned drug lord.");
  });

  test("returns search_failed when Exa throws", async () => {
    const result = await characterBasicsHandler({ query: "x" }, mockThrows);
    expect(result).toEqual({ error: "search_failed" });
  });

  test("returns character_not_found when confidence is 0", async () => {
    const result = await characterBasicsHandler({ query: "x" }, mockNotFound);
    expect(result).toEqual({ error: "character_not_found" });
  });

  test("returns parse_failed when answer is bad JSON string", async () => {
    const mock = { answer: async () => ({ answer: "bad{json" }) };
    const result = await characterBasicsHandler({ query: "x" }, mock);
    expect(result).toEqual({ error: "parse_failed" });
  });

  test("returns parse_failed when answer fails schema validation", async () => {
    const mock = { answer: async () => ({ answer: { wrong: true } }) };
    const result = await characterBasicsHandler({ query: "x" }, mock);
    expect(result).toEqual({ error: "parse_failed" });
  });

  test("retries up to 3 times on transient error then succeeds", async () => {
    let calls = 0;
    const mock = {
      answer: async () => {
        calls++;
        if (calls < 3) throw new Error("transient");
        return { answer: flatCharacter };
      },
    };
    const result = await characterBasicsHandler({ query: "Walter White" }, mock);
    if ("error" in result) throw new Error(`unexpected: ${result.error}`);
    expect(result.name).toBe("Walter White");
    expect(calls).toBe(3);
  });

  test("returns search_failed after 3 failed retries", async () => {
    let calls = 0;
    const mock = {
      answer: async () => {
        calls++;
        throw new Error("permanent");
      },
    };
    const result = await characterBasicsHandler({ query: "x" }, mock);
    expect(result).toEqual({ error: "search_failed" });
    expect(calls).toBe(3);
  });
});

// ── characterDetailsHandler ───────────────────────────────────────────────────

describe("characterDetailsHandler", () => {
  const detailsArgs = {
    query: "Walter White, Breaking Bad",
    name: "Walter White",
    shortDescription: "Chemistry teacher turned drug lord.",
  };

  test("merges personality and connections on valid Exa response", async () => {
    const result = await characterDetailsHandler(detailsArgs, mockSuccess);
    if ("error" in result) throw new Error(`unexpected: ${JSON.stringify(result)}`);
    expect(result.personalityTraits).toEqual(["intelligent", "prideful"]);
    expect(result.relationships).toEqual({ "Jesse Pinkman": "former student and partner" });
    expect(result.knowledgeScope).toEqual({ chemistry: "expert" });
    expect(result.backstory).toBe("High school chemistry teacher diagnosed with cancer.");
  });

  test("returns search_failed when Exa throws on both sub-requests", async () => {
    const result = await characterDetailsHandler(detailsArgs, mockThrows);
    expect(result).toEqual({ error: "search_failed" });
  });

  test("returns parse_failed when personality response fails schema", async () => {
    const mock = { answer: async () => ({ answer: { wrong: true } }) };
    const result = await characterDetailsHandler(detailsArgs, mock);
    expect(result).toEqual({ error: "parse_failed" });
  });

  test("uses enriched query (name + shortDescription + original query)", async () => {
    const capturedQueries: string[] = [];
    const mock = {
      answer: async (query: string) => {
        capturedQueries.push(query);
        return { answer: flatCharacter };
      },
    };
    await characterDetailsHandler(detailsArgs, mock);
    expect(capturedQueries.length).toBe(2);
    for (const q of capturedQueries) {
      expect(q).toContain("Walter White");
      expect(q).toContain("Chemistry teacher turned drug lord.");
      expect(q).toContain("Walter White, Breaking Bad");
    }
  });
});

// ── characterSearchHandler (wrapper) ─────────────────────────────────────────

describe("characterSearchHandler", () => {
  test("returns full CharacterSearchResult on valid Exa response", async () => {
    const result = await characterSearchHandler({ query: "Walter White" }, mockSuccess);
    if ("error" in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.name).toBe("Walter White");
    expect(result.confidence).toBe(3);
    expect(result.personality.personalityTraits).toEqual(["intelligent", "prideful"]);
    expect(result.personality.relationships).toEqual({
      "Jesse Pinkman": "former student and partner",
    });
  });

  test("returns search_failed when Exa throws", async () => {
    const result = await characterSearchHandler({ query: "x" }, mockThrows);
    expect(result).toEqual({ error: "search_failed" });
  });

  test("returns character_not_found when confidence is 0", async () => {
    const result = await characterSearchHandler({ query: "x" }, mockNotFound);
    expect(result).toEqual({ error: "character_not_found" });
  });

  test("returns parse_failed when answer is bad JSON string", async () => {
    const mock = { answer: async () => ({ answer: "bad{json" }) };
    const result = await characterSearchHandler({ query: "x" }, mock);
    expect(result).toEqual({ error: "parse_failed" });
  });

  test("returns parse_failed when answer fails schema validation", async () => {
    const mock = { answer: async () => ({ answer: { wrong: true } }) };
    const result = await characterSearchHandler({ query: "x" }, mock);
    expect(result).toEqual({ error: "parse_failed" });
  });
});
```

- [ ] **Step 2: Run tests — verify they fail (new handlers not yet defined)**

```bash
bun test --cwd packages/shared services/character_search.service.test.ts 2>&1 | tail -20
```

Expected: errors importing `characterBasicsHandler` / `characterDetailsHandler` (not yet exported).

- [ ] **Step 3: Commit failing tests**

```bash
git add packages/shared/services/character_search.service.test.ts
git commit -m "test(exa): add failing tests for split character search handlers"
```

---

## Task 3: Implement the split service handlers

**Files:**
- Rewrite: `packages/shared/services/character_search.service.ts`

Replace the entire file:

- [ ] **Step 1: Write the new service implementation**

```ts
import { z } from "zod";
import {
  type CharacterSearchInput,
  type CharacterSearchResult,
  CharacterSearchResultSchema,
  type CharacterBasics,
  CharacterBasicsSchema,
  type CharacterPersonality,
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
  return JSON.parse(str);
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
    relationships: { type: "object", additionalProperties: { type: "string" } },
    knowledgeScope: { type: "object", additionalProperties: { type: "string" } },
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
  relationships: z.record(z.string(), z.string()),
  knowledgeScope: z.record(z.string(), z.string()),
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

const CONNECTIONS_SYSTEM_PROMPT = `You are a fictional character analyst. Populate the relationships and knowledge scope for the identified character. For relationships, map character names to a short description of their relationship to this character.`;

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
    if (!validation.success) return { error: "parse_failed" };
    if (validation.data.confidence === 0) return { error: "character_not_found" };
    return validation.data;
  } catch {
    return { error: "search_failed" };
  }
}

export type CharacterDetailsInput = {
  query: string;
  name: string;
  shortDescription: string;
};

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
    if (!personalityValidation.success) return { error: "parse_failed" };

    const connectionsValidation = ConnectionsPartSchema.safeParse(parsedConnections);
    if (!connectionsValidation.success) return { error: "parse_failed" };

    return {
      ...personalityValidation.data,
      relationships: connectionsValidation.data.relationships,
      knowledgeScope: connectionsValidation.data.knowledgeScope,
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
```

- [ ] **Step 2: Run tests — all should pass**

```bash
bun test --cwd packages/shared services/character_search.service.test.ts 2>&1
```

Expected output:
```
✓ characterBasicsHandler > returns basics on valid Exa response
✓ characterBasicsHandler > returns search_failed when Exa throws
✓ characterBasicsHandler > returns character_not_found when confidence is 0
✓ characterBasicsHandler > returns parse_failed when answer is bad JSON string
✓ characterBasicsHandler > returns parse_failed when answer fails schema validation
✓ characterBasicsHandler > retries up to 3 times on transient error then succeeds
✓ characterBasicsHandler > returns search_failed after 3 failed retries
✓ characterDetailsHandler > merges personality and connections on valid Exa response
✓ characterDetailsHandler > returns search_failed when Exa throws on both sub-requests
✓ characterDetailsHandler > returns parse_failed when personality response fails schema
✓ characterDetailsHandler > uses enriched query (name + shortDescription + original query)
✓ characterSearchHandler > returns full CharacterSearchResult on valid Exa response
✓ characterSearchHandler > returns search_failed when Exa throws
✓ characterSearchHandler > returns character_not_found when confidence is 0
✓ characterSearchHandler > returns parse_failed when answer is bad JSON string
✓ characterSearchHandler > returns parse_failed when answer fails schema validation
16 pass
```

- [ ] **Step 3: Run full test suite**

```bash
bun test --cwd mcp_server 2>&1 | tail -5
```

Expected: same pass/fail counts as baseline (27 pass, 2 fail — the 2 pre-existing failures are unrelated).

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck 2>&1 | tail -10
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/services/character_search.service.ts
git commit -m "feat(exa): split character search into basics + details handlers with retry"
```

---

## Task 4: Update shared package exports

**Files:**
- Modify: `packages/shared/index.ts`

- [ ] **Step 1: Add new exports**

In `packages/shared/index.ts`, update the `character_search` schema export block and the `character_search.service` export line:

Replace:
```ts
export {
  CharacterSearchInputShape,
  CharacterSearchInputSchema,
  type CharacterSearchInput,
  CharacterPersonalitySchema,
  type CharacterPersonality,
  CharacterSearchResultSchema,
  type CharacterSearchResult,
} from "./schema/character_search";
```

With:
```ts
export {
  CharacterSearchInputShape,
  CharacterSearchInputSchema,
  type CharacterSearchInput,
  CharacterBasicsSchema,
  type CharacterBasics,
  CharacterPersonalitySchema,
  type CharacterPersonality,
  CharacterSearchResultSchema,
  type CharacterSearchResult,
} from "./schema/character_search";
```

Replace:
```ts
export { characterSearchHandler } from "./services/character_search.service";
```

With:
```ts
export {
  characterBasicsHandler,
  characterDetailsHandler,
  type CharacterDetailsInput,
  characterSearchHandler,
} from "./services/character_search.service";
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck 2>&1 | tail -10
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/index.ts
git commit -m "feat(shared): export CharacterBasics, characterBasicsHandler, characterDetailsHandler"
```

---

## Task 5: Update agent tools — 2 character tools

**Files:**
- Modify: `frontend/lib/agent/tools/exa_research.ts`

- [ ] **Step 1: Rewrite exa_research.ts**

Replace the entire file:

```ts
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import {
  characterBasicsHandler,
  characterDetailsHandler,
  showSearchHandler,
} from "@open-ormus/shared";
import type {
  CharacterBasics,
  CharacterPersonality,
  ShowResult,
} from "@open-ormus/shared";

// ─── Show research (unchanged) ────────────────────────────────────────────────

export const researchShowTool: Tool = {
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

export const researchCharacterBasicsTool: Tool = {
  name: "research_character_basics",
  description:
    "Research the basic identity of a fictional character using Exa. " +
    "Returns name, shortDescription, firstAppearanceDate, imageUrl, and confidence (0–3). " +
    "Call this FIRST when researching any character. " +
    "If confidence is 0, the character was not found — stop and inform the user. " +
    "If confidence > 0, call research_character_details next with the returned name and shortDescription.",
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

export const researchCharacterDetailsTool: Tool = {
  name: "research_character_details",
  description:
    "Research the full personality, backstory, and connections of a confirmed fictional character. " +
    "Must be called AFTER research_character_basics — pass the name and shortDescription from that result. " +
    "Returns all personality fields: personalityTraits, backstory, speechPatterns, values, fears, goals, " +
    "notableQuotes, abilities, copingStyle, relationships, knowledgeScope. " +
    "After this returns, call mcp__openormus__character_save with the merged data: " +
    "combine the basics fields (name, imageUrl, shortDescription, firstAppearanceDate, confidence) " +
    "with this result as the 'personality' field.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "Original search query used in research_character_basics (e.g. 'Walter White, Breaking Bad').",
      },
      name: {
        type: "string",
        description: "Character name returned by research_character_basics.",
      },
      shortDescription: {
        type: "string",
        description: "Short description returned by research_character_basics.",
      },
    },
    required: ["query", "name", "shortDescription"],
  },
};

export async function handleCharacterDetailsResearch(args: {
  query: string;
  name: string;
  shortDescription: string;
}): Promise<CharacterPersonality | { error: string }> {
  const result = await characterDetailsHandler(args);
  if ("error" in result) return { error: result.error };
  return result;
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck 2>&1 | tail -10
```

Expected: 0 errors. If you see errors about removed exports (`exaResearchTool`, `handleExaResearch`), that means `loop.ts` still imports them — fix in the next task first, then recheck.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/agent/tools/exa_research.ts
git commit -m "feat(agent): replace research_character_online with 2-step basics + details tools"
```

---

## Task 6: Update agent loop dispatch

**Files:**
- Modify: `frontend/lib/agent/loop.ts`

- [ ] **Step 1: Update imports**

Replace the existing exa import line:
```ts
import { handleExaResearch, exaResearchTool, handleShowResearch, researchShowTool } from "./tools/exa_research";
```

With:
```ts
import {
  handleShowResearch,
  researchShowTool,
  handleCharacterBasicsResearch,
  researchCharacterBasicsTool,
  handleCharacterDetailsResearch,
  researchCharacterDetailsTool,
} from "./tools/exa_research";
```

- [ ] **Step 2: Update tools array**

Replace:
```ts
const tools = [...buildMcpTools(), researchShowTool, exaResearchTool, wizardTool];
```

With:
```ts
const tools = [...buildMcpTools(), researchShowTool, researchCharacterBasicsTool, researchCharacterDetailsTool, wizardTool];
```

- [ ] **Step 3: Update tool dispatch**

Replace:
```ts
        } else if (block.name === "research_character_online") {
          const input = block.input as { query: string };
          result = await handleExaResearch(input);
```

With:
```ts
        } else if (block.name === "research_character_basics") {
          const input = block.input as { query: string };
          result = await handleCharacterBasicsResearch(input);
        } else if (block.name === "research_character_details") {
          const input = block.input as { query: string; name: string; shortDescription: string };
          result = await handleCharacterDetailsResearch(input);
```

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck 2>&1 | tail -10
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/agent/loop.ts
git commit -m "feat(agent): dispatch research_character_basics and research_character_details in loop"
```

---

## Task 7: Update agent system prompt

**Files:**
- Modify: `frontend/lib/agent/prompt.ts`

- [ ] **Step 1: Update AGENT_SYSTEM_PROMPT**

Replace the entire file:

```ts
export const AGENT_SYSTEM_PROMPT = `You are an assistant for managing a collection of fictional characters.

## What you can do

- **List, search, add, edit, delete** characters using the mcp__openormus__character_* tools.
- **Import from a show/film/book**: when the user asks to import or create characters from a collection (e.g. "add all Breaking Bad characters", "create the characters from iCarly"):
  1. Call \`research_show_online\` with the show/film/book title. It returns a character names list.
  2. For each name in \`characters[]\`:
     a. Call \`research_character_basics\` with the name and show context (e.g. "Carly Shay, iCarly").
     b. If the result has \`confidence === 0\`, skip this character and move to the next.
     c. Call \`research_character_details\` with \`{ query: "<name>, <show>", name, shortDescription }\` from the basics result.
     d. Call \`mcp__openormus__character_save\` with:
        \`{ name, imageUrl, shortDescription, firstAppearanceDate, confidence }\` from basics
        + \`{ personality: <full details result> }\`.
  Do NOT skip step 1. Do NOT call \`research_character_basics\` with the show title — it only searches individual characters.
- **Research a specific character**: when the user names a specific fictional character (e.g. "add Walter White"):
  1. Call \`research_character_basics\` with the character name and show context.
  2. If \`confidence === 0\`, tell the user the character was not found.
  3. Otherwise call \`research_character_details\` with \`{ query, name, shortDescription }\` from step 1.
  4. Call \`mcp__openormus__character_save\` with the merged data (see above).
  Do not ask for confirmation before saving.
- **Custom character wizard**: when the user wants to create an original character from scratch (not based on an existing fictional character), call \`start_character_wizard\`. Follow the returned instructions exactly — ask one question at a time, wait for the user's answer before continuing.
- **Scene simulation**: when the user wants to simulate a scene or conversation between characters, identify the relevant character IDs from the user's collection and call \`mcp__openormus__scene_simulate\`.

## Rules

- Never invent character IDs. Use \`mcp__openormus__character_list\` or \`mcp__openormus__character_db_search\` to find real IDs.
- Do not skip wizard steps. Ask each question in order.
- Keep responses concise. When listing characters, summarise — do not dump full JSON.
- If a tool returns an error, explain it to the user in plain language.`;
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck 2>&1 | tail -10
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/agent/prompt.ts
git commit -m "feat(agent): update system prompt for 2-step character research flow"
```

---

## Task 8: Final verification

- [ ] **Step 1: Run full test suite**

```bash
bun test --cwd mcp_server 2>&1 | tail -10
bun test --cwd packages/shared 2>&1 | tail -10
```

Expected:
- `mcp_server`: 27 pass, 2 fail (same pre-existing failures)
- `packages/shared`: all new tests pass (16+ pass, 0 new failures)

- [ ] **Step 2: Full typecheck**

```bash
bun run typecheck 2>&1
```

Expected: 0 errors.

- [ ] **Step 3: Verify UI route unchanged**

```bash
grep -n "characterSearchHandler" frontend/app/api/exa/character-search/route.ts
```

Expected: line with `characterSearchHandler` still present — API route is untouched.

- [ ] **Step 4: Verify ImportStep.tsx unchanged**

```bash
grep -n "character-search\|show-search" frontend/components/characters/ImportStep.tsx
```

Expected: references to `/api/exa/character-search` and `/api/exa/show-search` unchanged.

- [ ] **Step 5: Final commit**

```bash
git add -A
git status  # verify nothing unexpected is staged
git commit -m "chore: final verification — exa split research complete"
```
