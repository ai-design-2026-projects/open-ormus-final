# Agent Tools Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all agent tools to MCP, fix Exa search quality, rename tools for clarity, enable parallel tool execution, and replace the hardcoded agent prompt with a minimal generic one.

**Architecture:** All tool logic lives in the MCP server; the frontend agent bridge is a thin pass-through. A new `packages/shared/tool-descriptions.ts` is the single source of truth for descriptions consumed by both the bridge and the server. The agent prompt only states invariants — tool descriptions carry all workflow knowledge.

**Tech Stack:** Bun, TypeScript, Zod v4, `@modelcontextprotocol/sdk@^1.29`, OpenAI SDK (chat loop), Exa (character/show research)

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `packages/shared/tool-descriptions.ts` | **Create** | Centralised description strings |
| `packages/shared/index.ts` | **Modify** | Export `TOOL_DESCRIPTIONS`; remove scene exports |
| `packages/shared/schema/scene.ts` | **Delete** | Only used by removed scene_simulate |
| `packages/shared/schema/scene.test.ts` | **Delete** | Test for deleted schema |
| `packages/shared/services/show_search.service.ts` | **Modify** | Two-call Exa, dedup, prompt fixes |
| `packages/shared/services/show_search.service.test.ts` | **Modify** | Update for two-call mock |
| `packages/shared/services/character_search.service.ts` | **Modify** | Query prefix + system prompt hardening |
| `packages/shared/services/character_search.service.test.ts` | **Modify** | Update query-capture test |
| `mcp_server/package.json` | **Modify** | Upgrade Zod v3→v4 |
| `mcp_server/src/registry/registry.ts` | **Modify** | Remove scene_simulate registration |
| `mcp_server/src/registry/tools/character_save.ts` | **Modify** | Rename ID → `character_create`, import description |
| `mcp_server/src/registry/tools/character_list.ts` | **Modify** | Import description |
| `mcp_server/src/registry/tools/character_update.ts` | **Modify** | Import description |
| `mcp_server/src/registry/tools/character_delete.ts` | **Modify** | Import description |
| `mcp_server/src/registry/tools/character_db_search.ts` | **Modify** | Rename ID → `character_find`, import description |
| `mcp_server/src/registry/tools/character_search.ts` | **Modify** | Rename ID → `character_research`, import description, remove `as any` |
| `mcp_server/src/registry/tools/show_search.ts` | **Modify** | Rename ID → `show_research`, import description, remove `as any` |
| `mcp_server/src/registry/tools/scene_simulate.ts` | **Delete** | Removed feature |
| `mcp_server/src/registry/tools/scene_simulate.test.ts` | **Delete** | Test for deleted tool |
| `frontend/lib/agent/tools/exa_research.ts` | **Delete** | Replaced by MCP tools |
| `frontend/lib/agent/tools/wizard.ts` | **Delete** | Removed feature |
| `frontend/lib/agent/mcp_bridge.ts` | **Modify** | New tool IDs, add show_research + character_research, remove scene_simulate, fix character_update schema, import descriptions |
| `frontend/lib/agent/loop.ts` | **Modify** | Remove local tool handlers; parallel execution with `Promise.allSettled` |
| `frontend/lib/agent/prompt.ts` | **Modify** | New minimal system prompt |

---

## Task 1: Create packages/shared/tool-descriptions.ts

**Files:**
- Create: `packages/shared/tool-descriptions.ts`
- Modify: `packages/shared/index.ts`

- [ ] **Step 1: Write the file**

```ts
// packages/shared/tool-descriptions.ts
export const TOOL_DESCRIPTIONS = {
  show_research:
    "Search online for a TV series, film, or book by title. " +
    "Returns show metadata and a list of main character names. " +
    "Call this first when importing characters from a franchise, " +
    "then call character_research for each name in the returned list. " +
    "Fails completely if any part of the lookup fails.",

  character_research:
    "Research a fictional character online by name. " +
    "Returns a complete profile (traits, backstory, relationships, speech patterns) " +
    "ready to pass directly to character_create. " +
    "Include show context in the query for accuracy (e.g. 'Walter White, Breaking Bad'). " +
    "Returns an error if the character cannot be identified — skip and continue.",

  character_create:
    "Save a character profile to the collection. " +
    "Pass the object returned by character_research directly, or construct one manually. " +
    "If any required fields are missing, ask the user for them one at a time before calling. " +
    "Returns the saved character with its assigned ID.",

  character_find:
    "Search saved characters in the collection by name or description using fuzzy matching. " +
    "Use this to resolve a character name to an ID before updating or deleting. " +
    "Returns matching characters with IDs and short descriptions.",

  character_list:
    "List all characters saved in the collection. " +
    "Use when the user wants an overview or when searching by name is not precise enough.",

  character_update:
    "Replace a character's full profile by ID. " +
    "Resolve the ID first with character_find or character_list. " +
    "Replaces the entire sheet — include all fields, not just the changed ones.",

  character_delete:
    "Delete a character from the collection by ID. " +
    "Resolve the ID first with character_find or character_list.",
} as const;
```

