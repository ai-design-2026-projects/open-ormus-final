# Character Picture Upload — Design Spec

**Date:** 2026-06-03
**Status:** Approved

## Overview

Users can upload a picture for a character from their filesystem, both during creation/editing (via `CharacterFormWizard`) and directly from the library (via a hover overlay on `CharacterCard`). The upload pipeline reuses the existing sharp-resize + Supabase storage flow.

---

## Backend

### `character_picture.service.ts`

Add `processAndStorePicturesFromBuffer`:

```ts
processAndStorePicturesFromBuffer(
  prisma: PrismaWithPictures,
  buffer: Buffer,
  userId: string,
  characterId: string,
  config: { supabaseUrl: string; supabaseServiceRoleKey: string }
): Promise<CharacterPicture[]>
```

Same logic as the existing `processAndStorePictures` (resize to 48/128/512, WebP, Supabase upload, DB upsert) but accepts a raw `Buffer` instead of fetching a URL. Existing URL-based function is unchanged — still used by the agent flow.

### New API route: `frontend/app/api/characters/[id]/picture/route.ts`

**`POST`** — Upload/replace picture
- Auth: `supabase.auth.getUser()` required; verify character belongs to `userId` via Prisma before writing
- Body: `multipart/form-data`, single field `file` (image/*)
- Reads buffer from request, calls `processAndStorePicturesFromBuffer`
- Returns `200` with updated `pictures: CharacterPicture[]`
- Errors: `401` if not authenticated, `404` if character not found or not owned, `400` if no file or not an image

**`DELETE`** — Remove picture
- Same auth/ownership check
- Calls existing `deletePictures(prisma, userId, characterId, config)`
- Returns `204`

---

## CharacterFormWizard — Basics Step

### State

Two mutually exclusive fields alongside existing form state:
- `imageUrl: string` — typed URL (existing)
- `file: File | null` — chosen file (new)

Invariant: picking a file clears `imageUrl`; typing a URL clears `file`.

### UI

The Basics step image area becomes:
- A preview showing the current picture (from `file` via `createObjectURL`, from `imageUrl`, or monogram fallback)
- A hidden `<input type="file" accept="image/*">` triggered by an "Upload" button
- The existing `imageUrl` text input (kept, below the preview)

### Save flow — create mode

1. Submit wizard → `POST /api/characters` with `imageUrl` if a URL was typed, `null` if a file was chosen or neither provided
2. If `file` is set → `POST /api/characters/[newId]/picture` with the file
3. Submit button shows spinner during both steps; both complete before wizard closes

### Save flow — edit mode

1. If `file` is set → `POST /api/characters/[id]/picture` first
2. Then `PATCH /api/characters/[id]` for the sheet (existing flow)

---

## CharacterCard — Hover Overlay

### UI

The avatar area (top-left) becomes a `relative` container. On hover:
- Semi-transparent dark overlay appears over the avatar/monogram
- Camera icon centered in the overlay
- Cursor changes to `pointer`
- Hidden `<input type="file" accept="image/*">` triggered on click

### Upload flow

1. File selected → show `createObjectURL(file)` preview immediately (optimistic)
2. POST to `/api/characters/[id]/picture` — overlay shows spinner during upload
3. **Success**: replace optimistic URL with the server-returned URL (append `?t=timestamp` to bust CDN cache)
4. **Failure**: revert to previous picture; show brief error toast

### Props change

```ts
onPictureChange?: (updated: SavedCharacterRecord) => void
```

Added to `CharacterCard`. Called on successful upload with the updated record. Parent (`CharacterList`) updates its local character array in place — no full page reload.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| File not an image | `400` from API; toast shown in UI |
| Upload fails (network/Supabase) | Optimistic preview reverted; toast shown |
| Character not owned by user | `404`; wizard/card shows generic error |
| Picture upload succeeds but sheet save fails (create flow) | Character exists with picture; wizard shows error on sheet save only |

---

## Out of Scope

- Crop/zoom UI (upload raw, server crops to square via `fit: "cover"`)
- Multi-file upload
- Drag-and-drop
- Progress bar (spinner only)
