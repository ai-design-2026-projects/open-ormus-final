# Prune `confidence` from Character Schema — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `confidence` field from every layer of the stack — Zod schemas, service logic, agent tools, UI components, evaluation fixtures, and the DB — while preserving the "character not found" detection by switching to an empty `name` guard.

**Architecture:** Schema-first removal. Drop `confidence` from `CharacterBasicsSchema` and `CharacterSearchResultSchema` in `packages/shared`, update the Exa service to use `!name` as the not-found signal, then propagate the removal outward to agent tools, UI, and evaluation. Finish with a Prisma migration that strips the JSONB key from existing rows.

**Tech Stack:** TypeScript, Zod v4, Bun test runner, Prisma 7 (PostgreSQL JSONB), Next.js 16 App Router, Handlebars prompt templates.

---

## File Map

| File | Action |
|------|--------|
| `packages/shared/schema/character_search.ts` | Drop `confidence` from `CharacterBasicsSchema` and `CharacterSearchResultShape` |
| `packages/shared/schema/character_saved.ts` | Drop `confidence` from `CharacterSaveInputShape` |
| `packages/shared/services/character_search.service.ts` | Drop `confidence` from `BASICS_OUTPUT_SCHEMA`; rewrite system prompt; replace `confidence === 0` guard with `!name` |
| `packages/shared/schema/character_saved.test.ts` | Drop `confidence` from `validSheet` fixture; remove confidence-specific test cases |
| `packages/shared/services/character_search.service.test.ts` | Drop `confidence` from `flatCharacter`; update `mockNotFound`; remove confidence assertions |
| `frontend/lib/agent/tools/exa_research.ts` | Drop `confidence` from `CharacterDetailsResearchInputSchema`, JSON `input_schema`, tool descriptions, and `handleCharacterDetailsResearch` return |
| `frontend/lib/agent/prompt.ts` | Replace `confidence === 0` references with error-based language |
| `frontend/lib/agent/tools/wizard.ts` | Drop "Set confidence to 1" instruction from wizard return string |
| `frontend/lib/agent/mcp_bridge.ts` | Drop `confidence` from `mcp__openormus__character_save` properties and `required` |
| `frontend/components/characters/CharacterCard.tsx` | Remove `CONFIDENCE_LABEL`, `CONFIDENCE_COLOR`, and badge JSX |
| `frontend/components/characters/CharacterFormWizard.tsx` | Drop `confidence` from form state type, initialisations, and select JSX |
| `frontend/app/preview/_components/sheet-field.tsx` | Remove `% confidence` text from `SheetField` header |
| `frontend/lib/prompts/__tests__/index.test.ts` | Drop `confidence` from `mockSheet` fixture |
| `evaluation/runner/conversation.ts` | Drop `confidence: 3` from `buildParticipant` |
| `mcp_server/src/registry/tools/character_save.test.ts` | Drop `confidence` from `mockCharacterCreate` return, `validInput`, and assertions |
| `mcp_server/src/registry/tools/character_list.test.ts` | Drop `confidence` from `mockSheet` fixture |
| `mcp_server/src/registry/tools/character_update.test.ts` | Drop `confidence` from `validSheet` fixture |
| `mcp_server/src/registry/tools/character_db_search.test.ts` | Drop `confidence` from `mockSheet` fixture |
| `prisma/migrations/<timestamp>_remove_confidence_from_sheet/migration.sql` | Strip `confidence` key from existing JSONB rows |

---

## Task 1: Update shared schemas

**Files:**
- Modify: `packages/shared/schema/character_search.ts`
- Modify: `packages/shared/schema/character_saved.ts`

- [ ] **Step 1: Update `CharacterBasicsSchema` — drop `confidence`**

In `packages/shared/schema/character_search.ts`, replace the `CharacterBasicsSchema` block:

```typescript
// Before
export const CharacterBasicsSchema = z.object({
  name: z.string(),
  imageUrl: z.string().nullable(),
  shortDescription: z.string(),
  firstAppearanceDate: z.string(),
  confidence: z.number().int().min(0).max(3) as z.ZodType<0 | 1 | 2 | 3>,
});
export type CharacterBasics = z.infer<typeof CharacterBasicsSchema>;
```

```typescript
// After
export const CharacterBasicsSchema = z.object({
  name: z.string(),
  imageUrl: z.string().nullable(),
  shortDescription: z.string(),
  firstAppearanceDate: z.string(),
});
export type CharacterBasics = z.infer<typeof CharacterBasicsSchema>;
```

