# Prune `confidence` from Character Schema

**Date:** 2026-06-01
**Branch:** worktree-prune-character-attributes

---

## Context

`confidence` (0–3 integer) was added to `CharacterSearchResult` and `CharacterBasics` to indicate
research quality during the Exa search flow. A planned feature that would surface this score to
users was discarded. The field remains in schemas, UI components, agent tools, and the DB — dead
weight with no live feature consuming it.

`firstAppearanceDate` and `imageUrl` are kept: the former serves dataset contamination detection;
the latter is reserved for future UI development.

---

## "Not Found" Signal After Removal

`characterBasicsHandler` in `character_search.service.ts` already converts `confidence === 0` →
`{ error: "character_not_found" }` before returning to callers. The agent prompt instructions that
reference `confidence === 0` are therefore already vestigial — the agent receives an error object,
not a basics result with confidence 0.

After removal the service will use an empty `name` string as the not-found signal:

- Exa system prompt updated: "if character not identifiable, return name as empty string"
- Handler guard: `if (!validation.data.name)` replaces `if (validation.data.confidence === 0)`
- Semantic and runtime behaviour: unchanged

---

## Approach: Clean Atomic (A)

Remove `confidence` from all code and ship a DB migration that strips the key from existing
`character.sheet` JSONB records in the same PR.

---

## Change Surface

### 1. Shared schemas (`packages/shared/`)

| File | Change |
|------|--------|
| `schema/character_search.ts` | Drop `confidence` from `CharacterBasicsSchema` and `CharacterSearchResultShape` |
| `schema/character_saved.ts` | Drop `confidence` from `CharacterSaveInputShape` |
| `services/character_search.service.ts` | Drop `confidence` from `BASICS_OUTPUT_SCHEMA` (properties + required); rewrite `BASICS_SYSTEM_PROMPT` not-found instruction; replace `confidence === 0` guard with `!name` guard |

### 2. Agent tools & prompt (`frontend/lib/agent/`)

| File | Change |
|------|--------|
| `tools/exa_research.ts` | Drop `confidence` from `CharacterDetailsResearchInputSchema`, its JSON `input_schema`, and `handleCharacterDetailsResearch` return value; update tool descriptions |
| `prompt.ts` | Replace both `confidence === 0` references with error-based not-found language |
| `tools/wizard.ts` | Drop "Set confidence to 1 (manually created)" instruction |
| `mcp_bridge.ts` | Drop `confidence` from save-tool properties and `required` array |

### 3. UI components (`frontend/`)

| File | Change |
|------|--------|
| `components/characters/CharacterCard.tsx` | Remove `CONFIDENCE_COLOR`, `CONFIDENCE_LABEL` constants and badge JSX |
| `components/characters/CharacterFormWizard.tsx` | Drop `confidence` from form state type, all initialisations, and select input JSX |
| `app/preview/_components/sheet-field.tsx` | Remove `% confidence` rendering |

### 4. Evaluation runner (`evaluation/`)

| File | Change |
|------|--------|
| `runner/conversation.ts` | Drop `confidence: 3` from hardcoded character fixture |

### 5. DB migration

New Prisma migration:

```sql
UPDATE characters SET sheet = sheet - 'confidence' WHERE sheet ? 'confidence';
```

Idempotent. Strips the `confidence` key from every existing `character.sheet` JSONB record.
No data loss — only the pruned key is removed.

### 6. Test fixtures

Drop `confidence` from fixture objects in:

- `mcp_server/src/registry/tools/character_db_search.test.ts`
- `mcp_server/src/registry/tools/character_list.test.ts`
- `mcp_server/src/registry/tools/character_save.test.ts`
- `mcp_server/src/registry/tools/character_update.test.ts`
- `packages/shared/schema/character_saved.test.ts`
- `packages/shared/services/character_search.service.test.ts`
- `frontend/lib/prompts/__tests__/index.test.ts`

---

## Verification

After implementation:

1. `bun run typecheck` — no errors
2. `bun test --cwd mcp_server` — 29+ pass, 0 new failures
3. `grep -r "confidence" --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v generated` — zero hits
4. Manual: open CharacterCard in UI — no confidence badge rendered
5. Manual: save a character via agent — no `confidence` key in stored `sheet` JSONB
