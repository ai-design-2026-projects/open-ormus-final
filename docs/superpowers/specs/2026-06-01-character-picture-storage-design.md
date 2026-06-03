# Character Picture Storage — Design

**Date:** 2026-06-01
**Worktree:** `character-picture-storage`

---

## Overview

Profile pictures for characters are downloaded from external URLs (sourced from Exa research or user-provided) and stored in Supabase Storage. Three square sizes are generated via center-crop and WebP conversion. A new `character_pictures` DB table links pictures to characters. `imageUrl` is removed from `character.sheet` entirely.

---

## Architecture

```
User/LLM provides sourceUrl (separate from character sheet data)
        ↓
processCharacterPicture()          ← packages/shared/services/character_picture.service.ts
  · downloads sourceUrl
  · validates content-type is image
  · center-crops to square (no shrink, no stretch)
  · resizes to 48 / 128 / 512 px
  · converts to WebP
  · uploads 3 files to Supabase Storage (service role key)
      bucket: character-pictures
      path:   {userId}/{characterId}/{size}.webp
  · upserts 3 CharacterPicture rows
  · returns 512px public URL
        ↓
saveCharacter()                    ← packages/shared/services/character.service.ts
  · writes character to DB (no imageUrl in sheet)
        ↓
listCharacters() joins character_pictures
  · SavedCharacterRecord includes pictures: { size, url }[]
```

Both the frontend API route (`POST /api/characters`, `PUT /api/characters/[id]`) and the MCP `character_save` / `character_update` tool handlers call `processCharacterPicture` then `saveCharacter` using this shape. Logic lives once in `packages/shared`.

The MCP server receives characters with a `sourceUrl` field from the LLM. The frontend wizard provides a URL text input (no file upload — wizard is being deprecated). Neither path requires multipart/form-data.

---

## Data Model

### New Prisma model

```prisma
model CharacterPicture {
  id          String    @id @default(uuid()) @db.Uuid
  userId      String    @db.Uuid @map("user_id")
  characterId String    @db.Uuid @map("character_id")
  size        Int       // 48 | 128 | 512
  url         String    // public Supabase Storage URL
  storagePath String    @map("storage_path")

  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  character Character @relation(fields: [characterId], references: [id], onDelete: Cascade)

  @@unique([characterId, size])
  @@index([userId])
  @@map("character_pictures")
}
```

`onDelete: Cascade` on both relations ensures that deleting a user or character removes all picture rows automatically.

### Supabase Storage

- Bucket: `character-pictures` (new, public reads)
- Path: `{userId}/{characterId}/{size}.webp`
- Auth: service role key used by both frontend and MCP server — bypasses RLS, consistent code path

### Zod schema changes

| Schema | Change |
|---|---|
| `CharacterSaveInput` | Remove `imageUrl` |
| `CharacterSearchResult` | Remove `imageUrl` — the field currently named `imageUrl` in Exa results becomes the `sourceUrl` passed to `processCharacterPicture`; callers extract it before discarding the search result |
| `SavedCharacterRecord` | Remove `imageUrl`, add `pictures: { size: number; url: string }[]` |

Existing characters in the DB retain `imageUrl` in their JSONB blob — ignored at the application layer, no migration.

---

## Data Flow

### Save (create)

1. Caller has `sourceUrl` (string) and character data (no `imageUrl`)
2. Call `processCharacterPicture({ sourceUrl, userId, characterId, supabaseUrl, supabaseServiceRoleKey })`:
   - Downloads URL — fails hard if unreachable or non-image (error propagates to caller, character is NOT saved)
   - Center-crops to square, resizes to 48/128/512, converts to WebP
   - Uploads 3 files to Storage — fails hard if upload fails
   - Upserts 3 `CharacterPicture` rows (`@@unique([characterId, size])` handles re-upload)
3. Call `saveCharacter(prisma, userId, data)` — character sheet has no `imageUrl`
4. Return `SavedCharacterRecord` with `pictures` populated

### Update

Same as save: if `sourceUrl` provided in update call, `processCharacterPicture` runs first. Upsert replaces existing `CharacterPicture` rows; Storage files overwritten at same path.

### No sourceUrl

If caller provides no `sourceUrl`, skip picture processing entirely. `pictures` array is empty for that character.

### List

`listCharacters` joins `character_pictures` and groups by `characterId`. `SavedCharacterRecord.pictures` contains all sizes for that character.

---

## Error Handling

Picture processing is **on the critical path** — failure blocks the save entirely:

| Failure | Behaviour |
|---|---|
| URL unreachable / timeout | Error returned to caller; character not saved |
| Content-type not image | Error returned to caller; character not saved |
| Resize/WebP conversion fails | Error returned to caller; character not saved |
| Storage upload fails | Error returned to caller; character not saved |
| No sourceUrl provided | Skip picture processing; save proceeds normally |

MCP tool surfaces errors as tool errors back to the LLM. Frontend routes return 4xx/5xx.

---

## New Dependencies

| Package | Location | Purpose |
|---|---|---|
| `sharp` | `packages/shared` | Image resize, center-crop, WebP conversion |

Requires explicit approval before `bun add`.

---

## New Environment Variables

| Variable | Used by | Notes |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Frontend + MCP server | Already exists in Supabase project dashboard; add to `.env.example` and `.env.local` |

---

## Files Affected

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `CharacterPicture` model, add relation to `Character` and `User` |
| `packages/shared/schema/character_saved.ts` | Remove `imageUrl`, add `pictures` to `SavedCharacterRecord` |
| `packages/shared/schema/character_search.ts` | Remove `imageUrl` from `CharacterSearchResult` |
| `packages/shared/services/character_picture.service.ts` | New — download, process, upload, upsert |
| `packages/shared/services/character.service.ts` | `listCharacters` joins `character_pictures`; `PrismaLike` interface extended |
| `frontend/app/api/characters/route.ts` | Call `processCharacterPicture` before `saveCharacter` |
| `frontend/app/api/characters/[id]/route.ts` | Call `processCharacterPicture` on update if `sourceUrl` provided |
| `frontend/components/characters/CharacterCard.tsx` | Read from `character.pictures` instead of `sheet.imageUrl` |
| `frontend/components/characters/CharacterFormWizard.tsx` | `imageUrl` field → `sourceUrl` field (separate from sheet data) |
| `mcp_server/src/registry/tools/character_save.ts` | Call `processCharacterPicture` before `saveCharacter` |
| `mcp_server/src/registry/tools/character_update.ts` | Call `processCharacterPicture` on update if `sourceUrl` provided |
| `.env.example` | Add `SUPABASE_SERVICE_ROLE_KEY` |