- [ ] **Step 2: Update `CharacterSearchResultShape` — drop `confidence`**

In the same file, replace `CharacterSearchResultShape`:

```typescript
// Before
const CharacterSearchResultShape = {
  name: z.string(),
  imageUrl: z.string().nullable(),
  shortDescription: z.string(),
  firstAppearanceDate: z.string(),
  confidence: z.number().int().min(0).max(3) as z.ZodType<0 | 1 | 2 | 3>,
  personality: CharacterPersonalitySchema,
} as const;
```

```typescript
// After
const CharacterSearchResultShape = {
  name: z.string(),
  imageUrl: z.string().nullable(),
  shortDescription: z.string(),
  firstAppearanceDate: z.string(),
  personality: CharacterPersonalitySchema,
} as const;
```

- [ ] **Step 3: Update `CharacterSaveInputShape` — drop `confidence`**

In `packages/shared/schema/character_saved.ts`, replace `CharacterSaveInputShape`:

```typescript
// Before
export const CharacterSaveInputShape = {
  name: z.string().min(1),
  imageUrl: z.string().nullable(),
  shortDescription: z.string(),
  firstAppearanceDate: z.string(),
  confidence: z.number().int().min(0).max(3) as z.ZodType<0 | 1 | 2 | 3>,
  personality: CharacterPersonalitySchema,
} as const;
```

