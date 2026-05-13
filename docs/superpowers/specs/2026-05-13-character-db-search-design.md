# Character DB Search — Design Spec

**Date:** 2026-05-13
**Branch:** feature/character-db-search
**Status:** Approved

---

## Problem

Users can save characters to the database but have no way to search their own saved characters by
name or description. The existing `mcp__openormus__character_search` tool searches the web (via
Exa) for fictional characters — it does not query the user's saved collection.

---

## Goal

Add a new MCP tool `mcp__openormus__character_db_search` that searches the calling user's saved
characters in the database using fuzzy string similarity on both `name` and `shortDescription`.

---

## Approach: pg_trgm Fuzzy Similarity

PostgreSQL's `pg_trgm` extension is pre-bundled in Supabase and enabled via a standard migration.
It breaks strings into 3-character chunks (trigrams) and scores overlap. This gives typo tolerance
and partial-match capability with no new runtime dependencies, no changes to existing tools, and
no embedding model calls.

**Why not full-text search (`tsvector`):** pg_trgm handles typos and partial names better (e.g.
"spiderman" → "Spider-Man"). FTS requires exact lexeme overlap. For name lookups, trigram
similarity is more user-friendly.

**Why not pgvector semantic embeddings:** 4x more complexity — requires touching `character_save`
and `character_update`, an embedding model call on every write, a backfill migration, and a new
schema column. Out of scope for this feature.

---

## Components

### 1. Migration

File: `prisma/migrations/<timestamp>_character_db_search/migration.sql`

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_characters_name_trgm
  ON characters USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_characters_description_trgm
  ON characters USING GIN ((sheet->>'shortDescription') gin_trgm_ops);
```

- Indexes are non-blocking on create (new table, no lock contention in dev).
- The JSONB expression index `(sheet->>'shortDescription')` is valid PostgreSQL and fully
  supported by Supabase.

### 2. Shared Schema

File: `packages/shared/schema/character_saved.ts` — add alongside existing exports.

```typescript
export const CharacterDbSearchInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(10),
});
export type CharacterDbSearchInput = z.infer<typeof CharacterDbSearchInputSchema>;
```

Return type: `SavedCharacterRecord[]` — same shape as `character_list`, no new type needed.

### 3. Tool

File: `mcp_server/src/registry/tools/character_db_search.ts`

**Tool ID:** `mcp__openormus__character_db_search`

**Description:** Search saved characters by name or description using fuzzy similarity.

**Input:** `{ query: string, limit?: number }`

**Handler logic:**
1. Get `userId` from `userIdStorage.getStore()` (same pattern as all other tools).
2. Run `prisma.$queryRaw` with the similarity query below.
3. Map raw rows to `SavedCharacterRecord[]`.
4. Return `{ content: [{ type: "text", text: JSON.stringify(results) }] }`.

**SQL query:**

```sql
SELECT
  id,
  user_id AS "userId",
  name,
  sheet,
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  GREATEST(
    similarity(name, ${query}),
    similarity(sheet->>'shortDescription', ${query})
  ) AS score
FROM characters
WHERE user_id = ${userId}::uuid
  AND (
    similarity(name, ${query}) > 0.15
    OR similarity(sheet->>'shortDescription', ${query}) > 0.15
  )
ORDER BY score DESC
LIMIT ${limit}
```

Similarity threshold: **0.15** — permissive enough to catch partial matches and typos without
returning unrelated results. Score is used only for ordering; it is not exposed in the output.

**Error handling:** If the query returns zero rows, return an empty array `[]`. No special error
object needed — empty array signals "no match".

### 4. Registry

File: `mcp_server/src/registry/registry.ts`

Add `import { register as registerCharacterDbSearch } from "./tools/character_db_search"` and
call `registerCharacterDbSearch(server)` alongside the other registrations.

---

## Data Flow

```
MCP client
  → POST /mcp  { tool: "mcp__openormus__character_db_search", args: { query, limit } }
  → JWT middleware  (validates token, sets userId in AsyncLocalStorage)
  → tool handler
  → prisma.$queryRaw  (pg_trgm similarity, scoped by userId)
  → SavedCharacterRecord[]
  → { content: [{ type: "text", text: JSON.stringify([...]) }] }
```

---

## What Is Not Changed

- `character_save`, `character_update`, `character_delete`, `character_list` — untouched.
- `character_search` (Exa web search) — untouched. Name collision risk: the new tool ID uses
  `_db_search` suffix to disambiguate from the Exa tool.
- No new npm/bun packages required.
- No changes to the frontend.

---

## Constraints & Decisions

| Decision | Rationale |
|---|---|
| Threshold 0.15 | Permissive; "spiderman" vs "Spider-Man" scores ~0.45, well above threshold |
| Search both `name` and `shortDescription` | User request explicitly named both fields |
| `limit` max 50 | Prevents large payloads; MCP response is in-memory JSON |
| Score not in output | Callers don't need it; keeping `SavedCharacterRecord` shape consistent with `character_list` |
| `$queryRaw` not Prisma ORM | pg_trgm `similarity()` function not expressible in Prisma query builder |

---

## Files Touched

| File | Change |
|---|---|
| `prisma/migrations/<ts>_character_db_search/migration.sql` | New — pg_trgm extension + indexes |
| `packages/shared/schema/character_saved.ts` | Add `CharacterDbSearchInputSchema` |
| `mcp_server/src/registry/tools/character_db_search.ts` | New tool file |
| `mcp_server/src/registry/registry.ts` | Register new tool |

Total: 4 files, 2 new.
