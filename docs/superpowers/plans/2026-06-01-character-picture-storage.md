# Character Picture Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Download and store character profile pictures in Supabase Storage (3 square WebP sizes: 48/128/512 px), replacing the raw `imageUrl` field in `character.sheet` JSONB with a dedicated `character_pictures` DB table.

**Architecture:** Both the frontend API and MCP `character_save`/`character_update` tools call `processAndStorePictures` from `packages/shared` before saving a character. The function downloads the source URL, center-crops and resizes to 3 sizes with `sharp`, uploads to Supabase Storage using the service role key, and upserts `CharacterPicture` DB rows. `imageUrl` is stripped from the character sheet JSONB; `character_pictures` becomes the canonical image source. `SavedCharacterRecord` gains a `pictures` array for downstream consumers.

**Tech Stack:** `sharp` (image processing), `@supabase/supabase-js` (storage uploads), Prisma 7 (new `CharacterPicture` model), Bun test, Next.js App Router, MCP SDK.

---

## File Map

| File | Action | What changes |
|---|---|---|
| `.env.example` | Modify | Add `SUPABASE_SERVICE_ROLE_KEY` |
| `packages/shared/package.json` | Modify | Add `sharp`, `@supabase/supabase-js` deps |
| `prisma/schema.prisma` | Modify | Add `CharacterPicture` model + relations |
| `packages/shared/schema/character_search.ts` | Modify | `imageUrl` → optional in `CharacterSearchResultSchema` |
| `packages/shared/schema/character_saved.ts` | Modify | Add `CharacterPictureSchema`; add `pictures` to `SavedCharacterRecordSchema`; add `imageUrl` to `CharacterUpdateInputShape` |
| `packages/shared/index.ts` | Modify | Export `CharacterPictureSchema`, `CharacterPicture` |
| `packages/shared/services/character_picture.service.ts` | **Create** | `processAndStorePictures` — download, resize, upload, upsert |
| `packages/shared/services/character_picture.service.test.ts` | **Create** | Tests for the picture service |
| `packages/shared/services/character.service.ts` | Modify | Extend `PrismaLike`; update `saveCharacter`, `updateCharacter`, `listCharacters` |
| `frontend/app/api/characters/route.ts` | Modify | Extract `imageUrl`, call picture service before saving |
| `frontend/app/api/characters/[id]/route.ts` | Modify | Extract `imageUrl`, call picture service before updating |
| `mcp_server/src/registry/tools/character_save.ts` | Modify | Extract `imageUrl`, call picture service before saving |
| `mcp_server/src/registry/tools/character_save.test.ts` | Modify | Remove `imageUrl` from mock sheet; add `pictures: []` assertion |
| `mcp_server/src/registry/tools/character_update.ts` | Modify | Extract `imageUrl`, call picture service before updating |
| `mcp_server/src/registry/tools/character_update.test.ts` | Modify | Remove `imageUrl` from `validSheet`; add `characterPicture` to prisma mock |
| `packages/shared/services/character_search.service.test.ts` | Modify | Update `imageUrl` assertion (now optional) |
| `frontend/components/characters/CharacterCard.tsx` | Modify | Read `character.pictures` instead of `character.sheet.imageUrl` |
| `frontend/components/characters/CharacterFormWizard.tsx` | Modify | `fromRecord` uses `pictures`; `fromSearchResult` keeps imageUrl from optional field |

---

## Task 1: Add `SUPABASE_SERVICE_ROLE_KEY` to env

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add the env var**

Open `.env.example` and add after the existing Supabase vars:

```
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

- [ ] **Step 2: Add to your local `.env.local`**

Copy the actual service role key from your Supabase project dashboard → Settings → API → `service_role` secret.

```bash
echo "SUPABASE_SERVICE_ROLE_KEY=<your-actual-key>" >> .env.local
```

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "chore: add SUPABASE_SERVICE_ROLE_KEY env var"
```

---

## Task 2: Add `sharp` and `@supabase/supabase-js` to `packages/shared`

**Files:**
- Modify: `packages/shared/package.json`

> **Note:** This step requires approval per AGENTS.md §10. The two packages are:
> - `sharp` — industry-standard Node image processing; no viable alternative for server-side center-crop + WebP conversion
> - `@supabase/supabase-js` — official Supabase SDK needed for Storage uploads using the service role key in the shared service

- [ ] **Step 1: Install packages**

```bash
bun add sharp @supabase/supabase-js --cwd packages/shared
```

- [ ] **Step 2: Verify packages/shared/package.json has both deps**

```bash
grep -E "sharp|supabase" packages/shared/package.json
```

Expected output:
```
"@supabase/supabase-js": "^...",
"sharp": "^...",
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/package.json bun.lockb
git commit -m "chore: add sharp and @supabase/supabase-js to packages/shared"
```

---

## Task 3: Add `CharacterPicture` Prisma model

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the model and update existing relations**