- [ ] **Step 2: Export from packages/shared/index.ts**

Add at the top of `packages/shared/index.ts`:
```ts
export { TOOL_DESCRIPTIONS } from "./tool-descriptions";
```

- [ ] **Step 3: Verify it type-checks**

Run: `bun run typecheck`
Expected: no errors related to `tool-descriptions.ts`

- [ ] **Step 4: Commit**

```bash
git add packages/shared/tool-descriptions.ts packages/shared/index.ts
git commit -m "feat: add centralised tool descriptions to shared package"
```

---

## Task 2: Fix show_search — two-call Exa + deduplication + prompt fixes

**Files:**
- Modify: `packages/shared/services/show_search.service.ts`
- Modify: `packages/shared/services/show_search.service.test.ts`

- [ ] **Step 1: Write failing tests for new behaviour**

Replace the content of `packages/shared/services/show_search.service.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { showSearchHandler } from "./show_search.service";

// First call returns show metadata (no characters).
// Second call (per show) returns characters.
const metadataPayload = {
  results: [
    { title: "Money Heist", description: "A heist drama.", year: 2017, genre: "Crime" },
  ],
};
const charactersPayload = { characters: ["Berlin", "Tokyo", "Professor"] };

let callCount = 0;
const mockTwoCalls = {
  answer: async (_query: string) => {
    callCount++;
    if (callCount === 1) return { answer: metadataPayload };
    return { answer: charactersPayload };
  },
};

const mockThrows = { answer: async () => { throw new Error("network fail"); } };
const mockBadJson = { answer: async () => ({ answer: "not-json{{{" }) };
const mockBadSchema = { answer: async () => ({ answer: { wrong: true } }) };

describe("showSearchHandler", () => {
  test("makes two Exa calls: metadata then characters per show", async () => {
    callCount = 0;
    const result = await showSearchHandler({ query: "Money Heist" }, mockTwoCalls);
    if ("error" in result) throw new Error(`unexpected error: ${result.error}`);
    expect(callCount).toBe(2);
    expect(result.results[0]?.title).toBe("Money Heist");
    expect(result.results[0]?.characters).toEqual(["Berlin", "Tokyo", "Professor"]);
  });

  test("deduplicates shows with same normalised title", async () => {
    // Two shows with same name, different parentheticals
    const dupMetadata = {
      results: [
        { title: "Money Heist", description: "A heist drama.", year: 2017, genre: "Crime" },
        { title: "Money Heist (La casa de papel)", description: "Same show.", year: 2017, genre: "Crime" },
      ],
    };
    let c = 0;
    const mock = {
      answer: async () => {
        c++;
        if (c === 1) return { answer: dupMetadata };
        return { answer: charactersPayload };
      },
    };
    const result = await showSearchHandler({ query: "Money Heist" }, mock);
    if ("error" in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.results.length).toBe(1);
    expect(result.results[0]?.title).toBe("Money Heist");
  });

  test("returns search_failed when first Exa call throws", async () => {
    const result = await showSearchHandler({ query: "x" }, mockThrows);
    expect(result).toEqual({ error: "search_failed" });
  });

  test("returns search_failed when character lookup throws", async () => {
    let c = 0;
    const mock = {
      answer: async () => {
        c++;
        if (c === 1) return { answer: metadataPayload };
        throw new Error("char lookup fail");
      },
    };
    const result = await showSearchHandler({ query: "x" }, mock);
    expect(result).toEqual({ error: "search_failed" });
  });

  test("returns parse_failed when metadata answer fails schema validation", async () => {
    const result = await showSearchHandler({ query: "x" }, mockBadSchema);
    expect(result).toEqual({ error: "parse_failed" });
  });

  test("returns parse_failed when metadata answer is bad JSON string", async () => {
    const result = await showSearchHandler({ query: "x" }, mockBadJson);
    expect(result).toEqual({ error: "parse_failed" });
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `bun test --cwd packages/shared services/show_search.service.test.ts`
Expected: FAIL — "makes two Exa calls" fails because current handler makes one call

- [ ] **Step 3: Rewrite showSearchHandler**

Replace the entire content of `packages/shared/services/show_search.service.ts`:

```ts
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
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `bun test --cwd packages/shared services/show_search.service.test.ts`
Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/services/show_search.service.ts packages/shared/services/show_search.service.test.ts
git commit -m "feat: rework show_search to two-call Exa with deduplication and prompt fixes"
```

---

## Task 3: Fix character research — query prefix + system prompt hardening

**Files:**
- Modify: `packages/shared/services/character_search.service.ts`
- Modify: `packages/shared/services/character_search.service.test.ts`

- [ ] **Step 1: Write a failing test for the query prefix behaviour**

In `packages/shared/services/character_search.service.test.ts`, inside the `characterBasicsHandler` describe block, add after the existing tests:

```ts
test("prefixes query with 'fictional character ' before sending to Exa", async () => {
  const capturedQueries: string[] = [];
  const mock = {
    answer: async (query: string) => {
      capturedQueries.push(query);
      return { answer: flatCharacter };
    },
  };
  await characterBasicsHandler({ query: "Bruno, Money Heist" }, mock);
  expect(capturedQueries[0]).toBe("fictional character Bruno, Money Heist");
});
```

- [ ] **Step 2: Run the new test — verify it fails**

Run: `bun test --cwd packages/shared services/character_search.service.test.ts`
Expected: FAIL — "prefixes query" test fails because current handler passes query as-is

- [ ] **Step 3: Update system prompts and add query prefix in character_search.service.ts**

In `packages/shared/services/character_search.service.ts`, replace the three system prompt constants and update `characterBasicsHandler`:

```ts
const BASICS_SYSTEM_PROMPT =
  "You are a fictional character analyst. Given a search query identifying a fictional character " +
  "(e.g. 'Walter White, Breaking Bad'), populate the basic identity fields. " +
  "The subject is always a fictional character from a film, TV series, book, or other fictional work — never a real person. " +
  "If a real person shares this name, ignore them entirely and focus only on the fictional character. " +
  "If the character is not identifiable from the query, return name as an empty string and imageUrl as null. " +
  "If the first appearance date is unknown, return null for firstAppearanceDate.";

