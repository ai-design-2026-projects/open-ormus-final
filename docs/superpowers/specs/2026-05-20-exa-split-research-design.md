# Exa Split Research — Design Spec
**Date:** 2026-05-20
**Branch:** worktree-feature-exa-split-research

---

## Problem

Two blocking issues with the current single-call Exa character research:

1. **11-field personality object exceeds Exa's 10-field output schema limit** — `CHARACTER_OUTPUT_SCHEMA` nests `personality` with 11 subfields (`personalityTraits`, `backstory`, `relationships`, `speechPatterns`, `values`, `fears`, `goals`, `notableQuotes`, `abilities`, `copingStyle`, `knowledgeScope`).
2. **Exa truncates output when schema has many fields** — even below the limit, dense schemas produce shortened values.

---

## Solution: Sequential-then-Parallel Split

### Execution Model

```
Step 1 — Basics (serial, 3 retries):
  characterBasicsHandler(query)
    → { name, imageUrl, shortDescription, firstAppearanceDate, confidence }

Step 2 — Enrich (parallel, 3 retries each):
  enrichedQuery = "${name}: ${shortDescription}, ${originalQuery}"

  Promise.all([
    personalityRequest(enrichedQuery),   // 9 fields
    connectionsRequest(enrichedQuery),   // 2 fields
  ])
    → merge → CharacterPersonality (all 11 fields)

Final merge → CharacterSearchResult
```

**Rationale for sequential-first:** Step 2 uses confirmed identity (`name` + `shortDescription`) as enriched context for Exa, improving accuracy of personality/connections results.

**Retry policy:** Each Exa call retries up to 3 times on failure. If all retries for any sub-request are exhausted, the entire character search fails (no partial results returned).

---

## Schema Changes

### `packages/shared/schema/character_search.ts`

Add exported types for the basics step:

```ts
// New — step 1 result type
export const CharacterBasicsSchema = z.object({
  name: z.string(),
  imageUrl: z.string().nullable(),
  shortDescription: z.string(),
  firstAppearanceDate: z.string(),
  confidence: z.number().int().min(0).max(3) as z.ZodType<0 | 1 | 2 | 3>,
});
export type CharacterBasics = z.infer<typeof CharacterBasicsSchema>;
```

`CharacterPersonalitySchema` (11 fields) and `CharacterSearchResultSchema` — **unchanged**. Exa sub-schemas for personality (9 fields) and connections (2 fields) are **internal** to the service file — not exported.

---

## Service Layer

### `packages/shared/services/character_search.service.ts`

Three exported functions (replacing the single monolithic handler):

#### `characterBasicsHandler(query, exaClient?)`
- Exa sub-schema: 5 fields (`name`, `imageUrl`, `shortDescription`, `firstAppearanceDate`, `confidence`)
- Returns `CharacterBasics | { error: "character_not_found" | "parse_failed" | "search_failed" }`
- Retry: `withRetry(fn, 3)`

#### `characterDetailsHandler({ query, name, shortDescription }, exaClient?)`
- Builds `enrichedQuery = "${name}: ${shortDescription}, ${query}"`
- Fires 2 Exa calls in parallel:
  - Personality sub-schema: 9 fields (`personalityTraits`, `backstory`, `speechPatterns`, `values`, `fears`, `goals`, `notableQuotes`, `abilities`, `copingStyle`)
  - Connections sub-schema: 2 fields (`relationships`, `knowledgeScope`)
- Merges into `CharacterPersonality` (all 11 fields)
- Returns `CharacterPersonality | { error: "parse_failed" | "search_failed" }`
- Each sub-request: `withRetry(fn, 3)`

#### `characterSearchHandler(query, exaClient?)` ← **unchanged public signature**
- Chains `characterBasicsHandler` → `characterDetailsHandler`
- Returns `CharacterSearchResult | { error: ... }` — same as before
- Used by: API route `/api/exa/character-search`, backward-compat callers

