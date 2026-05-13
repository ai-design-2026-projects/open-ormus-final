# Character Import via Exa Search — Design Spec

**Date:** 2026-05-13  
**Branch:** feature/character-import-exa  
**Status:** Approved

---

## Overview

Add an "Import from Exa" mode inside `CharacterFormWizard` that lets users search for fictional characters via Exa and pre-populate the wizard fields for review before saving. Supports two search paths: by collection (TV series / film / book) or by direct character name. Move all Exa business logic into `packages/shared` so both the MCP server and frontend API routes consume the same code.

---

## 1. Shared Layer

### New files

```
packages/shared/services/
  exa.ts                      — Exa singleton, lazy-init (throws at call time if EXA_API_KEY missing)
  show_search.service.ts      — showSearchHandler(args: ShowSearchInput): Promise<ShowSearchResult | { error }>
  character_search.service.ts — characterSearchHandler(args: CharacterSearchInput): Promise<CharacterSearchResult | { error }>
```

### Dependency change

`exa-js` moves from `mcp_server/package.json` → `packages/shared/package.json`.

### Exports

`packages/shared/index.ts` exports `showSearchHandler` and `characterSearchHandler`.

### MCP tool changes

`mcp_server/src/registry/tools/show_search.ts` and `character_search.ts`:
- Delete local handler implementations and `exa` import
- Import `showSearchHandler` / `characterSearchHandler` from `@open-ormus/shared`
- `register()` functions unchanged — still wrap results in MCP protocol response

---

## 2. Frontend API Routes

Two new Next.js route handlers under `frontend/app/api/exa/`:

```
POST /api/exa/show-search
  Body:    { query: string }   (validated with ShowSearchInputSchema)
  Returns: ShowSearchResult | { error: "search_failed" | "parse_failed" }

POST /api/exa/character-search
  Body:    { query: string }   (validated with CharacterSearchInputSchema)
  Returns: CharacterSearchResult | { error: "character_not_found" | "parse_failed" | "search_failed" }
```

Both routes:
- Auth-gate with `supabase.auth.getUser()` — return 401 if no user
- Validate body with Zod schema — return 400 on invalid input
- Call shared handler directly (no JWT/MCP round-trip)
- Return 500 mapped to `{ error: "search_failed" }` on unexpected throw
- `EXA_API_KEY` read server-side from env

---

## 3. CharacterFormWizard Changes

### Step renumbering

Current steps 0–2 (Basics, Personality, Connections) shift to steps 1–3.  
New step 0 is the `ImportStep` sub-component, shown only in `mode="create"`.  
`mode="edit"` skips step 0, unchanged.

### New sub-component: `ImportStep`

File: `frontend/components/characters/ImportStep.tsx`

Two tabs: **By Collection** | **By Character**

#### By Collection flow

1. Text input + "Search" button → `POST /api/exa/show-search`
2. Loading spinner while fetching
3. Up to 3 show result cards displayed (title, year, genre, short description)
4. User clicks one card → card expands to reveal character checklist (names from `ShowResult.characters[]`)
5. User checks 1–N character names
6. "Import Selected" button → parallel `POST /api/exa/character-search` for each checked name  
   Query format: `"<CharacterName>, <ShowTitle>"`
7. Per-character loading indicator while fetching
8. Failed characters (any error variant) shown as inline error cards: "Failed to fetch [Name] — Skip or Retry"
9. Successfully fetched characters enter `pendingQueue`
10. Summary shown: "X of Y fetched successfully" — user can proceed or retry failures
11. Wizard advances to step 1 pre-filled with `pendingQueue[0]`

#### By Character flow

1. Text input + "Search" button → `POST /api/exa/character-search`
2. Loading spinner while fetching
3. On success: wizard advances to step 1 pre-filled with result
4. On error: inline error message below input

### Queue state in `CharacterFormWizard`

```ts
pendingQueue: CharacterSearchResult[]  // characters remaining to review
currentQueueIndex: number              // for progress display
```

When `pendingQueue.length > 0` and user is on step 3 (Connections), wizard footer shows:
- **"Save & Next"** — saves current character via `onSubmit`, loads next from queue into form (resets to step 1)
- **"Skip"** — discards current, loads next from queue (resets to step 1)
- Progress indicator: "Character 2 of 5"

When queue is empty: normal "Save" + `onClose` behavior (unchanged).

---

## 4. Error Handling

### Show search errors

| Error | UI |
|---|---|
| `search_failed` | Inline error below search input: "Search failed, try again" |
| `parse_failed` | Same as above |
| Empty `results[]` | "No collections found" |

### Character fetch errors (per character)

| Error | UI |
|---|---|
| `search_failed` / `parse_failed` | Inline error card in checklist: "Failed to fetch [Name] — Skip or Retry" |
| `character_not_found` | Same card: "Character not found" |

Failed characters are excluded from `pendingQueue`. User sees count of successes before proceeding.

### API / network errors

- 401 → redirect to `/login`
- 500 / network throw → treated as `search_failed`
- 400 (invalid input) → treated as `search_failed` (shouldn't occur with typed inputs)

---

## 5. File Changeset Summary

### New files
- `packages/shared/services/exa.ts`
- `packages/shared/services/show_search.service.ts`
- `packages/shared/services/character_search.service.ts`
- `frontend/app/api/exa/show-search/route.ts`
- `frontend/app/api/exa/character-search/route.ts`
- `frontend/components/characters/ImportStep.tsx`

### Modified files
- `packages/shared/package.json` — add `exa-js`
- `packages/shared/index.ts` — export new service functions
- `mcp_server/package.json` — remove `exa-js`
- `mcp_server/src/registry/tools/show_search.ts` — import handler from shared
- `mcp_server/src/registry/tools/character_search.ts` — import handler from shared
- `mcp_server/src/exa.ts` — delete (or keep as re-export shim if needed for build)
- `frontend/components/characters/CharacterFormWizard.tsx` — add step 0, queue state, footer logic

### Unchanged
- All other MCP tools
- `CharacterList`, `CharacterCard`, `CharacterViewDrawer`, `CharacterSearch`
- Auth flow, Prisma schema, scene simulation

---

## 6. Out of Scope

- Duplicate detection (importing a character already in the DB)
- Editing characters mid-queue (user can edit after import via existing edit flow)
- Retry logic for failed Exa calls beyond a manual "Retry" button
- Pagination of show results beyond top 3
