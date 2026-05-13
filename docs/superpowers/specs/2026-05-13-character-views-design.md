# Character Management Views — Design Spec

**Date:** 2026-05-13
**Branch:** `feature/character-views`
**Worktree:** `../open-ormus-character-views`

---

## 1. Goals

- Replace placeholder home page with character management dashboard
- Users can list, create (wizard), view (drawer), edit (wizard), and delete characters
- Extract character DB logic from MCP tool handlers into a shared service layer
- Frontend API routes use the shared service directly (no MCP hop for UI)

---

## 2. Architecture Overview

```
packages/shared/services/character.service.ts   ← NEW: shared Prisma logic
         ▲                          ▲
mcp_server tool handlers      frontend API routes (/api/characters)
(refactored to thin wrappers)  (new)
                                     ▲
                              frontend/app/page.tsx (Client Component)
                              + components/characters/*
```

Frontend communicates with its own API routes. MCP server is for the AI agent loop only — not called from UI.

---

## 3. Shared Service Layer

**File:** `packages/shared/services/character.service.ts`

Five pure functions, each accepting `prisma: PrismaClient` and `userId: string` as first two args. Callers supply their own Prisma singleton (MCP has `src/db.ts`, frontend has `lib/prisma.ts`).

| Function | Signature | Returns |
|---|---|---|
| `listCharacters` | `(prisma, userId)` | `SavedCharacterRecord[]` |
| `saveCharacter` | `(prisma, userId, data: CharacterSaveInput)` | `SavedCharacterRecord` |
| `updateCharacter` | `(prisma, userId, data: CharacterUpdateInput)` | `SavedCharacterRecord \| { error: "not_found" }` |
| `deleteCharacter` | `(prisma, userId, id: string)` | `{ success: true } \| { error: "not_found" }` |
| `searchCharacters` | `(prisma, userId, query: string, limit: number)` | `SavedCharacterRecord[]` |

Logic migrated verbatim from MCP handlers. No Zod validation inside service functions — validation is the caller's responsibility (already done at MCP tool boundary or API route boundary).

`packages/shared/index.ts` re-exports all service functions.

**Zod mismatch note:** Service functions use only Prisma and inferred TypeScript types — no runtime Zod calls. Existing v3/v4 mismatch between `mcp_server` and `packages/shared` does not affect this layer.

---

## 4. MCP Tool Refactor

Tools `character_list`, `character_save`, `character_update`, `character_delete`, `character_db_search` are refactored to thin wrappers:

```ts
// Before (inline Prisma)
export async function characterListHandler() {
  const userId = userIdStorage.getStore()!;
  const rows = await prisma.character.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  return rows.map(toSavedCharacterRecord);
}

// After (delegate to shared service)
import { listCharacters } from "@open-ormus/shared/services/character.service";
export async function characterListHandler() {
  const userId = userIdStorage.getStore()!;
  return listCharacters(prisma, userId);
}
```

Tools **not touched:** `character_search` (Exa API), `show_search` (Exa API), `scene_simulate` (stub). No shared DB logic to extract.

---

## 5. Frontend API Routes

**Base path:** `frontend/app/api/characters/`

| File | Method | Action | Notes |
|---|---|---|---|
| `route.ts` | `GET` | List / fuzzy search | `?q=<query>&limit=<n>` for search; no params = full list |
| `route.ts` | `POST` | Create character | Body: `CharacterSaveInput` |
| `[id]/route.ts` | `PUT` | Update character | Body: `CharacterUpdateInput` |
| `[id]/route.ts` | `DELETE` | Delete character | No body |

Each handler pattern:
1. `supabase.auth.getUser()` → 401 if unauthenticated
2. Zod-parse request body / query params (schemas from `packages/shared`)
3. Call shared service function with `prisma` + `userId`
4. Return `NextResponse.json(result)`

---

## 6. Frontend UI

### 6.1 Home Page (`frontend/app/page.tsx`)

Converted to Client Component (`"use client"`). Owns character list state, modal open/close state. Fetches `GET /api/characters` on mount.

**Layout:**
- Top bar: app name left, logout button right
- Search bar below top bar: debounced input, fires `GET /api/characters?q=<query>` after 300ms idle
- "New Character" button: top-right of content area
- Character grid: responsive card grid, empty state when no characters

### 6.2 Components (`frontend/components/characters/`)

| Component | Purpose |
|---|---|
| `CharacterCard` | Card showing name, shortDescription, imageUrl (avatar fallback), confidence badge (0–3). Action buttons: View, Edit, Delete |
| `CharacterList` | Renders grid of `CharacterCard`, handles loading skeleton + empty state |
| `CharacterSearch` | Debounced text input, calls parent callback with query string |
| `CharacterViewDrawer` | Read-only right-side drawer. Shows full personality detail in collapsible sections |
| `CharacterFormWizard` | Modal dialog with 3 steps — used for both create and edit |
| `DeleteConfirmDialog` | Simple confirm/cancel dialog before deletion |

### 6.3 CharacterFormWizard Steps

**Step 1 — Basics**
Fields: `name` (required), `shortDescription`, `imageUrl`, `firstAppearanceDate`, `confidence` (0–3 select)

**Step 2 — Personality**
Fields (each as tag-input or textarea):
`personalityTraits`, `backstory`, `speechPatterns`, `values`, `fears`, `goals`, `notableQuotes`, `abilities`, `copingStyle`

**Step 3 — Connections**
Fields (key-value pair editors):
`relationships` (`Record<string, string>`), `knowledgeScope` (`Record<string, string>`)

On submit (step 3): POST `/api/characters` (create) or PUT `/api/characters/[id]` (edit). Full sheet replacement — matches `CharacterUpdateInput` shape.

Edit mode: wizard pre-populated with existing character data.

### 6.4 State Management

No external state library. Page component holds:
```ts
characters: SavedCharacterRecord[]
searchQuery: string
activeModal: "create" | "edit" | "view" | "delete" | null
selectedCharacter: SavedCharacterRecord | null
```

After create/update/delete: refetch list from API or optimistically update local state.

---

## 7. File Changeset

### New files
```
packages/shared/services/character.service.ts
frontend/app/api/characters/route.ts
frontend/app/api/characters/[id]/route.ts
frontend/components/characters/CharacterCard.tsx
frontend/components/characters/CharacterList.tsx
frontend/components/characters/CharacterSearch.tsx
frontend/components/characters/CharacterViewDrawer.tsx
frontend/components/characters/CharacterFormWizard.tsx
frontend/components/characters/DeleteConfirmDialog.tsx
```

### Modified files
```
packages/shared/index.ts                          — re-export service functions
mcp_server/src/registry/tools/character_list.ts   — delegate to shared service
mcp_server/src/registry/tools/character_save.ts   — delegate to shared service
mcp_server/src/registry/tools/character_update.ts — delegate to shared service
mcp_server/src/registry/tools/character_delete.ts — delegate to shared service
mcp_server/src/registry/tools/character_db_search.ts — delegate to shared service
frontend/app/page.tsx                             — full rewrite as character dashboard
```

---

## 8. Out of Scope

- `/api/auth/tool-token` JWT endpoint (M3-04 milestone, not yet)
- Scene simulation UI
- Show search UI
- External character search integration in UI (MCP-only for now)
- Zod v3/v4 convergence (tracked in AGENTS.md §11, separate milestone)
- Pagination (list returns all characters; add if volume warrants)