#### Internal `withRetry<T>(fn, attempts = 3)`
- Not exported. Retries `fn` up to `attempts` times on throw.
- No exponential backoff (simple retry).

Internal Exa output schemas (`BASICS_OUTPUT_SCHEMA`, `PERSONALITY_OUTPUT_SCHEMA`, `CONNECTIONS_OUTPUT_SCHEMA`) defined as `const` objects within the service file — not exported.

---

## Agent Tools

### `frontend/lib/agent/tools/exa_research.ts`

Replace single `exaResearchTool` / `handleExaResearch` with two tools:

#### Tool 1: `research_character_basics`
```
Input:  { query: string }
Output: CharacterBasics (name, imageUrl, shortDescription, firstAppearanceDate, confidence)
```
Agent uses this to confirm character identity before committing to enrichment.

#### Tool 2: `research_character_details`
```
Input:  { query: string, name: string, shortDescription: string }
Output: CharacterPersonality (all 11 fields)
```
Agent calls this after basics, passing the confirmed `name` + `shortDescription` as context.

**Agent instruction sequence** (update agent system prompt / tool descriptions):
1. Call `research_character_basics` with user query
2. If `confidence === 0` → report not found, stop
3. Call `research_character_details` with `{ query, name, shortDescription }` from step 1
4. Call `mcp__openormus__character_save` with merged data

`research_show_online` / `handleShowResearch` — **unchanged**.

### `frontend/lib/agent/loop.ts`

Update tool dispatch: replace `research_character_online` branch with `research_character_basics` and `research_character_details` branches.

### Agent prompt (`frontend/lib/agent/prompt.ts` or `frontend/lib/prompts/index.ts`)

Update tool usage instructions to reflect 2-step character research sequence.

---

## API Routes & UI

### `frontend/app/api/exa/character-search/route.ts`

**No change.** Calls `characterSearchHandler` (wrapper) — still returns `CharacterSearchResult`. Split is fully internal.

### `frontend/components/characters/ImportStep.tsx`

**No change.** Still calls `/api/exa/character-search` per character name.

---

## Exports

### `packages/shared/index.ts`

Add exports:
```ts
export { CharacterBasicsSchema } from "./schema/character_search";
export type { CharacterBasics } from "./schema/character_search";
export { characterBasicsHandler, characterDetailsHandler } from "./services/character_search.service";
```

---

## Tests

### `packages/shared/services/character_search.service.test.ts`

Add test cases for:
- `characterBasicsHandler` — valid response, `search_failed`, `parse_failed`, `character_not_found` (confidence 0)
- `characterDetailsHandler` — valid merged response, failure on personality sub-request, failure on connections sub-request
- `withRetry` behavior — succeeds on 2nd attempt, fails after 3 attempts
- `characterSearchHandler` wrapper — still passes existing tests

---

## Files Changed

| File | Change |
|---|---|
| `packages/shared/schema/character_search.ts` | Add `CharacterBasicsSchema`, `CharacterBasics` type |
| `packages/shared/services/character_search.service.ts` | Refactor into 3 handlers + internal `withRetry` + 3 internal Exa sub-schemas |
| `packages/shared/index.ts` | Export `CharacterBasicsSchema`, `CharacterBasics`, `characterBasicsHandler`, `characterDetailsHandler` |
| `frontend/lib/agent/tools/exa_research.ts` | Replace `exaResearchTool`/`handleExaResearch` with 2 tools/handlers |
| `frontend/lib/agent/loop.ts` | Update tool dispatch for new tool names |
| `frontend/lib/agent/prompt.ts` or `frontend/lib/prompts/index.ts` | Update agent instructions for 2-step character research |
| `packages/shared/services/character_search.service.test.ts` | Add tests for split handlers + retry behavior |

---

## Out of Scope

- `show_search.service.ts` — collection search already works as 2 separate functions; no changes
- `ImportStep.tsx` — UI unchanged; split is transparent to callers of `/api/exa/character-search`
- Retry backoff strategy — simple immediate retry, no exponential backoff
