# Character Picture Upload — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users upload character pictures from their filesystem — both inside the CharacterFormWizard (create/edit) and via a hover overlay on CharacterCard.

**Architecture:** A new Next.js route (`POST/DELETE /api/characters/[id]/picture`) receives the file, runs it through the existing sharp-resize pipeline via a new `processAndStorePicturesFromBuffer` service function, and stores results in Supabase + DB. The wizard and card both call this route client-side; the card updates the parent list in-place without a full refresh.

**Tech Stack:** Next.js 16 App Router, Supabase Storage, sharp, Prisma 7, lucide-react, Tailwind CSS

---

## File Map

| Action | Path | Purpose |
|---|---|---|
| Modify | `packages/shared/services/character_picture.service.ts` | Add `processAndStorePicturesFromBuffer`; refactor `processAndStorePictures` to use it |
| Create | `frontend/app/api/characters/[id]/picture/route.ts` | POST (upload) + DELETE (remove) handlers |
| Modify | `frontend/components/characters/CharacterFormWizard.tsx` | File state, preview UI, mutual exclusivity, upload in save flow |
| Modify | `frontend/components/characters/CharacterCard.tsx` | Hover overlay, hidden file input, optimistic upload |
| Modify | `frontend/components/characters/CharacterList.tsx` | Add `onPictureChange` prop, pass to CharacterCard |
| Modify | `frontend/app/_components/library-page.tsx` | Return `SavedCharacterRecord` from handlers, wire `onPictureChange` |

---

## Task 1: Add `processAndStorePicturesFromBuffer` to the picture service

**Files:**
- Modify: `packages/shared/services/character_picture.service.ts`

- [ ] **Step 1: Add the buffer-based function and refactor the URL-based function to use it**

Replace the full contents of `packages/shared/services/character_picture.service.ts` with:

```ts
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import type { CharacterPicture } from "../schema/character_saved";

const SIZES = [48, 128, 512] as const;
const BUCKET = "character-pictures";

interface PrismaWithPictures {
  characterPicture: {
    upsert(args: {
      where: { characterId_size: { characterId: string; size: number } };
      update: { url: string; storagePath: string };
      create: {
        id: string;
        userId: string;
        characterId: string;
        size: number;
        url: string;
        storagePath: string;
      };
    }): Promise<{ id: string; size: number; url: string; storagePath: string }>;
    deleteMany(args: { where: { characterId: string } }): Promise<{ count: number }>;
  };
}

export async function processAndStorePicturesFromBuffer(
  prismaLike: PrismaWithPictures,
  buffer: Buffer,
  userId: string,
  characterId: string,
  config: { supabaseUrl: string; supabaseServiceRoleKey: string }
): Promise<CharacterPicture[]> {
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  const results: CharacterPicture[] = [];

  for (const size of SIZES) {
    const processed = await sharp(buffer)
      .resize(size, size, { fit: "cover" })
      .webp()
      .toBuffer();

    const storagePath = `${userId}/${characterId}/${size}.webp`;
    const { error } = await supabase.storage.from(BUCKET).upload(storagePath, processed, {
      contentType: "image/webp",
      upsert: true,
    });
    if (error) throw new Error(`Storage upload failed for size ${size}: ${error.message}`);

    const {
      data: { publicUrl },
    } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

    await prismaLike.characterPicture.upsert({
      where: { characterId_size: { characterId, size } },
      update: { url: publicUrl, storagePath },
      create: { id: randomUUID(), userId, characterId, size, url: publicUrl, storagePath },
    });

    results.push({ size, url: publicUrl });
  }

  return results;
}

export async function processAndStorePictures(
  prismaLike: PrismaWithPictures,
  sourceUrl: string,
  userId: string,
  characterId: string,
  config: { supabaseUrl: string; supabaseServiceRoleKey: string }
): Promise<CharacterPicture[]> {
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Image fetch failed: HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) throw new Error(`Not an image: ${contentType}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return processAndStorePicturesFromBuffer(prismaLike, buffer, userId, characterId, config);
}

export async function deletePictures(
  prismaLike: PrismaWithPictures,
  userId: string,
  characterId: string,
  config: { supabaseUrl: string; supabaseServiceRoleKey: string }
): Promise<void> {
  await prismaLike.characterPicture.deleteMany({ where: { characterId } });
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  const paths = SIZES.map((size) => `${userId}/${characterId}/${size}.webp`);
  await supabase.storage.from(BUCKET).remove(paths);
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/services/character_picture.service.ts
git commit -m "refactor: extract processAndStorePicturesFromBuffer from URL-based function"
```

---

## Task 2: New API route — `POST/DELETE /api/characters/[id]/picture`

**Files:**
- Create: `frontend/app/api/characters/[id]/picture/route.ts`

- [ ] **Step 1: Create the route file**

```ts
// frontend/app/api/characters/[id]/picture/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import {
  processAndStorePicturesFromBuffer,
  deletePictures,
} from "@open-ormus/shared/services/character_picture.service";
import { listCharacters } from "@open-ormus/shared/services/character.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const CONFIG = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
};