```typescript
// After
export const CharacterSaveInputShape = {
  name: z.string().min(1),
  imageUrl: z.string().nullable(),
  shortDescription: z.string(),
  firstAppearanceDate: z.string(),
  personality: CharacterPersonalitySchema,
} as const;
```

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck
```

Expected: errors in files that still reference `confidence` (service, agent tools, UI — those come later). No errors in `packages/shared/schema/` itself.

---

## Task 2: Update the Exa service

**Files:**
- Modify: `packages/shared/services/character_search.service.ts`

- [ ] **Step 1: Update `BASICS_OUTPUT_SCHEMA` — drop `confidence`**

Replace the `BASICS_OUTPUT_SCHEMA` constant:

```typescript
// Before
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
```

```typescript
// After
const BASICS_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Empty string if character not identifiable" },
    imageUrl: { type: ["string", "null"] },
    shortDescription: { type: "string", description: "1–2 sentences" },
    firstAppearanceDate: {
      type: "string",
      description: 'ISO 8601 date, e.g. "2017-05-02"; "0000-01-01" if unknown',
    },
  },
  required: ["name", "imageUrl", "shortDescription", "firstAppearanceDate"],
} as const;
```

- [ ] **Step 2: Update `BASICS_SYSTEM_PROMPT` — replace confidence scale with empty-name instruction**

```typescript
// Before
const BASICS_SYSTEM_PROMPT = `You are a fictional character analyst. Given a search query identifying a fictional character (e.g. "Berlin, Money Heist"), populate the basic identity fields.

Confidence scale:
- 3: complete data from multiple consistent sources
- 2: partial data or minor inconsistencies across sources
- 1: sparse data, heavy inference required
- 0: character not identifiable from the query

If confidence is 0, set all string fields to "" and imageUrl to null.`;
```

```typescript
// After
const BASICS_SYSTEM_PROMPT = `You are a fictional character analyst. Given a search query identifying a fictional character (e.g. "Berlin, Money Heist"), populate the basic identity fields.

If the character is not identifiable from the query, return name as an empty string and imageUrl as null.`;
```

- [ ] **Step 3: Update `characterBasicsHandler` — replace `confidence === 0` guard with `!name`**

In `characterBasicsHandler`, find and replace the not-found check:

```typescript
// Before
if (validation.data.confidence === 0) return { error: "character_not_found" };
return validation.data;
```

```typescript
// After
if (!validation.data.name) return { error: "character_not_found" };
return validation.data;
```

- [ ] **Step 4: Update `characterSearchHandler` — drop `confidence` from merged object**

In `characterSearchHandler`, replace the `merged` object:

```typescript
// Before
const merged = {
  name: basics.name,
  imageUrl: basics.imageUrl,
  shortDescription: basics.shortDescription,
  firstAppearanceDate: basics.firstAppearanceDate,
  confidence: basics.confidence,
  personality: details,
};
```

```typescript
// After
const merged = {
  name: basics.name,
  imageUrl: basics.imageUrl,
  shortDescription: basics.shortDescription,
  firstAppearanceDate: basics.firstAppearanceDate,
  personality: details,
};
```

- [ ] **Step 5: Run shared tests**

```bash
bun test --cwd packages/shared
```

Expected: failures in `character_search.service.test.ts` and `character_saved.test.ts` because the test fixtures still include `confidence`. Those are fixed in Task 3.

---

## Task 3: Update shared test fixtures

**Files:**
- Modify: `packages/shared/services/character_search.service.test.ts`
- Modify: `packages/shared/schema/character_saved.test.ts`

- [ ] **Step 1: Update `character_search.service.test.ts` — drop `confidence` from `flatCharacter`**

Remove `confidence: 3 as const,` from the `flatCharacter` object (line 15).

- [ ] **Step 2: Update `mockNotFound` — use empty name instead of `confidence: 0`**

Replace the `mockNotFound` mock:

```typescript
// Before
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
```

```typescript
// After
const mockNotFound = {
  answer: async () => ({
    answer: {
      ...flatCharacter,
      name: "",
      shortDescription: "",
    },
  }),
};
```

- [ ] **Step 3: Remove `confidence` assertions from `characterBasicsHandler` tests**

In the `characterBasicsHandler` describe block, remove the assertion `expect(result.confidence).toBe(3);` from the "returns basics on valid Exa response" test.

- [ ] **Step 4: Rename the `confidence === 0` test to reflect the new guard**

Find the test:
```typescript
test("returns character_not_found when confidence is 0", async () => {
```

Rename it:
```typescript
test("returns character_not_found when name is empty string", async () => {
```

- [ ] **Step 5: Remove `confidence` assertion from `characterSearchHandler` test**

In the `characterSearchHandler` describe block, in "returns full CharacterSearchResult on valid Exa response", remove:
```typescript
expect(result.confidence).toBe(3);
```

- [ ] **Step 6: Rename the not-found test in `characterSearchHandler`**

Find:
```typescript
test("returns character_not_found when confidence is 0", async () => {
```

Rename:
```typescript
test("returns character_not_found when name is empty string", async () => {
```

- [ ] **Step 7: Update `character_saved.test.ts` — drop `confidence` from `validSheet`**

Remove `confidence: 3 as const,` from the `validSheet` object (line 29).

- [ ] **Step 8: Remove confidence-specific test cases**

Delete the following test from the `CharacterSaveInputSchema` describe block (lines 47–51):
```typescript
test("rejects confidence out of range", () => {
  expect(() =>
    CharacterSaveInputSchema.parse({ ...validSheet, confidence: 4 })
  ).toThrow();
});
```

Also remove the `expect(result.confidence).toBe(3);` assertion from the "parses valid save input" test.

- [ ] **Step 9: Run shared tests**

```bash
bun test --cwd packages/shared
```

Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add packages/shared/schema/character_search.ts \
        packages/shared/schema/character_saved.ts \
        packages/shared/schema/character_saved.test.ts \
        packages/shared/services/character_search.service.ts \
        packages/shared/services/character_search.service.test.ts
git commit -m "refactor(shared): remove confidence field from character schemas and service"
```

---

## Task 4: Update agent tools

**Files:**
- Modify: `frontend/lib/agent/tools/exa_research.ts`
- Modify: `frontend/lib/agent/prompt.ts`
- Modify: `frontend/lib/agent/tools/wizard.ts`
- Modify: `frontend/lib/agent/mcp_bridge.ts`

- [ ] **Step 1: Update `CharacterDetailsResearchInputSchema` — drop `confidence`**

In `frontend/lib/agent/tools/exa_research.ts`, replace the schema:

```typescript
// Before
export const CharacterDetailsResearchInputSchema = z.object({
  query: z.string().min(1),
  name: z.string().min(1),
  imageUrl: z.string().nullable(),
  shortDescription: z.string(),
  firstAppearanceDate: z.string(),
  confidence: z.number().int().min(1).max(3) as z.ZodType<1 | 2 | 3>,
});
```

```typescript
// After
export const CharacterDetailsResearchInputSchema = z.object({
  query: z.string().min(1),
  name: z.string().min(1),
  imageUrl: z.string().nullable(),
  shortDescription: z.string(),
  firstAppearanceDate: z.string(),
});
```

- [ ] **Step 2: Update `researchCharacterBasicsTool` description**

Replace the description string:

```typescript
// Before
description:
  "Research the basic identity of a fictional character using Exa. " +
  "Returns name, shortDescription, firstAppearanceDate, imageUrl, and confidence (0–3). " +
  "Call this FIRST when researching any character. " +
  "If confidence is 0, the character was not found — stop and inform the user. " +
  "If confidence > 0, call research_character_details next with the returned name and shortDescription.",
```

```typescript
// After
description:
  "Research the basic identity of a fictional character using Exa. " +
  "Returns name, shortDescription, firstAppearanceDate, and imageUrl. " +
  "Call this FIRST when researching any character. " +
  "If the result has an error, the character was not found — stop and inform the user. " +
  "Otherwise call research_character_details with ALL fields from this result plus the original query.",
```

- [ ] **Step 3: Update `researchCharacterDetailsTool` — drop `confidence` from `input_schema` and `required`**

In the `input_schema.properties` object, remove:
```typescript
confidence: {
  type: "integer",
  minimum: 1,
  maximum: 3,
  description: "confidence from research_character_basics.",
},
```

In `required`, remove `"confidence"`:
```typescript
// Before
required: ["query", "name", "imageUrl", "shortDescription", "firstAppearanceDate", "confidence"],
```
```typescript
// After
required: ["query", "name", "imageUrl", "shortDescription", "firstAppearanceDate"],
```

- [ ] **Step 4: Update `handleCharacterDetailsResearch` return — drop `confidence`**

Replace the return statement:

```typescript
// Before
return {
  name: args.name,
  imageUrl: args.imageUrl,
  shortDescription: args.shortDescription,
  firstAppearanceDate: args.firstAppearanceDate,
  confidence: args.confidence,
  personality: result,
};
```

```typescript
// After
return {
  name: args.name,
  imageUrl: args.imageUrl,
  shortDescription: args.shortDescription,
  firstAppearanceDate: args.firstAppearanceDate,
  personality: result,
};
```

- [ ] **Step 5: Update `prompt.ts` — replace `confidence === 0` references**

In `frontend/lib/agent/prompt.ts`, replace the full `AGENT_SYSTEM_PROMPT` string (only the two `confidence` references need changing):

```typescript
// Before (line 10)
     b. If the result has \`confidence === 0\`, skip this character and move to the next.
```
```typescript
// After
     b. If the result has an error, skip this character and move to the next.
```

```typescript
// Before (line 16)
  2. If \`confidence === 0\`, tell the user the character was not found.
```
```typescript
// After
  2. If the result has an error, tell the user the character was not found.
```

- [ ] **Step 6: Update `wizard.ts` — drop "Set confidence to 1" instruction**

In `frontend/lib/agent/tools/wizard.ts`, replace the instructions string in `handleWizard`:

```typescript
// Before
"After collecting all answers, call mcp__openormus__character_save with the assembled sheet. " +
"Set confidence to 1 (manually created). Set firstAppearanceDate to '0000-01-01' if not known. " +
"Set imageUrl to null.",
```

```typescript
// After
"After collecting all answers, call mcp__openormus__character_save with the assembled sheet. " +
"Set firstAppearanceDate to '0000-01-01' if not known. " +
"Set imageUrl to null.",
```

- [ ] **Step 7: Update `mcp_bridge.ts` — drop `confidence` from `character_save` tool schema**

In `buildMcpTools()`, in the `mcp__openormus__character_save` entry:

Remove from `properties`:
```typescript
confidence: { type: "number", description: "Research confidence 0–3" },
```

Replace `required`:
```typescript
// Before
required: ["name", "imageUrl", "shortDescription", "firstAppearanceDate", "confidence", "personality"],
```
```typescript
// After
required: ["name", "imageUrl", "shortDescription", "firstAppearanceDate", "personality"],
```

- [ ] **Step 8: Typecheck**

```bash
bun run typecheck
```

Expected: errors only in UI components and evaluation (Tasks 5–6), none in agent layer.

---

## Task 5: Update UI components

**Files:**
- Modify: `frontend/components/characters/CharacterCard.tsx`
- Modify: `frontend/components/characters/CharacterFormWizard.tsx`
- Modify: `frontend/app/preview/_components/sheet-field.tsx`
- Modify: `frontend/lib/prompts/__tests__/index.test.ts`

- [ ] **Step 1: Update `CharacterCard.tsx` — remove confidence badge**

Replace the full file content. Remove `CONFIDENCE_LABEL`, `CONFIDENCE_COLOR`, and the badge `<span>`:

```typescript
"use client";
// frontend/components/characters/CharacterCard.tsx
import type { SavedCharacterRecord } from "@open-ormus/shared";

interface Props {
  character: SavedCharacterRecord;
  onView: (c: SavedCharacterRecord) => void;
  onEdit: (c: SavedCharacterRecord) => void;
  onDelete: (c: SavedCharacterRecord) => void;
}

export function CharacterCard({ character, onView, onEdit, onDelete }: Props) {
  const { sheet } = character;

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4 flex flex-col gap-3 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        {sheet.imageUrl ? (
          <img
            src={sheet.imageUrl}
            alt={character.name}
            className="w-12 h-12 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-zinc-200 flex items-center justify-center flex-shrink-0 text-zinc-500 font-semibold text-lg">
            {character.name[0]?.toUpperCase() ?? "?"}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-zinc-900 truncate">{character.name}</h3>
          <p className="text-sm text-zinc-500 mt-1 line-clamp-2">{sheet.shortDescription}</p>
        </div>
      </div>
      <div className="flex gap-2 pt-1 border-t border-zinc-100">
        <button
          type="button"
          onClick={() => onView(character)}
          className="flex-1 text-sm text-zinc-600 hover:text-zinc-900 py-1 rounded hover:bg-zinc-50 transition-colors"
        >
          View
        </button>
        <button
          type="button"
          onClick={() => onEdit(character)}
          className="flex-1 text-sm text-zinc-600 hover:text-zinc-900 py-1 rounded hover:bg-zinc-50 transition-colors"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => onDelete(character)}
          className="flex-1 text-sm text-red-500 hover:text-red-700 py-1 rounded hover:bg-red-50 transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `CharacterFormWizard.tsx` — drop `confidence` from form state**

This file is large. Make these targeted changes:

2a. Find and remove the `confidence` line from the form state type (search for `confidence: 0 | 1 | 2 | 3;`).

2b. Find and remove the `confidence: 3,` line from the default/initial state object.

2c. Find and remove `confidence: sheet.confidence,` (the "edit mode" initialisation).

2d. Find and remove `confidence: result.confidence,` (the "from research result" initialisation).

2e. Find and remove `confidence: state.confidence,` (the "build save input" mapping).

2f. Find and remove the confidence select field JSX. It will look like a `<select>` or `<input>` that calls `set("confidence", ...)`. Remove the entire field block including its label.

- [ ] **Step 3: Update `sheet-field.tsx` — remove `% confidence` text**

In `SheetField`, the header renders `{Math.round(pct * 100)}% confidence`. The `pct` prop itself is part of an unrelated component API (it controls the progress ring), so keep the ring but remove the text label. Replace:

```typescript
// Before — in the header div
<span className="font-mono text-[11px]" style={{ color: flagged ? "var(--signal-warn)" : "var(--ink-mute)" }}>
  {Math.round(pct * 100)}% confidence
</span>
```

```typescript
// After — remove the span entirely; keep the bar and ring
```

The full header block after the change:
```typescript
<header className="flex items-center justify-between px-4 py-3 border-b border-hair bg-surface-sunk gap-4">
  <h3 className="t-h6 m-0">{title}</h3>
  <div className="flex items-center gap-2 shrink-0">
    <div className="w-24 h-1 bg-surface-sunk rounded-full overflow-hidden">
      <div
        className="h-full rounded-full"
        style={{ width: `${pct * 100}%`, background: flagged ? "var(--signal-warn)" : "var(--accent-oo)" }}
      />
    </div>
    <Ring value={Math.round(pct * 100)} size={22} stroke={2} {...(flagged ? { color: "var(--signal-warn)" } : {})} />
  </div>
</header>
```

- [ ] **Step 4: Update `frontend/lib/prompts/__tests__/index.test.ts` — drop `confidence` from `mockSheet`**

Remove `confidence: 3,` from the `mockSheet` object (line 10).

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: only `evaluation/runner/conversation.ts` errors remain (Task 6).

---

## Task 6: Update evaluation runner

**Files:**
- Modify: `evaluation/runner/conversation.ts`

- [ ] **Step 1: Drop `confidence: 3` from `buildParticipant`**

In `evaluation/runner/conversation.ts`, in `buildParticipant`, replace the `sheet` object:

```typescript
// Before
sheet: {
  name: alias,
  imageUrl: null,
  shortDescription: char.archetype,
  firstAppearanceDate: "2025-01-01",
  confidence: 3,
  personality: {
```

```typescript
// After
sheet: {
  name: alias,
  imageUrl: null,
  shortDescription: char.archetype,
  firstAppearanceDate: "2025-01-01",
  personality: {
```

- [ ] **Step 2: Typecheck — full clean pass**

```bash
bun run typecheck
```

Expected: zero errors.

---

## Task 7: Update mcp_server test fixtures

**Files:**
- Modify: `mcp_server/src/registry/tools/character_save.test.ts`
- Modify: `mcp_server/src/registry/tools/character_list.test.ts`
- Modify: `mcp_server/src/registry/tools/character_update.test.ts`
- Modify: `mcp_server/src/registry/tools/character_db_search.test.ts`

- [ ] **Step 1: Update `character_save.test.ts`**

1a. Remove `confidence: 3,` from `mockCharacterCreate` return value's `sheet` object (line 12).

1b. Remove `confidence: 3 as 0 | 1 | 2 | 3,` from `validInput` (line 44).

1c. Remove `expect(result.sheet.confidence).toBe(3);` from the "creates character and returns SavedCharacterRecord" test (line 71).

- [ ] **Step 2: Update `character_list.test.ts`**

Remove `confidence: 3,` from `mockSheet` (line 8).

- [ ] **Step 3: Update `character_update.test.ts`**

Remove `confidence: 2 as const,` from `validSheet` (line 8).

- [ ] **Step 4: Update `character_db_search.test.ts`**

Remove `confidence: 3,` from `mockSheet` (line 9).

- [ ] **Step 5: Run mcp_server tests**

```bash
bun test --cwd mcp_server
```

Expected: 29 pass (same baseline), 1 pre-existing DB-env failure, 0 new failures.

- [ ] **Step 6: Commit all code changes**

```bash
git add \
  frontend/lib/agent/tools/exa_research.ts \
  frontend/lib/agent/prompt.ts \
  frontend/lib/agent/tools/wizard.ts \
  frontend/lib/agent/mcp_bridge.ts \
  frontend/components/characters/CharacterCard.tsx \
  frontend/components/characters/CharacterFormWizard.tsx \
  frontend/app/preview/_components/sheet-field.tsx \
  frontend/lib/prompts/__tests__/index.test.ts \
  evaluation/runner/conversation.ts \
  mcp_server/src/registry/tools/character_save.test.ts \
  mcp_server/src/registry/tools/character_list.test.ts \
  mcp_server/src/registry/tools/character_update.test.ts \
  mcp_server/src/registry/tools/character_db_search.test.ts
git commit -m "refactor: remove confidence field from agent tools, UI, and evaluation"
```

---

## Task 8: DB migration

**Files:**
- Create: `prisma/migrations/<timestamp>_remove_confidence_from_sheet/migration.sql`

- [ ] **Step 1: Create migration via Prisma**

Run from repo root (requires Node, not Bun, for Prisma CLI):

```bash
bun run prisma:migrate:dev --name remove_confidence_from_sheet
```

Prisma will open the migration SQL file for editing. The schema itself has not changed (no columns added/removed — `sheet` is still JSONB), so Prisma will generate an empty migration file. That is expected.

- [ ] **Step 2: Add the JSONB strip statement to the migration file**

Find the newly created migration directory in `prisma/migrations/` and open its `migration.sql`. Add:

```sql
-- Strip confidence key from existing character sheets
UPDATE "characters"
SET sheet = sheet - 'confidence'
WHERE sheet ? 'confidence';
```

- [ ] **Step 3: Verify the migration file looks correct**

```bash
cat prisma/migrations/$(ls -t prisma/migrations | head -1)/migration.sql
```

Expected output:
```sql
-- Strip confidence key from existing character sheets
UPDATE "characters"
SET sheet = sheet - 'confidence'
WHERE sheet ? 'confidence';
```

- [ ] **Step 4: Commit**

```bash
git add prisma/migrations/
git commit -m "chore(db): migration to strip confidence key from character.sheet JSONB"
```

---

## Task 9: Final verification

- [ ] **Step 1: Typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 2: Run all tests**

```bash
bun test --cwd mcp_server && bun test --cwd packages/shared
```

Expected: 29+ mcp_server pass, 0 new failures; all shared tests pass.

- [ ] **Step 3: Grep for any remaining `confidence` references in source**

```bash
grep -r "confidence" \
  --include="*.ts" --include="*.tsx" \
  . \
  | grep -v node_modules \
  | grep -v generated \
  | grep -v "prisma/migrations" \
  | grep -v "docs/"
```

Expected: zero hits.

- [ ] **Step 4: Build**

```bash
bun run build
```

Expected: clean build, no type errors.
