# Character Archive Design

**Date:** 2026-05-21
**Status:** Approved
**Scope:** Replace character deletion with permanent soft-archive across API, MCP, and service layers.

---

## Problem

`Message.characterId` has `onDelete: Restrict` in the Prisma schema. Deleting a character that has sent messages throws a FK violation, returning a 500 to the client with no meaningful error. The correct behaviour is to make the character permanently invisible without removing the row — preserving message history and FK integrity.

---

## Decision

Characters are **never deleted**. The `DELETE /api/characters/[id]` endpoint and `mcp__openormus__character_delete` tool now archive the character instead. Archiving is **permanent and irreversible**.

An archived character is:
- Invisible to all list, get, search, and update operations
- Read-only (update attempts return an error)
- Still referenced by `Message` and `ConversationParticipant` rows (FK intact)

---

## Approach: `archivedAt` nullable timestamp

Add a single nullable column to the `characters` table. `NULL` = active. Non-null = archived (value is the archive timestamp).

**Why not a status enum:** Loses the audit timestamp with no upside.
**Why not a separate table:** Requires FK surgery on `Message` and `ConversationParticipant`, high complexity, no benefit given the access layer is already centralised.

---

## Schema Change

```prisma
model Character {
  id         String    @id @default(uuid()) @db.Uuid
  userId     String    @db.Uuid @map("user_id")
  name       String
  sheet      Json
  createdAt  DateTime  @default(now()) @map("created_at")
  updatedAt  DateTime  @updatedAt @map("updated_at")
  archivedAt DateTime? @map("archived_at")          // NEW

  user                     User                     @relation(fields: [userId], references: [id], onDelete: Cascade)
  conversationParticipants ConversationParticipant[]
  messages                 Message[]

  @@map("characters")
}
```

Migration: `ALTER TABLE characters ADD COLUMN archived_at TIMESTAMPTZ`. No data moved, no FK touched.

---

## Shared Types (`packages/shared/`)

### `packages/shared/services/character.service.ts`

**`CharacterRow` interface** — add `archivedAt: Date | null`.

**`listCharacters`** — add `archivedAt: null` to the `where` clause.

**`updateCharacter`** — pre-fetch character; if `archivedAt` is non-null, return `{ error: "archived" }` without touching the DB.

**`deleteCharacter` → replaced by `archiveCharacter`:**

```ts
export async function archiveCharacter(
  prisma: PrismaLike,
  userId: string,
  id: string
): Promise<{ success: true } | { error: "not_found" } | { error: "already_archived" }>
```

Sets `archivedAt = new Date()` via `updateMany({ where: { id, userId, archivedAt: null } })`.
- `count === 0` after update: check if row exists at all to distinguish `not_found` vs `already_archived`.

**`PrismaLike` interface** — no new methods needed (`updateMany` already present).

### `packages/shared/schema/character_saved.ts`

**`SavedCharacterRecordSchema`** — add:
```ts
archivedAt: z.string().datetime().nullable(),
```

**New schemas:**
```ts
export const CharacterArchiveInputSchema = z.object({ id: z.string().uuid() });
export type CharacterArchiveInput = z.infer<typeof CharacterArchiveInputSchema>;
```

(`CharacterDeleteInputSchema` is identical in shape but kept separate for semantic clarity.)

### `character_db_search` raw SQL

Add `AND archived_at IS NULL` to the WHERE clause.

---

## API Layer (`frontend/app/api/characters/`)

| Route | Change |
|-------|--------|
| `GET /api/characters` | None — `listCharacters` filters automatically |
| `POST /api/characters` | None |
| `PUT /api/characters/[id]` | Map `{ error: "archived" }` → `409 { error: "character_archived" }` |
| `DELETE /api/characters/[id]` | Validates with `CharacterArchiveInputSchema`; calls `archiveCharacter`; maps `not_found` → 404, `already_archived` → 409, `success` → 200 |

The `DELETE` verb is reused unchanged — callers see the character disappear, which is the correct external contract.

---

## MCP Layer (`mcp_server/src/registry/tools/`)

| Tool | Change |
|------|--------|
| `character_list` | None — service filters automatically |
| `character_db_search` | SQL gains `AND archived_at IS NULL` |
| `character_update` | Returns MCP error text if service returns `{ error: "archived" }` |
| `character_delete` | Handler calls `archiveCharacter`; tool ID and name unchanged |
| `character_save` | None |
| `character_search` | None (external Exa search, not DB) |

No new MCP tools. No `allowedTools` string updates needed.

---

## Error Catalogue

| Layer | Condition | Response |
|-------|-----------|----------|
| API `DELETE` | Character not found | `404 { error: "not_found" }` |
| API `DELETE` | Already archived | `409 { error: "already_archived" }` |
| API `PUT` | Character archived | `409 { error: "character_archived" }` |
| MCP `character_delete` | Not found | Text: `"Character not found."` |
| MCP `character_delete` | Already archived | Text: `"Character already archived."` |
| MCP `character_update` | Archived | Text: `"Character is archived and cannot be modified."` |

---

## Out of Scope

- Unarchive / restore operation (permanent by design)
- Admin visibility of archived characters
- Frontend UI changes (character disappears client-side when `DELETE` returns 200, existing behaviour)