export async function POST(request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // Verify ownership
  const [character] = await listCharacters(prisma, user.id);
  const owned = (await prisma.character.findFirst({ where: { id, userId: user.id } }));
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart body" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "file field required" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "file must be an image" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const pictures = await processAndStorePicturesFromBuffer(
      prisma,
      buffer,
      user.id,
      id,
      CONFIG
    );
    // Return the full updated character record
    const updated = await prisma.character.findFirst({ where: { id, userId: user.id } });
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      id: updated.id,
      userId: updated.userId,
      name: updated.name,
      sheet: updated.sheet,
      pictures,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      archivedAt: updated.archivedAt?.toISOString() ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Picture processing failed: ${String(err)}` },
      { status: 422 }
    );
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const owned = await prisma.character.findFirst({ where: { id, userId: user.id } });
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await deletePictures(prisma, user.id, id, CONFIG);
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/api/characters/[id]/picture/route.ts
git commit -m "feat: add POST/DELETE /api/characters/[id]/picture route"
```

---

## Task 3: CharacterFormWizard — file state and Basics step UI

**Files:**
- Modify: `frontend/components/characters/CharacterFormWizard.tsx`

- [ ] **Step 1: Add imports and file-related state**

At the top of the file, add `useRef` and `useEffect` to the React import, and add `Camera` from lucide-react and `Monogram` from the UI lib:

```ts
import { useState, useRef, useEffect } from "react";
// ... existing imports ...
import { Camera } from "lucide-react";
import { Monogram } from "@/components/ui/monogram";
```

Inside `CharacterFormWizard`, after the existing `useState` declarations, add:

```ts
const [file, setFile] = useState<File | null>(null);
const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
const fileInputRef = useRef<HTMLInputElement>(null);

useEffect(() => {
  return () => {
    if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
  };
}, [filePreviewUrl]);
```

- [ ] **Step 2: Add `handleFileSelect` function**

After the `set` helper function, add:

```ts
const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
  const picked = e.target.files?.[0];
  if (!picked) return;
  if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
  setFile(picked);
  setFilePreviewUrl(URL.createObjectURL(picked));
  set("imageUrl", "");
  // Reset the input so the same file can be re-selected
  if (fileInputRef.current) fileInputRef.current.value = "";
};
```

- [ ] **Step 3: Clear file state when a new character loads from the queue**

In `handleImported`, after `setStep(...)`, add:
```ts
if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
setFile(null);
setFilePreviewUrl(null);
```

In `handleSkip`, after `setStep(...)` / `setForm(...)`, add the same three lines.

- [ ] **Step 4: Replace the Image URL field in the Basics step (formStep === 0)**

Find this block:
```tsx
<div>
  <FieldLabel>Image URL</FieldLabel>
  <Input
    type="text"
    value={form.imageUrl}
    onChange={(e) => set("imageUrl", e.target.value)}
  />
</div>
```