const PERSONALITY_SYSTEM_PROMPT =
  "You are a fictional character analyst. Populate the personality fields for the identified character. " +
  "Draw from canonical sources. Be specific and detailed. " +
  "The subject is always a fictional character — never a real person. " +
  "If a real person shares this name, ignore them and focus only on the fictional character.";

const CONNECTIONS_SYSTEM_PROMPT =
  "You are a fictional character analyst. Populate the relationships and knowledge scope for the identified character. " +
  "The subject is always a fictional character — never a real person. " +
  "If a real person shares this name, ignore them and focus only on the fictional character. " +
  "For relationships: list each significant relationship as an entry with the related character's name and a brief description of the relationship. " +
  "For knowledgeScope: list each domain of knowledge as an entry with the domain name and a description of this character's level or type of expertise.";
```

In `characterBasicsHandler`, add the prefix before the Exa call:

```ts
export async function characterBasicsHandler(
  args: CharacterSearchInput,
  exaClient: ExaClient = getExa() as unknown as ExaClient
): Promise<CharacterBasics | { error: "character_not_found" | "parse_failed" | "search_failed" }> {
  const enrichedQuery = `fictional character ${args.query}`;
  try {
    const result = await withRetry(() =>
      exaClient.answer(enrichedQuery, {   // <-- enrichedQuery, not args.query
        systemPrompt: BASICS_SYSTEM_PROMPT,
        outputSchema: BASICS_OUTPUT_SCHEMA,
      })
    );
    // ... rest unchanged
```

- [ ] **Step 4: Update the existing "retries" and "uses enriched query" tests**

The test `"retries up to 3 times on transient error then succeeds"` and `"returns search_failed after 3 failed retries"` don't inspect the query — they still pass.

The test `"uses enriched query (name + shortDescription + original query)"` in `characterDetailsHandler` checks the exact query string — it tests `characterDetailsHandler`, not `characterBasicsHandler`, and its enrichment logic is unchanged. Verify it still passes.

Run: `bun test --cwd packages/shared services/character_search.service.test.ts`
Expected: all tests PASS including the new prefix test

- [ ] **Step 5: Commit**

```bash
git add packages/shared/services/character_search.service.ts packages/shared/services/character_search.service.test.ts
git commit -m "feat: add fictional character query prefix and harden system prompts against actor confusion"
```

---

## Task 4: Migrate mcp_server from Zod v3 to v4

**Files:**
- Modify: `mcp_server/package.json`

- [ ] **Step 1: Check MCP SDK's Zod peer dependency**

Run: `cat node_modules/@modelcontextprotocol/sdk/package.json | grep -A3 '"zod"'`

Note the output. If the SDK lists `zod` as a peer dependency (not bundled), upgrading mcp_server to v4 will resolve correctly. If it bundles Zod v3 internally, the `as any` casts on `server.tool()` calls may still be needed for TypeScript — but runtime behaviour is unaffected.

- [ ] **Step 2: Update mcp_server/package.json**

In `mcp_server/package.json`, change:
```json
"zod": "^3.25.23"
```
to:
```json
"zod": "^4.4.3"
```

- [ ] **Step 3: Install and verify**

Run: `bun install`
Expected: Zod v4 installed in mcp_server node_modules

- [ ] **Step 4: Run mcp_server tests**

Run: `bun test --cwd mcp_server`
Expected: all tests pass (Zod v4 is backward-compatible for the patterns used here)

- [ ] **Step 5: Type-check mcp_server**

Run: `bun run typecheck`

If `character_search.ts` and `show_search.ts` still show type errors on the `server.tool()` schema arguments: the SDK's TypeScript types still reference Zod v3 internals. Keep the `as any` cast only on the schema argument of those two calls. All other Zod usage in mcp_server is now v4.

- [ ] **Step 6: Commit**

```bash
git add mcp_server/package.json bun.lock
git commit -m "chore: upgrade mcp_server Zod v3 to v4"
```

---

## Task 5: Delete scene_simulate, wizard, exa_research, scene schema

**Files:**
- Delete: `mcp_server/src/registry/tools/scene_simulate.ts`
- Delete: `mcp_server/src/registry/tools/scene_simulate.test.ts`
- Delete: `packages/shared/schema/scene.ts`
- Delete: `packages/shared/schema/scene.test.ts`
- Delete: `frontend/lib/agent/tools/exa_research.ts`
- Delete: `frontend/lib/agent/tools/wizard.ts`
- Modify: `mcp_server/src/registry/registry.ts`
- Modify: `packages/shared/index.ts`

- [ ] **Step 1: Delete files**

```bash
rm mcp_server/src/registry/tools/scene_simulate.ts
rm mcp_server/src/registry/tools/scene_simulate.test.ts
rm packages/shared/schema/scene.ts
rm packages/shared/schema/scene.test.ts
rm frontend/lib/agent/tools/exa_research.ts
rm frontend/lib/agent/tools/wizard.ts
```

- [ ] **Step 2: Remove scene_simulate from registry.ts**

Replace the content of `mcp_server/src/registry/registry.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { register as registerCharacterSave } from "./tools/character_save.js";
import { register as registerCharacterList } from "./tools/character_list.js";
import { register as registerCharacterUpdate } from "./tools/character_update.js";
import { register as registerCharacterDelete } from "./tools/character_delete.js";
import { register as registerCharacterSearch } from "./tools/character_search.js";
import { register as registerCharacterDbSearch } from "./tools/character_db_search.js";
import { register as registerShowSearch } from "./tools/show_search.js";

export function createRegistry(): McpServer {
  const server = new McpServer({
    name: "open-ormus",
    version: "0.0.1",
  });

  registerCharacterSave(server);
  registerCharacterList(server);
  registerCharacterUpdate(server);
  registerCharacterDelete(server);
  registerCharacterSearch(server);
  registerCharacterDbSearch(server);
  registerShowSearch(server);

  return server;
}
```

- [ ] **Step 3: Remove scene exports from packages/shared/index.ts**

Remove these lines from `packages/shared/index.ts`:
```ts
export {
  SceneSimulateInputShape,
  SceneSimulateInputSchema,
  SceneResultSchema,
} from "./schema/scene";
```

- [ ] **Step 4: Type-check and test**

Run: `bun run typecheck && bun test --cwd mcp_server`
Expected: no errors (scene_simulate is fully removed)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: remove scene_simulate, wizard, and exa_research local tools"
```

---

## Task 6: Rename tool IDs in MCP server + import descriptions

**Files:**
- Modify: `mcp_server/src/registry/tools/character_save.ts`
- Modify: `mcp_server/src/registry/tools/character_list.ts`
- Modify: `mcp_server/src/registry/tools/character_update.ts`
- Modify: `mcp_server/src/registry/tools/character_delete.ts`
- Modify: `mcp_server/src/registry/tools/character_db_search.ts`
- Modify: `mcp_server/src/registry/tools/character_search.ts`
- Modify: `mcp_server/src/registry/tools/show_search.ts`

For each file: add `import { TOOL_DESCRIPTIONS } from "@open-ormus/shared";` and replace the hardcoded description string with `TOOL_DESCRIPTIONS.<key>`. Rename IDs where specified.

- [ ] **Step 1: Update character_save.ts — rename to character_create**

In `mcp_server/src/registry/tools/character_save.ts`, add the import and update the `server.tool()` call:

```ts
import { TOOL_DESCRIPTIONS } from "@open-ormus/shared";
// ... existing imports unchanged ...

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__character_create",     // renamed from character_save
    TOOL_DESCRIPTIONS.character_create,
    CharacterSaveInputShape,
    async (args: CharacterSaveInput) => ({
      content: [{ type: "text" as const, text: JSON.stringify(await characterSaveHandler(args)) }],
    })
  );
}
```

- [ ] **Step 2: Update character_list.ts**

```ts
import { TOOL_DESCRIPTIONS } from "@open-ormus/shared";
// ...
server.tool(
  "mcp__openormus__character_list",
  TOOL_DESCRIPTIONS.character_list,
  {},
  async () => ({
    content: [{ type: "text" as const, text: JSON.stringify(await characterListHandler()) }],
  })
);
```

- [ ] **Step 3: Update character_update.ts**

```ts
import { TOOL_DESCRIPTIONS } from "@open-ormus/shared";
// ...
server.tool(
  "mcp__openormus__character_update",
  TOOL_DESCRIPTIONS.character_update,
  CharacterUpdateInputShape,
  async (args: CharacterUpdateInput) => {
    // handler body unchanged
  }
);
```

- [ ] **Step 4: Update character_delete.ts**

```ts
import { TOOL_DESCRIPTIONS } from "@open-ormus/shared";
// ...
server.tool(
  "mcp__openormus__character_delete",
  TOOL_DESCRIPTIONS.character_delete,
  CharacterDeleteInputShape,
  async (args: CharacterDeleteInput) => ({
    content: [{ type: "text" as const, text: JSON.stringify(await characterDeleteHandler(args)) }],
  })
);
```

- [ ] **Step 5: Update character_db_search.ts — rename to character_find**

```ts
import { TOOL_DESCRIPTIONS } from "@open-ormus/shared";
// ...
server.tool(
  "mcp__openormus__character_find",       // renamed from character_db_search
  TOOL_DESCRIPTIONS.character_find,
  CharacterDbSearchInputShape,
  async (args: CharacterDbSearchInput) => ({
    content: [{ type: "text" as const, text: JSON.stringify(await characterDbSearchHandler(args)) }],
  })
);
```

- [ ] **Step 6: Update character_search.ts — rename to character_research**

```ts
import { TOOL_DESCRIPTIONS } from "@open-ormus/shared";
// ...
server.tool(
  "mcp__openormus__character_research",   // renamed from character_search
  TOOL_DESCRIPTIONS.character_research,
  CharacterSearchInputShape as any,       // keep as any if SDK types still expect Zod v3
  async (args: any) => ({
    content: [{ type: "text" as const, text: JSON.stringify(await characterSearchHandler(args)) }],
  })
);
```

- [ ] **Step 7: Update show_search.ts — rename to show_research**

```ts
import { TOOL_DESCRIPTIONS } from "@open-ormus/shared";
// ...
server.tool(
  "mcp__openormus__show_research",        // renamed from show_search
  TOOL_DESCRIPTIONS.show_research,
  ShowSearchInputShape as any,            // keep as any if SDK types still expect Zod v3
  async (args: any) => ({
    content: [{ type: "text" as const, text: JSON.stringify(await showSearchHandler(args)) }],
  })
);
```

- [ ] **Step 8: Run tests and type-check**

Run: `bun test --cwd mcp_server && bun run typecheck`
Expected: all tests pass, no type errors

- [ ] **Step 9: Commit**

```bash
git add mcp_server/src/registry/tools/
git commit -m "feat: rename MCP tool IDs and import descriptions from shared"
```

---

## Task 7: Update MCP bridge

**Files:**
- Modify: `frontend/lib/agent/mcp_bridge.ts`

- [ ] **Step 1: Rewrite buildMcpTools() in mcp_bridge.ts**

Replace the entire `buildMcpTools` function and add the import at the top:

```ts
import { TOOL_DESCRIPTIONS } from "@open-ormus/shared";
```

Replace `buildMcpTools`:

```ts
export function buildMcpTools(): AnthropicTool[] {
  return [
    {
      name: "mcp__openormus__show_research",
      description: TOOL_DESCRIPTIONS.show_research,
      input_schema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Show, film, or book title (e.g. 'Breaking Bad', 'Harry Potter')",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "mcp__openormus__character_research",
      description: TOOL_DESCRIPTIONS.character_research,
      input_schema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Character name with show context (e.g. 'Walter White, Breaking Bad')",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "mcp__openormus__character_create",
      description: TOOL_DESCRIPTIONS.character_create,
      input_schema: {
        type: "object" as const,
        properties: {
          name: { type: "string" },
          imageUrl: { type: ["string", "null"] as unknown as "string", description: "Portrait URL or null" },
          shortDescription: { type: "string" },
          firstAppearanceDate: { type: ["string", "null"] as unknown as "string", description: "ISO date string or null" },
          personality: {
            type: "object",
            description: "Full personality profile",
            properties: {
              personalityTraits: { type: "array", items: { type: "string" } },
              backstory: { type: "string" },
              relationships: { type: "object", additionalProperties: { type: "string" } },
              speechPatterns: { type: "array", items: { type: "string" } },
              values: { type: "array", items: { type: "string" } },
              fears: { type: "array", items: { type: "string" } },
              goals: { type: "array", items: { type: "string" } },
              notableQuotes: { type: "array", items: { type: "string" } },
              abilities: { type: "array", items: { type: "string" } },
              copingStyle: { type: "array", items: { type: "string" } },
              knowledgeScope: { type: "object", additionalProperties: { type: "string" } },
            },
            required: [
              "personalityTraits", "backstory", "relationships", "speechPatterns",
              "values", "fears", "goals", "notableQuotes", "abilities", "copingStyle", "knowledgeScope",
            ],
          },
        },
        required: ["name", "imageUrl", "shortDescription", "firstAppearanceDate", "personality"],
      },
    },
    {
      name: "mcp__openormus__character_find",
      description: TOOL_DESCRIPTIONS.character_find,
      input_schema: {
        type: "object" as const,
        properties: {
          query: { type: "string" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: ["query"],
      },
    },
    {
      name: "mcp__openormus__character_list",
      description: TOOL_DESCRIPTIONS.character_list,
      input_schema: { type: "object" as const, properties: {}, required: [] },
    },
    {
      name: "mcp__openormus__character_update",
      description: TOOL_DESCRIPTIONS.character_update,
      input_schema: {
        type: "object" as const,
        properties: {
          id: { type: "string", description: "UUID of the character to update" },
          sheet: {
            type: "object",
            description: "Complete replacement profile — all fields required",
            properties: {
              name: { type: "string" },
              imageUrl: { type: ["string", "null"] as unknown as "string" },
              shortDescription: { type: "string" },
              firstAppearanceDate: { type: ["string", "null"] as unknown as "string" },
              personality: {
                type: "object",
                properties: {
                  personalityTraits: { type: "array", items: { type: "string" } },
                  backstory: { type: "string" },
                  relationships: { type: "object", additionalProperties: { type: "string" } },
                  speechPatterns: { type: "array", items: { type: "string" } },
                  values: { type: "array", items: { type: "string" } },
                  fears: { type: "array", items: { type: "string" } },
                  goals: { type: "array", items: { type: "string" } },
                  notableQuotes: { type: "array", items: { type: "string" } },
                  abilities: { type: "array", items: { type: "string" } },
                  copingStyle: { type: "array", items: { type: "string" } },
                  knowledgeScope: { type: "object", additionalProperties: { type: "string" } },
                },
                required: [
                  "personalityTraits", "backstory", "relationships", "speechPatterns",
                  "values", "fears", "goals", "notableQuotes", "abilities", "copingStyle", "knowledgeScope",
                ],
              },
            },
            required: ["name", "imageUrl", "shortDescription", "firstAppearanceDate", "personality"],
          },
        },
        required: ["id", "sheet"],
      },
    },
    {
      name: "mcp__openormus__character_delete",
      description: TOOL_DESCRIPTIONS.character_delete,
      input_schema: {
        type: "object" as const,
        properties: { id: { type: "string", description: "UUID of the character to delete" } },
        required: ["id"],
      },
    },
  ];
}
```

- [ ] **Step 2: Type-check**

Run: `bun run typecheck`
Expected: no errors in `mcp_bridge.ts`

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/agent/mcp_bridge.ts
git commit -m "feat: update MCP bridge with new tool IDs, show_research, character_research, and fixed schemas"
```

---

## Task 8: Update loop.ts — remove local tools + parallel execution

**Files:**
- Modify: `frontend/lib/agent/loop.ts`

- [ ] **Step 1: Rewrite loop.ts**

Replace the entire file content:

```ts
import type {
  ChatCompletionMessageParam,
  ChatCompletionFunctionTool,
  ChatCompletionMessageFunctionToolCall,
} from "openai/resources/chat/completions";
import type { CompletionUsage } from "openai/resources";
import { createLLMClient } from "@/lib/llm-client";
import type { AnthropicTool } from "./types";
import { logLlmUsage, type UsageContext } from "@/lib/llm-usage";
import { LlmUsageSource } from "@/lib/generated/prisma/client";
import { encodeChunk } from "./stream";
import type { McpSession } from "./mcp_bridge";
import { buildMcpTools, callMcpTool } from "./mcp_bridge";
import { AGENT_SYSTEM_PROMPT } from "./prompt";

function toOpenAITool(t: AnthropicTool): ChatCompletionFunctionTool {
  const fn: ChatCompletionFunctionTool["function"] = {
    name: t.name,
    parameters: t.input_schema as Record<string, unknown>,
  };
  if (t.description !== undefined) fn.description = t.description;
  return { type: "function", function: fn };
}

export async function runAgentLoop(
  priorMessages: ChatCompletionMessageParam[],
  userMessage: string,
  mcpSession: McpSession,
  onChunk: (data: Uint8Array) => void,
  ctx: UsageContext = { source: LlmUsageSource.AGENT_SESSION },
): Promise<{ messages: ChatCompletionMessageParam[]; assistantText: string; toolCallsJson: unknown }> {
  const client = createLLMClient();

  const send = (chunk: Parameters<typeof encodeChunk>[0]) => {
    onChunk(encodeChunk(chunk));
  };

  const messages: ChatCompletionMessageParam[] = [
    ...priorMessages,
    { role: "user", content: userMessage },
  ];

  const tools = (buildMcpTools() as AnthropicTool[]).map(toOpenAITool);

  let assistantText = "";

  while (true) {
    const iterStartTime = Date.now();
    const { data: rawStream, response: llmResponse } = await client.chat.completions.create(
      {
        model: process.env["CONVERSATION_MODEL"] ?? "default",
        max_tokens: 4096,
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          { role: "system", content: AGENT_SYSTEM_PROMPT },
          ...messages,
        ],
        tools,
      },
    ).withResponse();

    const headerGenerationId = llmResponse.headers.get("x-generation-id");
    console.log("[loop.ts] x-generation-id header:", headerGenerationId);

    let iterGenerationId = headerGenerationId ?? "";
    let iterContent = "";
    let iterFinishReason: string | null = null;
    let iterUsage: CompletionUsage | null = null;
    const iterToolCallsMap = new Map<number, ChatCompletionMessageFunctionToolCall>();

    for await (const chunk of rawStream) {
      if (!iterGenerationId) iterGenerationId = chunk.id;
      if (chunk.usage) iterUsage = chunk.usage;

      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        iterContent += delta.content;
        send({ type: "text_delta", text: delta.content });
      }

      for (const dtc of delta.tool_calls ?? []) {
        const idx = dtc.index;
        if (!iterToolCallsMap.has(idx)) {
          iterToolCallsMap.set(idx, {
            id: dtc.id ?? "",
            type: "function",
            function: { name: dtc.function?.name ?? "", arguments: "" },
          });
        }
        const tc = iterToolCallsMap.get(idx)!;
        if (dtc.function?.arguments) tc.function.arguments += dtc.function.arguments;
      }

      if (chunk.choices[0]?.finish_reason) {
        iterFinishReason = chunk.choices[0].finish_reason;
      }
    }

    assistantText = iterContent;

    const iterCachedTokens = iterUsage?.prompt_tokens_details?.cached_tokens;
    const iterReasoningTokens = iterUsage?.completion_tokens_details?.reasoning_tokens;
    await logLlmUsage(ctx, {
      generationId: iterGenerationId,
      model: process.env["CONVERSATION_MODEL"] ?? "default",
      inputTokens: iterUsage?.prompt_tokens ?? 0,
      outputTokens: iterUsage?.completion_tokens ?? 0,
      ...(iterCachedTokens !== undefined ? { cachedTokens: iterCachedTokens } : {}),
      ...(iterReasoningTokens !== undefined ? { reasoningTokens: iterReasoningTokens } : {}),
      latencyMs: Date.now() - iterStartTime,
    });

    if (iterFinishReason === null) break;

    const toolCalls = Array.from(iterToolCallsMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, tc]) => tc);

    const assistantMessage: ChatCompletionMessageParam = {
      role: "assistant",
      content: iterContent || null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    };
    messages.push(assistantMessage);

    if (iterFinishReason !== "tool_calls") break;

    // Execute all tool calls in parallel — each result is independent.
    // Promise.allSettled ensures a single failed call does not abort the batch.
    const settled = await Promise.allSettled(
      toolCalls.map(async (toolCall) => {
        const name = toolCall.function.name;
        let input: Record<string, unknown>;
        try {
          input = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
        } catch {
          input = {};
        }

        send({ type: "tool_start", tool: name, input });

        let result: unknown;
        try {
          result = await callMcpTool(mcpSession, name, input);
        } catch (err) {
          result = { error: err instanceof Error ? err.message : "tool_call_failed" };
        }

        const preview = JSON.stringify(result).slice(0, 300);
        send({ type: "tool_result", tool: name, preview });

        return {
          role: "tool" as const,
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        };
      })
    );

    const toolResults: ChatCompletionMessageParam[] = settled.map((s, i) => {
      if (s.status === "fulfilled") return s.value;
      return {
        role: "tool" as const,
        tool_call_id: toolCalls[i]!.id,
        content: JSON.stringify({
          error: s.reason instanceof Error ? s.reason.message : "tool_call_failed",
        }),
      };
    });

    messages.push(...toolResults);
  }

  return {
    messages,
    assistantText,
    toolCallsJson: [],
  };
}
```

- [ ] **Step 2: Type-check**

Run: `bun run typecheck`
Expected: no errors in `loop.ts`

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/agent/loop.ts
git commit -m "feat: remove local tools from agent loop and add parallel tool execution"
```

