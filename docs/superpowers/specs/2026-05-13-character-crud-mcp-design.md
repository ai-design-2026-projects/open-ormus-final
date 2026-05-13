# Design: Character CRUD MCP Tools (Supabase-backed)

**Date:** 2026-05-13  
**Status:** Approved

---

## Overview

Replace in-memory `character_create` / `character_get` tools with four DB-backed CRUD tools persisting characters to Supabase PostgreSQL via Prisma. Characters use the rich `CharacterSearchResult` structure from Exa. Each character is owned by a user; all queries are scoped by `userId`.

---

## 1. Prisma Schema Changes

Add a second generator block and `Character` model to `prisma/schema.prisma`.

```prisma
generator client_mcp {
  provider = "prisma-client"
  output   = "../mcp_server/src/generated/prisma"
}

model Character {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @db.Uuid @map("user_id")
  name      String
  sheet     Json
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("characters")
}
```

`User` model gains `characters Character[]` relation.

`sheet` is JSONB holding a full `CharacterSearchResult` object (name, imageUrl, shortDescription, firstAppearanceDate, confidence, personality). Stored as opaque JSON — not normalised into relational columns (per AGENTS.md §6 Prisma).

---

## 2. Shared Schemas (`packages/shared/schema/`)

### Deleted
- `character.ts` — `CharacterCreateInput`, `CharacterRecord` (in-memory era, no longer needed)

### New: `character_saved.ts`

| Export | Purpose |
|---|---|
| `CharacterSaveInputShape` | Tool input for save — mirrors `CharacterSearchResult` fields |
| `CharacterSaveInputSchema` | Zod schema object |
| `CharacterUpdateInputShape` | `{ id: uuid, sheet: CharacterSearchResult }` — full sheet replacement |
| `CharacterUpdateInputSchema` | Zod schema object |
| `CharacterDeleteInputShape` | `{ id: uuid }` |
| `CharacterDeleteInputSchema` | Zod schema object |
| `SavedCharacterRecordSchema` | Full DB record returned to callers: `{ id, userId, name, sheet, createdAt, updatedAt }` |
| `SavedCharacterRecord` | Inferred type |

`packages/shared/index.ts` — remove old character exports, add new `character_saved` exports.

---

## 3. `userId` Threading via `AsyncLocalStorage`

MCP tool handlers receive only `args` — no HTTP request context. Auth middleware already validates the JWT per-request and sets `req.userId`. To make `userId` available inside handlers without passing it through `createRegistry`:

```
Request → auth middleware (validates JWT, sets req.userId)
        → transport
        → userIdStorage.run(req.userId, () => transport.handleRequest(...))
        → tool handler calls userIdStorage.getStore() to get userId
```

**Why `AsyncLocalStorage` over session-closure:**
- Closure bakes userId at session-init; revoked JWTs still succeed for that session.
- `AsyncLocalStorage` threads userId from the JWT validated on **each individual HTTP request**. Revocation takes effect immediately.

New file: `mcp_server/src/auth/context.ts`

```typescript
import { AsyncLocalStorage } from "node:async_hooks";
export const userIdStorage = new AsyncLocalStorage<string>();
```

Both transports (`streamable-http.ts`, `sse.ts`) wrap `transport.handleRequest` in `userIdStorage.run(req.userId, ...)`.

`createRegistry()` signature is **unchanged**.

---

## 4. MCP Tool Changes

### Removed
- `mcp__openormus__character_create` (in-memory, simple schema)
- `mcp__openormus__character_get` (in-memory)
- `mcp_server/src/registry/store.ts` (in-memory Map + fixtures)

### Added

| Tool ID | Input | DB Operation |
|---|---|---|
| `mcp__openormus__character_save` | `CharacterSaveInputShape` | `INSERT` — creates character owned by current user |
| `mcp__openormus__character_list` | `{}` (empty) | `SELECT WHERE userId = current` |
| `mcp__openormus__character_update` | `{ id, sheet (partial) }` | `UPDATE WHERE id AND userId = current` |
| `mcp__openormus__character_delete` | `{ id }` | `DELETE WHERE id AND userId = current` |

All tools scope every query by `userId` from `userIdStorage.getStore()`. Even if Supabase RLS is active, queries include explicit `WHERE user_id = $userId` (belt-and-braces per AGENTS.md §6).

Error responses follow existing pattern: `{ content: [{ type: "text", text: JSON.stringify({ error: "..." }) }] }`.

Error cases:
- `character_update` / `character_delete`: return `{ error: "not_found" }` if record doesn't exist or belongs to another user (same response — no info leak).
- `character_save`: return `{ error: "validation_error" }` if sheet fails Zod parse.

---

## 5. `mcp_server/src/db.ts` (new)

Prisma singleton using the mcp_server-specific generated client:

```typescript
import { PrismaClient } from "./generated/prisma/index.js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env["NODE_ENV"] !== "production") globalForPrisma.prisma = prisma;
```

---

## 6. Files Changed

### New files
```
mcp_server/src/auth/context.ts
mcp_server/src/db.ts
mcp_server/src/generated/prisma/          ← generated, gitignored
mcp_server/src/registry/tools/character_save.ts
mcp_server/src/registry/tools/character_list.ts
mcp_server/src/registry/tools/character_update.ts
mcp_server/src/registry/tools/character_delete.ts
packages/shared/schema/character_saved.ts
```

### Modified files
```
prisma/schema.prisma                       ← add generator_mcp + Character model + User relation
packages/shared/schema/character.ts        ← deleted
packages/shared/index.ts                   ← swap character exports
mcp_server/src/registry/store.ts           ← deleted
mcp_server/src/registry/registry.ts        ← remove old tools, register 4 new tools
mcp_server/src/transport/streamable-http.ts ← wrap handleRequest in userIdStorage.run
mcp_server/src/transport/sse.ts            ← wrap handleRequest in userIdStorage.run
mcp_server/package.json                    ← add @prisma/client dependency
```

---

## 7. Migration

Run after schema changes:

```bash
bun run --cwd frontend prisma migrate dev --name add_characters
bun run --cwd frontend prisma generate   # generates BOTH frontend AND mcp_server clients (all generators in schema.prisma)
```

Note: `prisma` CLI runs via Node (not Bun) per AGENTS.md §3. mcp_server has no prisma CLI — do not run generate from there.

---

## 8. Out of Scope

- No changes to Exa search tools (`character_search`, `show_search`)
- No changes to `scene_simulate`
- No frontend UI for saved characters (separate milestone)
- No pagination for `character_list` (deferred — add when needed)