Replace with:
```tsx
<div>
  <FieldLabel>Picture</FieldLabel>
  {/* Preview */}
  <div className="mb-3">
    {(filePreviewUrl || form.imageUrl) ? (
      <img
        src={filePreviewUrl ?? form.imageUrl}
        alt="Preview"
        className="size-14 rounded-[var(--r-md)] object-cover"
      />
    ) : (
      <Monogram name={form.name || "?"} size={56} />
    )}
  </div>
  {/* Hidden file input */}
  <input
    ref={fileInputRef}
    type="file"
    accept="image/*"
    className="hidden"
    onChange={handleFileSelect}
  />
  <Button
    type="button"
    variant="outline"
    size="sm"
    onClick={() => fileInputRef.current?.click()}
    className="mb-3"
  >
    <Camera className="size-3.5 mr-1.5" /> Upload from file
  </Button>
  {/* URL input */}
  <div className="t-meta text-ink-faint mb-1">or paste a URL</div>
  <Input
    type="text"
    value={form.imageUrl}
    placeholder="https://..."
    onChange={(e) => {
      if (filePreviewUrl) { URL.revokeObjectURL(filePreviewUrl); setFilePreviewUrl(null); }
      setFile(null);
      set("imageUrl", e.target.value);
    }}
  />
</div>
```

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/characters/CharacterFormWizard.tsx
git commit -m "feat: add file picker UI to CharacterFormWizard Basics step"
```

---

## Task 4: CharacterFormWizard — update save handlers + onSubmit type

**Files:**
- Modify: `frontend/components/characters/CharacterFormWizard.tsx`

- [ ] **Step 1: Change `WizardProps.onSubmit` return type**

Find:
```ts
onSubmit: (data: CharacterSaveInput) => Promise<void>;
```

Replace with:
```ts
onSubmit: (data: CharacterSaveInput) => Promise<SavedCharacterRecord>;
```

- [ ] **Step 2: Add `uploadPendingFile` helper inside the component**

After `handleFileSelect`, add:

```ts
const uploadPendingFile = async (characterId: string): Promise<void> => {
  if (!file) return;
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`/api/characters/${characterId}/picture`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) console.error("[CharacterFormWizard] picture upload failed");
  setFile(null);
  if (filePreviewUrl) { URL.revokeObjectURL(filePreviewUrl); setFilePreviewUrl(null); }
};
```

- [ ] **Step 3: Update `handleSubmit`**

Replace the existing `handleSubmit`:

```ts
const handleSubmit = async () => {
  setSubmitting(true);
  setError(null);
  try {
    if (mode === "edit" && initialData && file) {
      // Upload file before updating sheet (character already exists)
      await uploadPendingFile(initialData.id);
    }
    const saved = await onSubmit(toSaveInput(form));
    if (mode === "create" && file) {
      // Upload file after character is created (need the new ID)
      await uploadPendingFile(saved.id);
    }
    onClose();
  } catch {
    setError("Failed to save character. Please try again.");
    setSubmitting(false);
  }
};
```

- [ ] **Step 4: Update `handleSaveAndNext`**

Replace the existing `handleSaveAndNext`:

```ts
const handleSaveAndNext = async () => {
  setSubmitting(true);
  setError(null);
  try {
    if (mode === "edit" && initialData && file) {
      await uploadPendingFile(initialData.id);
    }
    const saved = await onSubmit(toSaveInput(form));
    if (mode === "create" && file) {
      await uploadPendingFile(saved.id);
    }
    if (pendingQueue.length > 0) {
      const [next, ...rest] = pendingQueue;
      setForm(fromSearchResult(next!));
      setPendingQueue(rest);
      setStep(mode === "create" ? 1 : 0);
    } else {
      onClose();
    }
  } catch {
    setError("Failed to save character. Please try again.");
  } finally {
    setSubmitting(false);
  }
};
```

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: errors in `library-page.tsx` because `handleCreate`/`handleEdit` now need to return `SavedCharacterRecord`. Fix in next task.

- [ ] **Step 6: Commit (after Task 5 fixes typecheck)**

_Hold — commit together with Task 5._

---

## Task 5: library-page.tsx — return `SavedCharacterRecord` + wire `onPictureChange`

**Files:**
- Modify: `frontend/app/_components/library-page.tsx`

- [ ] **Step 1: Add `useCallback` to imports if not already there**

The file already imports `useCallback`. Verify the import line includes it:
```ts
import { useState, useEffect, useCallback, useMemo } from "react";
```

- [ ] **Step 2: Update `handleCreate` to return `SavedCharacterRecord`**

Replace:
```ts
const handleCreate = async (data: CharacterSaveInput) => {
  const res = await fetch("/api/characters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create character");
  await fetchCharacters();
};
```

With:
```ts
const handleCreate = async (data: CharacterSaveInput): Promise<SavedCharacterRecord> => {
  const res = await fetch("/api/characters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create character");
  const character = (await res.json()) as SavedCharacterRecord;
  await fetchCharacters();
  return character;
};
```

- [ ] **Step 3: Update `handleEdit` to return `SavedCharacterRecord`**

Replace:
```ts
const handleEdit = async (data: CharacterSaveInput) => {
  if (!selected) return;
  const res = await fetch(`/api/characters/${selected.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: selected.id, sheet: data }),
  });
  if (!res.ok) throw new Error("Failed to update character");
  await fetchCharacters();
};
```

With:
```ts
const handleEdit = async (data: CharacterSaveInput): Promise<SavedCharacterRecord> => {
  if (!selected) throw new Error("No character selected");
  const res = await fetch(`/api/characters/${selected.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: selected.id, sheet: data }),
  });
  if (!res.ok) throw new Error("Failed to update character");
  const character = (await res.json()) as SavedCharacterRecord;
  await fetchCharacters();
  return character;
};
```

- [ ] **Step 4: Add `handlePictureChange`**

After `handleDelete`, add:

```ts
const handlePictureChange = useCallback((updated: SavedCharacterRecord) => {
  setCharacters((prev) => prev.map((c) => c.id === updated.id ? updated : c));
}, []);
```

- [ ] **Step 5: Pass `onPictureChange` to `CharacterList`**

Find:
```tsx
<CharacterList characters={filtered} loading={loading} onView={openView} onEdit={openEdit} onDelete={openDelete} />
```

Replace with:
```tsx
<CharacterList characters={filtered} loading={loading} onView={openView} onEdit={openEdit} onDelete={openDelete} onPictureChange={handlePictureChange} />
```

- [ ] **Step 6: Typecheck**

```bash
bun run typecheck
```

Expected: errors in `CharacterList` and `CharacterCard` about unknown `onPictureChange` prop. Fix in Tasks 6 and 7.

- [ ] **Step 7: Commit together with Task 4**

```bash
git add frontend/components/characters/CharacterFormWizard.tsx frontend/app/_components/library-page.tsx
git commit -m "feat: wire file upload into wizard save flow and library page"
```

---

## Task 6: CharacterList — add `onPictureChange` prop

**Files:**
- Modify: `frontend/components/characters/CharacterList.tsx`

- [ ] **Step 1: Add prop and wire to CharacterCard**

Replace the full file contents:

```tsx
"use client";
// frontend/components/characters/CharacterList.tsx
import type { SavedCharacterRecord } from "@open-ormus/shared";
import { CharacterCard } from "./CharacterCard";