In `prisma/schema.prisma`, add the `pictures` relation to `Character`, `characterPictures` relation to `User`, and the new model:

```prisma
model User {
  id         String      @id @db.Uuid
  email      String      @unique
  createdAt  DateTime    @default(now()) @map("created_at")
  updatedAt  DateTime    @updatedAt @map("updated_at")
  characters Character[]
  conversations Conversation[]
  agentSessions AgentSession[]
  conversationJobs ConversationJob[]
  llmUsages        LlmUsage[]
  characterPictures CharacterPicture[]

  @@map("users")
}

model Character {
  id         String    @id @default(uuid()) @db.Uuid
  userId     String    @db.Uuid @map("user_id")
  name       String
  sheet      Json
  createdAt  DateTime  @default(now()) @map("created_at")
  updatedAt  DateTime  @updatedAt @map("updated_at")
  archivedAt DateTime? @map("archived_at")

  user                     User                     @relation(fields: [userId], references: [id], onDelete: Cascade)
  conversationParticipants ConversationParticipant[]
  messages                 Message[]
  pictures                 CharacterPicture[]

  @@map("characters")
}
```

Then add the new model at the end of the file (before the final closing):

```prisma
model CharacterPicture {
  id          String    @id @default(uuid()) @db.Uuid
  userId      String    @db.Uuid @map("user_id")
  characterId String    @db.Uuid @map("character_id")
  size        Int
  url         String
  storagePath String    @map("storage_path")

  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  character Character @relation(fields: [characterId], references: [id], onDelete: Cascade)

  @@unique([characterId, size])
  @@index([userId])
  @@map("character_pictures")
}
```

- [ ] **Step 2: Run migration**

```bash
bun run prisma:migrate:dev
```

When prompted for a migration name, enter: `add_character_pictures`

Expected: migration created and applied successfully.

- [ ] **Step 3: Regenerate Prisma client**

```bash
bun run prisma:generate
```

Expected: "Generated Prisma Client" for both frontend and mcp_server outputs.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add CharacterPicture model to Prisma schema"
```

---

## Task 4: Update Zod schemas

**Files:**
- Modify: `packages/shared/schema/character_search.ts`
- Modify: `packages/shared/schema/character_saved.ts`
- Modify: `packages/shared/index.ts`

- [ ] **Step 1: Make `imageUrl` optional in `CharacterSearchResultSchema`**

In `packages/shared/schema/character_search.ts`, change the `CharacterSearchResultShape`:

```ts
const CharacterSearchResultShape = {
  name: z.string(),
  imageUrl: z.string().nullable().optional(),
  shortDescription: z.string(),
  firstAppearanceDate: z.string().nullable(),
  personality: CharacterPersonalitySchema,
} as const;
```

(`CharacterBasicsSchema` keeps `imageUrl` required — it is the Exa intermediate result, unchanged.)

- [ ] **Step 2: Add `CharacterPictureSchema` and update `SavedCharacterRecordSchema`**

In `packages/shared/schema/character_saved.ts`, add after the imports:

```ts
export const CharacterPictureSchema = z.object({
  size: z.number().int(),
  url: z.string(),
});
export type CharacterPicture = z.infer<typeof CharacterPictureSchema>;
```

Update `SavedCharacterRecordSchema`:

```ts
export const SavedCharacterRecordSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  name: z.string(),
  sheet: CharacterSearchResultSchema,
  pictures: z.array(CharacterPictureSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().datetime().nullable(),
});
export type SavedCharacterRecord = z.infer<typeof SavedCharacterRecordSchema>;
```

Add optional `imageUrl` to `CharacterUpdateInputShape` (at top level, separate from `sheet`, so handlers can process a new picture on update):

```ts
export const CharacterUpdateInputShape = {
  id: uuidSchema,
  imageUrl: z.string().nullable().optional(),
  sheet: CharacterSearchResultSchema,
} as const;
```

- [ ] **Step 3: Export new types from `packages/shared/index.ts`**

Add to the character_saved exports block:

```ts
export {
  CharacterSaveInputShape,
  CharacterSaveInputSchema,
  type CharacterSaveInput,
  CharacterUpdateInputShape,
  CharacterUpdateInputSchema,
  type CharacterUpdateInput,
  CharacterDeleteInputShape,
  CharacterDeleteInputSchema,
  type CharacterDeleteInput,
  CharacterPictureSchema,
  type CharacterPicture,
  SavedCharacterRecordSchema,
  type SavedCharacterRecord,
  CharacterArchiveInputSchema,
  type CharacterArchiveInput,
  CharacterDbSearchInputShape,
  CharacterDbSearchInputSchema,
  type CharacterDbSearchInput,
} from "./schema/character_saved";
```

- [ ] **Step 4: Run typecheck to see what breaks (expected)**

```bash
bun run typecheck
```

Expected: errors in `character.service.ts`, both API routes, both MCP tools, `CharacterCard.tsx`, `CharacterFormWizard.tsx` — these are fixed in subsequent tasks.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/schema/character_search.ts packages/shared/schema/character_saved.ts packages/shared/index.ts
git commit -m "feat: add CharacterPictureSchema, make imageUrl optional in CharacterSearchResult"
```