---

## Task 9: Rewrite agent system prompt

**Files:**
- Modify: `frontend/lib/agent/prompt.ts`

- [ ] **Step 1: Replace prompt.ts**

```ts
export const AGENT_SYSTEM_PROMPT = `You are an assistant for OpenOrmus, a platform for collecting and managing fictional characters.

Use the tools available to you to help the user research, add, find, update, and delete characters.

## Rules

- Never invent or guess character IDs. Resolve them first with character_find or character_list.
- When a tool returns an error, explain it to the user in plain language.
- Keep responses concise. When listing characters, summarise — do not dump raw JSON.`;
```

- [ ] **Step 2: Commit**

```bash
git add frontend/lib/agent/prompt.ts
git commit -m "feat: replace hardcoded agent prompt with minimal generic system prompt"
```

---

## Task 10: Final Verification

- [ ] **Step 1: Generate Prisma client (always required after schema changes)**

Run: `bun run prisma:generate`
Expected: client generated without errors

- [ ] **Step 2: Type-check everything**

Run: `bun run typecheck`
Expected: zero type errors across all workspaces

- [ ] **Step 3: Build frontend**

Run: `bun run build`
Expected: build succeeds

- [ ] **Step 4: Run all tests**

Run: `bun test --cwd mcp_server && bun test --cwd packages/shared`
Expected: all tests pass

- [ ] **Step 5: Verify no old tool IDs remain**

Run: `grep -r "mcp__openormus__character_save\|mcp__openormus__character_db_search\|mcp__openormus__character_search\|mcp__openormus__show_search\|mcp__openormus__scene_simulate\|research_show_online\|research_character_basics\|research_character_details\|start_character_wizard" --include="*.ts" . | grep -v node_modules | grep -v ".git"`
Expected: no output (all old identifiers gone)