interface Props {
  characters: SavedCharacterRecord[];
  loading: boolean;
  onView: (c: SavedCharacterRecord) => void;
  onEdit: (c: SavedCharacterRecord) => void;
  onDelete: (c: SavedCharacterRecord) => void;
  onPictureChange?: (updated: SavedCharacterRecord) => void;
}

function Skeleton() {
  return (
    <div className="bg-surface-sunk border border-hair rounded-[var(--r-lg)] p-4 animate-pulse">
      <div className="flex gap-3">
        <div className="w-14 h-14 rounded-[var(--r-md)] bg-surface-2 flex-shrink-0" />
        <div className="flex-1 space-y-2 mt-1">
          <div className="h-4 bg-surface-2 rounded w-1/2" />
          <div className="h-3 bg-surface-2 rounded w-full" />
          <div className="h-3 bg-surface-2 rounded w-2/3" />
        </div>
      </div>
    </div>
  );
}

export function CharacterList({ characters, loading, onView, onEdit, onDelete, onPictureChange }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} />)}
      </div>
    );
  }

  if (characters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 bg-surface-1 border border-dashed border-hair-strong rounded-[var(--r-lg)] text-ink-mute">
        <p className="t-body-l font-medium">No characters yet</p>
        <p className="t-body-s mt-1 text-ink-faint">Create your first character to get started</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {characters.map((c, i) => (
        <div key={c.id} className={i === 0 ? "col-span-2 row-span-2 h-full" : ""}>
          <CharacterCard
            character={c}
            onView={onView}
            onEdit={onEdit}
            onDelete={onDelete}
            onPictureChange={onPictureChange}
          />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: error on `CharacterCard` about unknown `onPictureChange` prop. Fix in Task 7.

- [ ] **Step 3: Commit after Task 7 passes typecheck**

_Hold — commit together with Task 7._

---

## Task 7: CharacterCard — hover overlay + file upload

**Files:**
- Modify: `frontend/components/characters/CharacterCard.tsx`

- [ ] **Step 1: Rewrite CharacterCard with upload overlay**

Replace the full file contents:

```tsx
"use client";
import { useState, useRef } from "react";
import type { SavedCharacterRecord } from "@open-ormus/shared";
import { Play, Eye, Pencil, Trash2, Camera, Loader2 } from "lucide-react";
import { Monogram } from "@/components/ui/monogram";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";

interface Props {
  character: SavedCharacterRecord;
  onView: (c: SavedCharacterRecord) => void;
  onEdit: (c: SavedCharacterRecord) => void;
  onDelete: (c: SavedCharacterRecord) => void;
  onPictureChange?: (updated: SavedCharacterRecord) => void;
}

export function CharacterCard({ character, onView, onEdit, onDelete, onPictureChange }: Props) {
  const [localPictureUrl, setLocalPictureUrl] = useState<string | undefined>(
    character.pictures.find((p) => p.size === 512)?.url
  );
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { sheet } = character;
  const shortDesc = sheet.shortDescription;
  const traits: string[] = sheet.personality.personalityTraits.slice(0, 4);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const prevUrl = localPictureUrl;
    const optimisticUrl = URL.createObjectURL(file);
    setLocalPictureUrl(optimisticUrl);
    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`/api/characters/${character.id}/picture`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      const updated = (await res.json()) as SavedCharacterRecord;
      const serverUrl = updated.pictures.find((p) => p.size === 512)?.url;
      // Bust CDN cache by appending timestamp
      setLocalPictureUrl(serverUrl ? `${serverUrl}?t=${Date.now()}` : serverUrl);
      onPictureChange?.(updated);
    } catch {
      setLocalPictureUrl(prevUrl);
    } finally {
      setUploading(false);
      URL.revokeObjectURL(optimisticUrl);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <article className="bg-surface-1 border border-hair rounded-[var(--r-lg)] p-[22px] flex flex-col gap-3.5 relative transition-[box-shadow,border-color] duration-[220ms] hover:shadow-[var(--shadow-inset),var(--shadow-2)] hover:border-hair-strong shadow-[var(--shadow-inset),var(--shadow-1)] h-full">
      {/* Top: Avatar (with upload overlay) + badges */}
      <div className="flex items-start justify-between">
        <div
          className="relative group cursor-pointer size-14 shrink-0"
          onClick={() => !uploading && fileInputRef.current?.click()}
        >
          {localPictureUrl ? (
            <img
              src={localPictureUrl}
              alt={character.name}
              className="size-14 rounded-[var(--r-md)] object-cover"
            />
          ) : (
            <Monogram name={character.name} size={56} />
          )}
          {/* Hover / uploading overlay */}
          <div
            className={`absolute inset-0 rounded-[var(--r-md)] flex items-center justify-center bg-black/50 transition-opacity ${
              uploading ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            {uploading ? (
              <Loader2 className="size-4 text-white animate-spin" />
            ) : (
              <Camera className="size-4 text-white" />
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Badge tone="neutral" mono>PERSONAL</Badge>
        </div>
      </div>

      {/* Name + short description */}
      <div className="flex flex-col gap-0.5">
        <h3 className="t-h6 m-0 tracking-[-0.015em]">{character.name}</h3>
        <div className="t-body-s text-ink-mute line-clamp-2">{shortDesc}</div>
      </div>

      {/* Trait tags */}
      {traits.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {traits.map((trait, i) => (
            <Tag key={i} tone="neutral">{trait}</Tag>
          ))}
        </div>
      )}

      {/* Footer: scene count */}
      <div className="mt-auto pt-3 border-t border-dashed border-hair-strong">
        <span className="t-mono text-[11px] text-ink-mute flex items-center gap-1.5">
          <Play strokeWidth={1.5} className="size-3" /> 0
        </span>
      </div>

      {/* Action row */}
      <div className="flex gap-1 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={() => onView(character)} className="flex-1 gap-1">
          <Eye className="size-3.5" /> View
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(character)} className="flex-1 gap-1">
          <Pencil className="size-3.5" /> Edit
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onDelete(character)} className="flex-1 gap-1 text-signal-flag hover:text-signal-flag">
          <Trash2 className="size-3.5" /> Delete
        </Button>
      </div>
    </article>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit Tasks 6 and 7 together**

```bash
git add frontend/components/characters/CharacterList.tsx frontend/components/characters/CharacterCard.tsx
git commit -m "feat: add hover-overlay picture upload to CharacterCard and CharacterList"
```

---

## Self-Review

**Spec coverage check:**
- ✅ `processAndStorePicturesFromBuffer` — Task 1
- ✅ `POST /api/characters/[id]/picture` — Task 2
- ✅ `DELETE /api/characters/[id]/picture` — Task 2
- ✅ Auth + ownership check on both endpoints — Task 2
- ✅ Wizard: file state, preview, mutual exclusivity (file↔URL) — Task 3
- ✅ Wizard create: save first, upload after (uses returned ID) — Task 4
- ✅ Wizard edit: upload before sheet update — Task 4
- ✅ Card hover overlay with camera icon — Task 7
- ✅ Optimistic preview + revert on failure — Task 7
- ✅ CDN cache bust on success — Task 7
- ✅ `onPictureChange` prop bubbles updated record to parent — Tasks 6, 7
- ✅ Parent updates character list in-place (no full reload) — Task 5

**Type consistency check:**
- `onSubmit: (data: CharacterSaveInput) => Promise<SavedCharacterRecord>` — defined in Task 4, consumed in Task 5 ✅
- `onPictureChange?: (updated: SavedCharacterRecord) => void` — defined in Task 7, wired in Task 6, implemented in Task 5 ✅
- `processAndStorePicturesFromBuffer` signature matches usage in Task 2 ✅