---

## Task 5: Implement `character_picture.service.ts`

**Files:**
- Create: `packages/shared/services/character_picture.service.ts`
- Create: `packages/shared/services/character_picture.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/services/character_picture.service.test.ts`:

```ts
import { mock } from "bun:test";

// Mocks must be declared before the import they affect.
const mockToBuffer = mock(async () => Buffer.from("processed-webp"));
const mockWebp = mock(() => ({ toBuffer: mockToBuffer }));
const mockResize = mock(() => ({ webp: mockWebp }));
const mockSharp = mock(() => ({ resize: mockResize }));
mock.module("sharp", () => ({ default: mockSharp }));

const mockUpload = mock(async () => ({ data: {}, error: null }));
const mockGetPublicUrl = mock((path: string) => ({
  data: { publicUrl: `https://storage.test/${path}` },
}));
const mockStorageFrom = mock(() => ({ upload: mockUpload, getPublicUrl: mockGetPublicUrl }));
mock.module("@supabase/supabase-js", () => ({
  createClient: mock(() => ({ storage: { from: mockStorageFrom } })),
}));

import { describe, test, expect, beforeEach } from "bun:test";
import { processAndStorePictures } from "./character_picture.service";

const mockUpsert = mock(async (_args: unknown) => ({
  id: "pic-id",
  size: 512,
  url: "https://storage.test/uid/cid/512.webp",
  storagePath: "uid/cid/512.webp",
}));

const prismaLike = {
  characterPicture: { upsert: mockUpsert },
};

const config = {
  supabaseUrl: "https://test.supabase.co",
  supabaseServiceRoleKey: "test-service-key",
};

const imageResponse = {
  ok: true,
  headers: { get: (h: string) => (h === "content-type" ? "image/jpeg" : null) },
  arrayBuffer: async () => new ArrayBuffer(8),
};

beforeEach(() => {
  mockUpsert.mockClear();
  mockUpload.mockClear();
  mockToBuffer.mockClear();
  mockSharp.mockClear();
});

describe("processAndStorePictures", () => {
  test("throws if fetch returns non-ok status", async () => {
    global.fetch = mock(async () => ({
      ok: false,
      status: 404,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(0),
    })) as unknown as typeof fetch;

    await expect(
      processAndStorePictures(prismaLike, "https://example.com/img.jpg", "uid", "cid", config)
    ).rejects.toThrow("Image fetch failed: HTTP 404");
  });

  test("throws if content-type is not an image", async () => {
    global.fetch = mock(async () => ({
      ok: true,
      headers: { get: () => "text/html" },
      arrayBuffer: async () => new ArrayBuffer(8),
    })) as unknown as typeof fetch;

    await expect(
      processAndStorePictures(prismaLike, "https://example.com/page", "uid", "cid", config)
    ).rejects.toThrow("Not an image: text/html");
  });

  test("processes 3 sizes and returns picture array", async () => {
    global.fetch = mock(async () => imageResponse) as unknown as typeof fetch;

    const result = await processAndStorePictures(
      prismaLike,
      "https://example.com/img.jpg",
      "uid",
      "cid",
      config
    );

    expect(result).toHaveLength(3);
    expect(result.map((p) => p.size)).toEqual([48, 128, 512]);
    expect(mockSharp).toHaveBeenCalledTimes(3);
    expect(mockUpload).toHaveBeenCalledTimes(3);
    expect(mockUpsert).toHaveBeenCalledTimes(3);
  });

  test("storage path follows {userId}/{characterId}/{size}.webp pattern", async () => {
    global.fetch = mock(async () => imageResponse) as unknown as typeof fetch;

    await processAndStorePictures(prismaLike, "https://example.com/img.jpg", "user-1", "char-1", config);

    const uploadPaths = mockUpload.mock.calls.map((call) => (call as unknown[])[0]);
    expect(uploadPaths).toEqual(["user-1/char-1/48.webp", "user-1/char-1/128.webp", "user-1/char-1/512.webp"]);
  });

  test("throws if storage upload fails", async () => {
    global.fetch = mock(async () => imageResponse) as unknown as typeof fetch;
    mockUpload.mockResolvedValueOnce({ data: null, error: { message: "quota exceeded" } });

    await expect(
      processAndStorePictures(prismaLike, "https://example.com/img.jpg", "uid", "cid", config)
    ).rejects.toThrow("Storage upload failed for size 48: quota exceeded");
  });

  test("center-crops to square (cover fit) for each size", async () => {
    global.fetch = mock(async () => imageResponse) as unknown as typeof fetch;

    await processAndStorePictures(prismaLike, "https://example.com/img.jpg", "uid", "cid", config);

    const resizeCalls = mockResize.mock.calls as unknown[][];
    expect(resizeCalls[0]).toEqual([48, 48, { fit: "cover" }]);
    expect(resizeCalls[1]).toEqual([128, 128, { fit: "cover" }]);
    expect(resizeCalls[2]).toEqual([512, 512, { fit: "cover" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test packages/shared/services/character_picture.service.test.ts
```

Expected: FAIL — module not found or function not exported.

- [ ] **Step 3: Implement the service**

Create `packages/shared/services/character_picture.service.ts`:

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
  };
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test packages/shared/services/character_picture.service.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/services/character_picture.service.ts packages/shared/services/character_picture.service.test.ts
git commit -m "feat: implement processAndStorePictures service"
```

---

## Task 6: Update `character.service.ts`

**Files:**
- Modify: `packages/shared/services/character.service.ts`

- [ ] **Step 1: Run existing service tests to establish baseline**

```bash
bun test packages/shared/
```

Expected: existing tests pass (except any already broken by Task 4 schema changes).

- [ ] **Step 2: Update `PrismaLike` and type aliases**

In `packages/shared/services/character.service.ts`, replace the existing `PrismaLike` interface and add `PictureRow`:

```ts
import type { InputJsonValue } from "@prisma/client/runtime/client";
import type {
  CharacterSaveInput,
  CharacterPicture,
  CharacterUpdateInput,
  SavedCharacterRecord,
} from "../schema/character_saved";
import { CharacterSearchResultSchema } from "../schema/character_search";
import type { CharacterSearchResult } from "../schema/character_search";

interface CharacterRow {
  id: string;
  userId: string;
  name: string;
  sheet: unknown;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

interface PictureRow {
  characterId: string;
  size: number;
  url: string;
}

interface PrismaLike {
  character: {
    findMany(args: {
      where: { userId: string; archivedAt: null };
      orderBy?: { createdAt: "asc" | "desc" };
    }): Promise<CharacterRow[]>;
    create(args: {
      data: { id?: string; userId: string; name: string; sheet: InputJsonValue };
    }): Promise<CharacterRow>;
    updateMany(args: {
      where: { id: string; userId: string; archivedAt?: null };
      data: { name?: string; sheet?: InputJsonValue; archivedAt?: Date };
    }): Promise<{ count: number }>;
    findFirst(args: { where: { id: string; userId: string } }): Promise<CharacterRow | null>;
  };
  characterPicture: {
    findMany(args: {
      where: { characterId: string } | { characterId: { in: string[] } };
    }): Promise<PictureRow[]>;
  };
}
```

- [ ] **Step 3: Update `toRecord` to accept pictures**

```ts
function toRecord(row: CharacterRow, pictures: PictureRow[]): SavedCharacterRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    sheet: CharacterSearchResultSchema.parse(row.sheet),
    pictures: pictures.map((p) => ({ size: p.size, url: p.url })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}
```

- [ ] **Step 4: Update `listCharacters` to join pictures**

```ts
export async function listCharacters(
  prisma: PrismaLike,
  userId: string
): Promise<SavedCharacterRecord[]> {
  const rows = await prisma.character.findMany({
    where: { userId, archivedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (rows.length === 0) return [];
  const characterIds = rows.map((r) => r.id);
  const allPictures = await prisma.characterPicture.findMany({
    where: { characterId: { in: characterIds } },
  });
  const picturesByChar = allPictures.reduce<Record<string, PictureRow[]>>((acc, p) => {
    (acc[p.characterId] ??= []).push(p);
    return acc;
  }, {});
  return rows.map((r) => toRecord(r, picturesByChar[r.id] ?? []));
}
```

- [ ] **Step 5: Update `saveCharacter` to accept pictures and optional id**

```ts
export async function saveCharacter(
  prisma: PrismaLike,
  userId: string,
  data: Omit<CharacterSaveInput, "imageUrl">,
  pictures: CharacterPicture[] = [],
  id?: string
): Promise<SavedCharacterRecord> {
  const row = await prisma.character.create({
    data: {
      ...(id !== undefined ? { id } : {}),
      userId,
      name: data.name,
      sheet: data as unknown as InputJsonValue,
    },
  });
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    sheet: data as unknown as CharacterSearchResult,
    pictures,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}
```

- [ ] **Step 6: Update `updateCharacter` to strip `imageUrl` and query pictures**

```ts
export async function updateCharacter(
  prisma: PrismaLike,
  userId: string,
  data: { id: string; sheet: Omit<CharacterSearchResult, "imageUrl"> }
): Promise<SavedCharacterRecord | { error: "not_found" } | { error: "archived" }> {
  const existing = await prisma.character.findFirst({ where: { id: data.id, userId } });
  if (!existing) return { error: "not_found" };
  if (existing.archivedAt !== null) return { error: "archived" };
  await prisma.character.updateMany({
    where: { id: data.id, userId, archivedAt: null },
    data: { name: data.sheet.name, sheet: data.sheet as unknown as InputJsonValue },
  });
  const row = await prisma.character.findFirst({ where: { id: data.id, userId } });
  if (row === null) return { error: "not_found" };
  const pictures = await prisma.characterPicture.findMany({ where: { characterId: data.id } });
  return toRecord(row, pictures);
}
```

- [ ] **Step 7: Verify typecheck passes for character.service.ts**

```bash
bun run typecheck 2>&1 | grep "character.service"
```

Expected: no errors from this file.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/services/character.service.ts
git commit -m "feat: extend PrismaLike with characterPicture, update listCharacters/saveCharacter/updateCharacter"
```

---

## Task 7: Update frontend `POST /api/characters`

**Files:**
- Modify: `frontend/app/api/characters/route.ts`

- [ ] **Step 1: Update the POST handler**

Replace the full file content of `frontend/app/api/characters/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import {
  CharacterSaveInputSchema,
  listCharacters,
  saveCharacter,
  type CharacterPicture,
} from "@open-ormus/shared";
import { processAndStorePictures } from "@open-ormus/shared/services/character_picture.service";
import { randomUUID } from "crypto";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const characters = await listCharacters(prisma, user.id);
    return NextResponse.json(characters);
  } catch {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = CharacterSaveInputSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

  const { imageUrl, ...sheetData } = parsed.data;

  let pictures: CharacterPicture[] = [];
  let characterId: string | undefined;

  if (imageUrl) {
    characterId = randomUUID();
    try {
      pictures = await processAndStorePictures(
        prisma,
        imageUrl,
        user.id,
        characterId,
        {
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
          supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        }
      );
    } catch (err) {
      return NextResponse.json(
        { error: `Picture processing failed: ${String(err)}` },
        { status: 422 }
      );
    }
  }

  try {
    const character = await saveCharacter(prisma, user.id, sheetData, pictures, characterId);
    return NextResponse.json(character, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}
```

- [ ] **Step 2: Typecheck this file**

```bash
bun run typecheck 2>&1 | grep "characters/route"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/api/characters/route.ts
git commit -m "feat: call processAndStorePictures in POST /api/characters"
```

---

## Task 8: Update frontend `PUT /api/characters/[id]`

**Files:**
- Modify: `frontend/app/api/characters/[id]/route.ts`

- [ ] **Step 1: Update the PUT handler**

Replace the imports and `PUT` function in `frontend/app/api/characters/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import {
  CharacterUpdateInputSchema,
  CharacterArchiveInputSchema,
  updateCharacter,
  archiveCharacter,
} from "@open-ormus/shared";
import { processAndStorePictures } from "@open-ormus/shared/services/character_picture.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = CharacterUpdateInputSchema.safeParse(
    typeof body === "object" && body !== null ? { ...body, id } : { id }
  );
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

  const { imageUrl, sheet } = parsed.data;

  if (imageUrl) {
    try {
      await processAndStorePictures(
        prisma,
        imageUrl,
        user.id,
        id,
        {
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
          supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        }
      );
    } catch (err) {
      return NextResponse.json(
        { error: `Picture processing failed: ${String(err)}` },
        { status: 422 }
      );
    }
  }

  const { imageUrl: _stripped, ...sheetData } = sheet;

  try {
    const result = await updateCharacter(prisma, user.id, { id, sheet: sheetData });
    if ("error" in result) {
      const status = result.error === "archived" ? 409 : 404;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const idParsed = CharacterArchiveInputSchema.safeParse({ id });
  if (!idParsed.success)
    return NextResponse.json({ error: idParsed.error.issues }, { status: 400 });

  try {
    const result = await archiveCharacter(prisma, user.id, idParsed.data.id);
    if ("error" in result) {
      const status = result.error === "not_found" ? 404 : 409;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck 2>&1 | grep "characters/\[id\]"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "frontend/app/api/characters/[id]/route.ts"
git commit -m "feat: call processAndStorePictures in PUT /api/characters/[id]"
```

---

## Task 9: Update MCP `character_save` tool

**Files:**
- Modify: `mcp_server/src/registry/tools/character_save.ts`
- Modify: `mcp_server/src/registry/tools/character_save.test.ts`

- [ ] **Step 1: Update `character_save.ts`**

Replace the full content of `mcp_server/src/registry/tools/character_save.ts`:

```ts
// mcp_server/src/registry/tools/character_save.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CharacterSaveInputShape,
  type CharacterSaveInput,
  type SavedCharacterRecord,
  type CharacterPicture,
} from "@open-ormus/shared";
import { saveCharacter } from "@open-ormus/shared/services/character.service";
import { processAndStorePictures } from "@open-ormus/shared/services/character_picture.service";
import { prisma } from "../../db.js";
import { userIdStorage } from "../../auth/context.js";
import { randomUUID } from "crypto";

export async function characterSaveHandler(
  args: CharacterSaveInput
): Promise<SavedCharacterRecord> {
  const userId = userIdStorage.getStore();
  if (!userId) throw new Error("userId not in context");

  const { imageUrl, ...sheetData } = args;

  let pictures: CharacterPicture[] = [];
  let characterId: string | undefined;

  if (imageUrl) {
    characterId = randomUUID();
    pictures = await processAndStorePictures(
      prisma,
      imageUrl,
      userId,
      characterId,
      {
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      }
    );
    // throws on failure — character is not saved if picture processing fails
  }

  return saveCharacter(prisma, userId, sheetData, pictures, characterId);
}

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__character_save",
    "Save a character to your collection. Accepts the full character profile returned by character_search.",
    CharacterSaveInputShape,
    async (args: CharacterSaveInput) => ({
      content: [{ type: "text" as const, text: JSON.stringify(await characterSaveHandler(args)) }],
    })
  );
}
```

- [ ] **Step 2: Update `character_save.test.ts`**

Replace the full content of `mcp_server/src/registry/tools/character_save.test.ts`:

```ts
import { mock } from "bun:test";

// Mock processAndStorePictures — skipped when imageUrl is null
mock.module("@open-ormus/shared/services/character_picture.service", () => ({
  processAndStorePictures: mock(async () => []),
}));

const mockCharacterCreate = mock(async () => ({
  id: "00000000-0000-0000-0000-000000000099",
  userId: "test-user",
  name: "Arthur",
  sheet: {
    name: "Arthur",
    shortDescription: "Legendary king",
    firstAppearanceDate: "500 AD",
    personality: {
      personalityTraits: ["brave"],
      backstory: "Born of nobility",
      relationships: {},
      speechPatterns: [],
      values: ["justice"],
      fears: ["failure"],
      goals: ["peace"],
      notableQuotes: [],
      abilities: ["leadership"],
      copingStyle: ["prayer"],
      knowledgeScope: {},
    },
  },
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
}));

mock.module("../../db.js", () => ({
  prisma: {
    character: { create: mockCharacterCreate },
    characterPicture: { findMany: mock(async () => []) },
  },
}));

import { describe, test, expect, beforeEach } from "bun:test";
import { characterSaveHandler } from "./character_save";
import { userIdStorage } from "../../auth/context";

const validInput = {
  name: "Arthur",
  imageUrl: null as string | null,
  shortDescription: "Legendary king",
  firstAppearanceDate: "500 AD",
  personality: {
    personalityTraits: ["brave"],
    backstory: "Born of nobility",
    relationships: {} as Record<string, string>,
    speechPatterns: [] as string[],
    values: ["justice"],
    fears: ["failure"],
    goals: ["peace"],
    notableQuotes: [] as string[],
    abilities: ["leadership"],
    copingStyle: ["prayer"],
    knowledgeScope: {} as Record<string, string>,
  },
};

describe("characterSaveHandler", () => {
  beforeEach(() => {
    mockCharacterCreate.mockClear();
  });

  test("creates character and returns SavedCharacterRecord with pictures array", async () => {
    const result = await userIdStorage.run("test-user", () =>
      characterSaveHandler(validInput)
    );
    expect(result.id).toBe("00000000-0000-0000-0000-000000000099");
    expect(result.name).toBe("Arthur");
    expect(result.pictures).toEqual([]);
    expect(result.createdAt).toBeTruthy();
  });

  test("calls prisma.character.create with correct userId and name", async () => {
    await userIdStorage.run("test-user", () => characterSaveHandler(validInput));
    expect(mockCharacterCreate).toHaveBeenCalledTimes(1);
    const call = mockCharacterCreate.mock.calls[0]?.[0] as {
      data: { userId: string; name: string; sheet: unknown };
    };
    expect(call.data.userId).toBe("test-user");
    expect(call.data.name).toBe("Arthur");
  });

  test("does not include imageUrl in the sheet data passed to create", async () => {
    await userIdStorage.run("test-user", () => characterSaveHandler(validInput));
    const call = mockCharacterCreate.mock.calls[0]?.[0] as {
      data: { sheet: Record<string, unknown> };
    };
    expect(call.data.sheet).not.toHaveProperty("imageUrl");
  });

  test("throws if userId not in context", async () => {
    expect(() => characterSaveHandler(validInput)).toThrow();
  });
});
```

- [ ] **Step 3: Run the tests**

```bash
bun test --cwd mcp_server src/registry/tools/character_save.test.ts
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add mcp_server/src/registry/tools/character_save.ts mcp_server/src/registry/tools/character_save.test.ts
git commit -m "feat: call processAndStorePictures in MCP character_save"
```

---

## Task 10: Update MCP `character_update` tool

**Files:**
- Modify: `mcp_server/src/registry/tools/character_update.ts`
- Modify: `mcp_server/src/registry/tools/character_update.test.ts`

- [ ] **Step 1: Update `character_update.ts`**

Replace the full content of `mcp_server/src/registry/tools/character_update.ts`:

```ts
// mcp_server/src/registry/tools/character_update.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CharacterUpdateInputShape,
  type CharacterUpdateInput,
  type SavedCharacterRecord,
} from "@open-ormus/shared";
import { updateCharacter } from "@open-ormus/shared/services/character.service";
import { processAndStorePictures } from "@open-ormus/shared/services/character_picture.service";
import { prisma } from "../../db.js";
import { userIdStorage } from "../../auth/context.js";

type UpdateResult = SavedCharacterRecord | { error: "not_found" } | { error: "archived" };

export async function characterUpdateHandler(
  args: CharacterUpdateInput
): Promise<UpdateResult> {
  const userId = userIdStorage.getStore();
  if (!userId) throw new Error("userId not in context");

  const { id, imageUrl, sheet } = args;

  if (imageUrl) {
    await processAndStorePictures(
      prisma,
      imageUrl,
      userId,
      id,
      {
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      }
    );
    // throws on failure — update is not applied if picture processing fails
  }

  const { imageUrl: _stripped, ...sheetData } = sheet;
  return updateCharacter(prisma, userId, { id, sheet: sheetData });
}

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__character_update",
    "Update a saved character's full profile. Replaces the existing sheet entirely.",
    CharacterUpdateInputShape,
    async (args: CharacterUpdateInput) => {
      const result = await characterUpdateHandler(args);
      let text: string;
      if ("error" in result) {
        text =
          result.error === "archived"
            ? "Character is archived and cannot be modified."
            : "Character not found.";
      } else {
        text = JSON.stringify(result);
      }
      return { content: [{ type: "text" as const, text }] };
    }
  );
}
```

- [ ] **Step 2: Update `character_update.test.ts`**

Replace the full content of `mcp_server/src/registry/tools/character_update.test.ts`:

```ts
import { mock } from "bun:test";

// Mock processAndStorePictures
mock.module("@open-ormus/shared/services/character_picture.service", () => ({
  processAndStorePictures: mock(async () => []),
}));

const validSheet = {
  name: "Arthur Updated",
  shortDescription: "Updated description",
  firstAppearanceDate: "500 AD",
  personality: {
    personalityTraits: ["wise"],
    backstory: "Changed backstory",
    relationships: {},
    speechPatterns: [],
    values: ["wisdom"],
    fears: ["loss"],
    goals: ["peace"],
    notableQuotes: [],
    abilities: ["strategy"],
    copingStyle: ["meditation"],
    knowledgeScope: {},
  },
};

const baseRow = {
  id: "00000000-0000-0000-0000-000000000001",
  userId: "test-user",
  name: "Arthur Updated",
  sheet: validSheet,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-06-01"),
  archivedAt: null,
};

const mockUpdateMany = mock(async () => ({ count: 1 }));
const mockFindFirst = mock(async () => ({ ...baseRow }));
const mockFindManyPictures = mock(async () => []);

mock.module("../../db.js", () => ({
  prisma: {
    character: {
      updateMany: mockUpdateMany,
      findFirst: mockFindFirst,
    },
    characterPicture: {
      findMany: mockFindManyPictures,
    },
  },
}));

import { describe, test, expect, beforeEach } from "bun:test";
import { characterUpdateHandler } from "./character_update";
import { userIdStorage } from "../../auth/context";

const validInput = {
  id: "00000000-0000-0000-0000-000000000001",
  sheet: validSheet,
};

describe("characterUpdateHandler", () => {
  beforeEach(() => {
    mockUpdateMany.mockClear();
    mockFindFirst.mockClear();
    mockFindManyPictures.mockClear();
  });

  test("updates character and returns updated record with pictures array", async () => {
    const result = await userIdStorage.run("test-user", () =>
      characterUpdateHandler(validInput)
    );
    if ("error" in result) throw new Error("expected success");
    expect(result.name).toBe("Arthur Updated");
    expect(result.archivedAt).toBeNull();
    expect(result.pictures).toEqual([]);
  });

  test("scopes update to current userId", async () => {
    await userIdStorage.run("test-user", () => characterUpdateHandler(validInput));
    const updateCall = mockUpdateMany.mock.calls[0]?.[0] as {
      where: { id: string; userId: string };
    };
    expect(updateCall.where.userId).toBe("test-user");
    expect(updateCall.where.id).toBe("00000000-0000-0000-0000-000000000001");
  });

  test("returns not_found when character does not exist", async () => {
    mockFindFirst.mockImplementationOnce(async () => null);
    const result = await userIdStorage.run("test-user", () =>
      characterUpdateHandler(validInput)
    );
    expect(result).toEqual({ error: "not_found" });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  test("returns archived when character is archived", async () => {
    mockFindFirst.mockImplementationOnce(async () => ({
      ...baseRow,
      archivedAt: new Date("2026-01-15"),
    }));
    const result = await userIdStorage.run("test-user", () =>
      characterUpdateHandler(validInput)
    );
    expect(result).toEqual({ error: "archived" });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  test("throws if userId not in context", async () => {
    expect(() => characterUpdateHandler(validInput)).toThrow();
  });
});
```

- [ ] **Step 3: Run the tests**

```bash
bun test --cwd mcp_server src/registry/tools/character_update.test.ts
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add mcp_server/src/registry/tools/character_update.ts mcp_server/src/registry/tools/character_update.test.ts
git commit -m "feat: call processAndStorePictures in MCP character_update"
```

---

## Task 11: Update `CharacterCard`

**Files:**
- Modify: `frontend/components/characters/CharacterCard.tsx`

- [ ] **Step 1: Update the component to read from `pictures`**

Replace the full content of `frontend/components/characters/CharacterCard.tsx`:

```tsx
"use client";
import type { SavedCharacterRecord } from "@open-ormus/shared";

interface Props {
  character: SavedCharacterRecord;
  onView: (c: SavedCharacterRecord) => void;
  onEdit: (c: SavedCharacterRecord) => void;
  onDelete: (c: SavedCharacterRecord) => void;
}

export function CharacterCard({ character, onView, onEdit, onDelete }: Props) {
  const pictureUrl = character.pictures.find((p) => p.size === 512)?.url;

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4 flex flex-col gap-3 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        {pictureUrl ? (
          <img
            src={pictureUrl}
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
          <p className="text-sm text-zinc-500 mt-1 line-clamp-2">{character.sheet.shortDescription}</p>
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

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck 2>&1 | grep "CharacterCard"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/characters/CharacterCard.tsx
git commit -m "feat: CharacterCard reads picture URL from character.pictures"
```

---

## Task 12: Update `CharacterFormWizard`

**Files:**
- Modify: `frontend/components/characters/CharacterFormWizard.tsx`

- [ ] **Step 1: Update `fromRecord` — use pictures instead of sheet.imageUrl**

Find the `fromRecord` function and update the `imageUrl` field:

```ts
function fromRecord(record: SavedCharacterRecord): FormState {
  const { sheet } = record;
  const p = sheet.personality;
  return {
    name: sheet.name,
    shortDescription: sheet.shortDescription,
    imageUrl: record.pictures.find((pic) => pic.size === 512)?.url ?? "",
    firstAppearanceDate: sheet.firstAppearanceDate ?? "",
    // ... rest unchanged
  };
}
```

- [ ] **Step 2: Update `fromSearchResult` — imageUrl is now optional on CharacterSearchResult**

Find the `fromSearchResult` function and update:

```ts
function fromSearchResult(result: CharacterSearchResult): FormState {
  const p = result.personality;
  return {
    name: result.name,
    shortDescription: result.shortDescription,
    imageUrl: result.imageUrl ?? "",
    firstAppearanceDate: result.firstAppearanceDate ?? "",
    // ... rest unchanged
  };
}
```

(`result.imageUrl` is now `string | null | undefined`; `?? ""` handles all three cases.)

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | grep "CharacterFormWizard"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/characters/CharacterFormWizard.tsx
git commit -m "feat: CharacterFormWizard reads imageUrl from pictures on edit"
```

---

## Task 13: Fix `character_search.service.test.ts`

**Files:**
- Modify: `packages/shared/services/character_search.service.test.ts`

- [ ] **Step 1: Update the imageUrl assertion**

Find line 185:
```ts
expect(result.imageUrl).toBeNull();
```

`imageUrl` is now optional on `CharacterSearchResult`. The Exa handler still returns it from `CharacterBasics`, so it should still be `null` in this test. However the type is now `string | null | undefined`. Update the assertion to handle optional:

```ts
expect(result.imageUrl ?? null).toBeNull();
```

- [ ] **Step 2: Run all shared tests**

```bash
bun test packages/shared/
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/services/character_search.service.test.ts
git commit -m "test: update imageUrl assertion after making field optional"
```

---

## Task 14: Full verification

- [ ] **Step 1: Run all MCP tests**

```bash
bun test --cwd mcp_server
```

Expected: all tests PASS.

- [ ] **Step 2: Run shared tests**

```bash
bun test packages/shared/
```

Expected: all tests PASS.

- [ ] **Step 3: Full typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Build**

```bash
bun run build
```

Expected: build succeeds with no errors.

- [ ] **Step 5: Create the Supabase Storage bucket**

In your Supabase dashboard → Storage → New bucket:
- Name: `character-pictures`
- Public: ✓ (enable public access)
- File size limit: 5 MB (covers 512px WebP comfortably)

- [ ] **Step 6: Commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve typecheck and build issues after character picture storage"
```
