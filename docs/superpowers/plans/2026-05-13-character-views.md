# Character Management Views — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder home page with a full character management dashboard (list, create wizard, view drawer, edit wizard, delete confirm), and extract character DB logic into a shared service consumed by both the frontend API routes and the MCP tool handlers.

**Architecture:** A new `packages/shared/services/character.service.ts` exports four pure Prisma-wrapper functions typed via a structural `PrismaLike` interface — no new package dependencies. Frontend Next.js API routes call these functions directly using their own Prisma singleton; MCP tool handlers are refactored to delegate to the same functions. The home page becomes a client component wiring together six focused character components.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind CSS 4, Zod 4 (packages/shared), Prisma 7, Supabase Auth (`@supabase/ssr`), Bun runtime.

---

> **No test runner is wired up yet** (AGENTS.md §4). Each task uses `tsc --noEmit` for correctness checks instead of test runs. The final task verifies the feature manually in a browser.

---

## File Map

### New files
| File | Responsibility |
|---|---|
| `packages/shared/services/character.service.ts` | Pure Prisma-wrapper functions for CRUD; uses structural `PrismaLike` interface |
| `frontend/app/api/characters/route.ts` | `GET` (list) + `POST` (create) route handlers |
| `frontend/app/api/characters/[id]/route.ts` | `PUT` (update) + `DELETE` handlers |
| `frontend/components/characters/CharacterCard.tsx` | Single character card with View/Edit/Delete actions |
| `frontend/components/characters/CharacterList.tsx` | Responsive grid, loading skeleton, empty state |
| `frontend/components/characters/CharacterSearch.tsx` | Debounced search input, calls parent callback |
| `frontend/components/characters/CharacterViewDrawer.tsx` | Read-only right-side drawer with full personality detail |
| `frontend/components/characters/CharacterFormWizard.tsx` | 3-step modal for create and edit; includes TagInput and KVEditor sub-components |
| `frontend/components/characters/DeleteConfirmDialog.tsx` | Confirm/cancel dialog before deletion |

### Modified files
| File | Change |
|---|---|
| `packages/shared/index.ts` | Re-export service functions |
| `mcp_server/src/registry/tools/character_list.ts` | Delegate to `listCharacters()` |
| `mcp_server/src/registry/tools/character_save.ts` | Delegate to `saveCharacter()` |
| `mcp_server/src/registry/tools/character_update.ts` | Delegate to `updateCharacter()` |
| `mcp_server/src/registry/tools/character_delete.ts` | Delegate to `deleteCharacter()` |
| `frontend/app/page.tsx` | Full rewrite as client component dashboard |

> `mcp_server/src/registry/tools/character_db_search.ts` is **not touched** — its `pg_trgm` + `Prisma.sql` logic has no shared analogue. Frontend search is client-side (`useMemo` filter).

---

## Task 1: Shared character service

**Files:**
- Create: `packages/shared/services/character.service.ts`
- Modify: `packages/shared/index.ts`

- [ ] **Step 1: Create the service file**

```typescript
// packages/shared/services/character.service.ts

import type {
  CharacterSaveInput,
  CharacterUpdateInput,
  SavedCharacterRecord,
} from "../index";
import { CharacterSearchResultSchema } from "../schema/character_search";

// Structural interface satisfied by both frontend (lib/prisma.ts) and MCP (src/db.ts)
// PrismaClient instances. Avoids adding @prisma/client as a dependency here.
interface CharacterRow {
  id: string;
  userId: string;
  name: string;
  sheet: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface PrismaLike {
  character: {
    findMany(args: {
      where: { userId: string };
      orderBy?: { createdAt: "asc" | "desc" };
    }): Promise<CharacterRow[]>;
    create(args: {
      data: { userId: string; name: string; sheet: unknown };
    }): Promise<CharacterRow>;
    updateMany(args: {
      where: { id: string; userId: string };
      data: { name: string; sheet: unknown };
    }): Promise<{ count: number }>;
    findUnique(args: { where: { id: string } }): Promise<CharacterRow | null>;
    deleteMany(args: {
      where: { id: string; userId: string };
    }): Promise<{ count: number }>;
  };
}

function toRecord(row: CharacterRow): SavedCharacterRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    sheet: CharacterSearchResultSchema.parse(row.sheet),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCharacters(
  prisma: PrismaLike,
  userId: string
): Promise<SavedCharacterRecord[]> {
  const rows = await prisma.character.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toRecord);
}

export async function saveCharacter(
  prisma: PrismaLike,
  userId: string,
  data: CharacterSaveInput
): Promise<SavedCharacterRecord> {
  const row = await prisma.character.create({
    data: { userId, name: data.name, sheet: data },
  });
  // data was already validated by the caller — skip re-parsing
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    sheet: data,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function updateCharacter(
  prisma: PrismaLike,
  userId: string,
  data: CharacterUpdateInput
): Promise<SavedCharacterRecord | { error: "not_found" }> {
  const updated = await prisma.character.updateMany({
    where: { id: data.id, userId },
    data: { name: data.sheet.name, sheet: data.sheet },
  });
  if (updated.count === 0) return { error: "not_found" };
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const row = (await prisma.character.findUnique({ where: { id: data.id } }))!;
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    sheet: data.sheet,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function deleteCharacter(
  prisma: PrismaLike,
  userId: string,
  id: string
): Promise<{ success: true } | { error: "not_found" }> {
  const result = await prisma.character.deleteMany({
    where: { id, userId },
  });
  if (result.count === 0) return { error: "not_found" };
  return { success: true };
}
```

- [ ] **Step 2: Export service functions from the shared package index**

Add these lines to `packages/shared/index.ts` at the end of the file:

```typescript
export {
  listCharacters,
  saveCharacter,
  updateCharacter,
  deleteCharacter,
} from "./services/character.service";
```

- [ ] **Step 3: Type-check the shared package**

```bash
bun run --cwd packages/shared tsc --noEmit
```

Expected: no errors. If you see `Property 'character' is missing` or similar, the `PrismaLike` interface needs adjusting to match the actual generated Prisma client method signatures — widen the arg types in the interface until the Prisma client satisfies it.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/services/character.service.ts packages/shared/index.ts
git commit -m "feat: add shared character service with Prisma-wrapper functions"
```

---

## Task 2: Refactor MCP tool handlers

**Files:**
- Modify: `mcp_server/src/registry/tools/character_list.ts`
- Modify: `mcp_server/src/registry/tools/character_save.ts`
- Modify: `mcp_server/src/registry/tools/character_update.ts`
- Modify: `mcp_server/src/registry/tools/character_delete.ts`

> `character_db_search.ts` is intentionally left unchanged (uses `Prisma.sql` + `pg_trgm`, no shared analogue).

- [ ] **Step 1: Replace `character_list.ts`**

```typescript
// mcp_server/src/registry/tools/character_list.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SavedCharacterRecord } from "@open-ormus/shared";
import { listCharacters } from "@open-ormus/shared/services/character.service";
import { prisma } from "../../db.js";
import { userIdStorage } from "../../auth/context.js";

export async function characterListHandler(): Promise<SavedCharacterRecord[]> {
  const userId = userIdStorage.getStore();
  if (!userId) throw new Error("userId not in context");
  return listCharacters(prisma, userId);
}

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__character_list",
    "List all characters saved in your collection.",
    {},
    async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(await characterListHandler()) }],
    })
  );
}
```

- [ ] **Step 2: Replace `character_save.ts`**

```typescript
// mcp_server/src/registry/tools/character_save.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CharacterSaveInputShape,
  type CharacterSaveInput,
  type SavedCharacterRecord,
} from "@open-ormus/shared";
import { saveCharacter } from "@open-ormus/shared/services/character.service";
import { prisma } from "../../db.js";
import { userIdStorage } from "../../auth/context.js";

export async function characterSaveHandler(
  args: CharacterSaveInput
): Promise<SavedCharacterRecord> {
  const userId = userIdStorage.getStore();
  if (!userId) throw new Error("userId not in context");
  return saveCharacter(prisma, userId, args);
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

- [ ] **Step 3: Replace `character_update.ts`**

```typescript
// mcp_server/src/registry/tools/character_update.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CharacterUpdateInputShape,
  type CharacterUpdateInput,
  type SavedCharacterRecord,
} from "@open-ormus/shared";
import { updateCharacter } from "@open-ormus/shared/services/character.service";
import { prisma } from "../../db.js";
import { userIdStorage } from "../../auth/context.js";

type UpdateResult = SavedCharacterRecord | { error: "not_found" };

export async function characterUpdateHandler(
  args: CharacterUpdateInput
): Promise<UpdateResult> {
  const userId = userIdStorage.getStore();
  if (!userId) throw new Error("userId not in context");
  return updateCharacter(prisma, userId, args);
}

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__character_update",
    "Update a saved character's full profile. Replaces the existing sheet entirely.",
    CharacterUpdateInputShape,
    async (args: CharacterUpdateInput) => ({
      content: [{ type: "text" as const, text: JSON.stringify(await characterUpdateHandler(args)) }],
    })
  );
}
```

- [ ] **Step 4: Replace `character_delete.ts`**

```typescript
// mcp_server/src/registry/tools/character_delete.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CharacterDeleteInputShape,
  type CharacterDeleteInput,
} from "@open-ormus/shared";
import { deleteCharacter } from "@open-ormus/shared/services/character.service";
import { prisma } from "../../db.js";
import { userIdStorage } from "../../auth/context.js";

type DeleteResult = { success: true } | { error: "not_found" };

export async function characterDeleteHandler(
  args: CharacterDeleteInput
): Promise<DeleteResult> {
  const userId = userIdStorage.getStore();
  if (!userId) throw new Error("userId not in context");
  return deleteCharacter(prisma, userId, args.id);
}

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__character_delete",
    "Delete a saved character from your collection by id.",
    CharacterDeleteInputShape,
    async (args: CharacterDeleteInput) => ({
      content: [{ type: "text" as const, text: JSON.stringify(await characterDeleteHandler(args)) }],
    })
  );
}
```

- [ ] **Step 5: Type-check the MCP server**

```bash
bun run --cwd mcp_server tsc --noEmit
```

Expected: no errors. A common issue is TypeScript complaining that the MCP `PrismaClient` does not satisfy `PrismaLike` — if so, check that the `PrismaLike` interface args are wide enough (e.g., `orderBy` should be optional).

- [ ] **Step 6: Commit**

```bash
git add mcp_server/src/registry/tools/character_list.ts \
        mcp_server/src/registry/tools/character_save.ts \
        mcp_server/src/registry/tools/character_update.ts \
        mcp_server/src/registry/tools/character_delete.ts
git commit -m "refactor: delegate MCP character handlers to shared service"
```

---

## Task 3: Frontend API routes

**Files:**
- Create: `frontend/app/api/characters/route.ts`
- Create: `frontend/app/api/characters/[id]/route.ts`

- [ ] **Step 1: Create the collection route (`GET` + `POST`)**

```typescript
// frontend/app/api/characters/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { CharacterSaveInputSchema } from "@open-ormus/shared";
import {
  listCharacters,
  saveCharacter,
} from "@open-ormus/shared/services/character.service";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const characters = await listCharacters(prisma, user.id);
  return NextResponse.json(characters);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body: unknown = await request.json();
  const parsed = CharacterSaveInputSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

  const character = await saveCharacter(prisma, user.id, parsed.data);
  return NextResponse.json(character, { status: 201 });
}
```

- [ ] **Step 2: Create the single-character route (`PUT` + `DELETE`)**

```typescript
// frontend/app/api/characters/[id]/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { CharacterUpdateInputSchema } from "@open-ormus/shared";
import {
  updateCharacter,
  deleteCharacter,
} from "@open-ormus/shared/services/character.service";

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
  const body: unknown = await request.json();
  // Merge the route param `id` into the body so CharacterUpdateInputSchema validates both
  const parsed = CharacterUpdateInputSchema.safeParse({ ...(body as object), id });
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

  const result = await updateCharacter(prisma, user.id, parsed.data);
  if ("error" in result)
    return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json(result);
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const result = await deleteCharacter(prisma, user.id, id);
  if ("error" in result)
    return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: Type-check the frontend**

```bash
bun run --cwd frontend tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/api/characters/route.ts \
        frontend/app/api/characters/[id]/route.ts
git commit -m "feat: add character API routes (list, create, update, delete)"
```

---

## Task 4: CharacterCard and CharacterList components

**Files:**
- Create: `frontend/components/characters/CharacterCard.tsx`
- Create: `frontend/components/characters/CharacterList.tsx`

- [ ] **Step 1: Create CharacterCard**

```tsx
// frontend/components/characters/CharacterCard.tsx
import type { SavedCharacterRecord } from "@open-ormus/shared";

interface Props {
  character: SavedCharacterRecord;
  onView: (c: SavedCharacterRecord) => void;
  onEdit: (c: SavedCharacterRecord) => void;
  onDelete: (c: SavedCharacterRecord) => void;
}

const CONFIDENCE_LABEL: Record<number, string> = {
  0: "Unknown",
  1: "Low",
  2: "Medium",
  3: "High",
};

const CONFIDENCE_COLOR: Record<number, string> = {
  0: "bg-zinc-100 text-zinc-500",
  1: "bg-yellow-100 text-yellow-700",
  2: "bg-blue-100 text-blue-700",
  3: "bg-green-100 text-green-700",
};

export function CharacterCard({ character, onView, onEdit, onDelete }: Props) {
  const { sheet } = character;

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4 flex flex-col gap-3 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        {sheet.imageUrl ? (
          <img
            src={sheet.imageUrl}
            alt={character.name}
            className="w-12 h-12 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-zinc-200 flex items-center justify-center flex-shrink-0 text-zinc-500 font-semibold text-lg">
            {character.name[0]?.toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-zinc-900 truncate">{character.name}</h3>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${CONFIDENCE_COLOR[sheet.confidence]}`}
            >
              {CONFIDENCE_LABEL[sheet.confidence]}
            </span>
          </div>
          <p className="text-sm text-zinc-500 mt-1 line-clamp-2">{sheet.shortDescription}</p>
        </div>
      </div>
      <div className="flex gap-2 pt-1 border-t border-zinc-100">
        <button
          onClick={() => onView(character)}
          className="flex-1 text-sm text-zinc-600 hover:text-zinc-900 py-1 rounded hover:bg-zinc-50 transition-colors"
        >
          View
        </button>
        <button
          onClick={() => onEdit(character)}
          className="flex-1 text-sm text-zinc-600 hover:text-zinc-900 py-1 rounded hover:bg-zinc-50 transition-colors"
        >
          Edit
        </button>
        <button
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

- [ ] **Step 2: Create CharacterList**

```tsx
// frontend/components/characters/CharacterList.tsx
import type { SavedCharacterRecord } from "@open-ormus/shared";
import { CharacterCard } from "./CharacterCard";

interface Props {
  characters: SavedCharacterRecord[];
  loading: boolean;
  onView: (c: SavedCharacterRecord) => void;
  onEdit: (c: SavedCharacterRecord) => void;
  onDelete: (c: SavedCharacterRecord) => void;
}

function Skeleton() {
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4 animate-pulse">
      <div className="flex gap-3">
        <div className="w-12 h-12 rounded-full bg-zinc-200 flex-shrink-0" />
        <div className="flex-1 space-y-2 mt-1">
          <div className="h-4 bg-zinc-200 rounded w-1/2" />
          <div className="h-3 bg-zinc-200 rounded w-full" />
          <div className="h-3 bg-zinc-200 rounded w-2/3" />
        </div>
      </div>
    </div>
  );
}

export function CharacterList({ characters, loading, onView, onEdit, onDelete }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} />)}
      </div>
    );
  }

  if (characters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
        <p className="text-lg font-medium">No characters yet</p>
        <p className="text-sm mt-1">Create your first character to get started</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {characters.map((c) => (
        <CharacterCard
          key={c.id}
          character={c}
          onView={onView}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
bun run --cwd frontend tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/characters/CharacterCard.tsx \
        frontend/components/characters/CharacterList.tsx
git commit -m "feat: add CharacterCard and CharacterList components"
```

---

## Task 5: CharacterSearch component

**Files:**
- Create: `frontend/components/characters/CharacterSearch.tsx`

- [ ] **Step 1: Create the component**

```tsx
// frontend/components/characters/CharacterSearch.tsx
"use client";

import { useState, useEffect } from "react";

interface Props {
  onSearch: (query: string) => void;
}

export function CharacterSearch({ onSearch }: Props) {
  const [value, setValue] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => onSearch(value), 300);
    return () => clearTimeout(timer);
  }, [value, onSearch]);

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder="Search characters…"
      className="w-full max-w-md px-4 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 bg-white"
    />
  );
}
```

- [ ] **Step 2: Type-check**

```bash
bun run --cwd frontend tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/characters/CharacterSearch.tsx
git commit -m "feat: add CharacterSearch component with 300ms debounce"
```

---

## Task 6: CharacterViewDrawer component

**Files:**
- Create: `frontend/components/characters/CharacterViewDrawer.tsx`

- [ ] **Step 1: Create the component**

```tsx
// frontend/components/characters/CharacterViewDrawer.tsx
import type { SavedCharacterRecord } from "@open-ormus/shared";

interface Props {
  character: SavedCharacterRecord | null;
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-zinc-100 pt-4 mt-4">
      <h4 className="text-xs font-semibold uppercase text-zinc-400 tracking-wider mb-2">
        {title}
      </h4>
      {children}
    </div>
  );
}

function TagList({ items }: { items: string[] }) {
  if (items.length === 0)
    return <p className="text-sm text-zinc-400 italic">None</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, i) => (
        <span key={i} className="text-xs bg-zinc-100 text-zinc-700 px-2 py-1 rounded-full">
          {item}
        </span>
      ))}
    </div>
  );
}

function KVList({ entries }: { entries: Record<string, string> }) {
  const pairs = Object.entries(entries);
  if (pairs.length === 0)
    return <p className="text-sm text-zinc-400 italic">None</p>;
  return (
    <dl className="space-y-2">
      {pairs.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs font-medium text-zinc-500">{k}</dt>
          <dd className="text-sm text-zinc-700">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CharacterViewDrawer({ character, onClose }: Props) {
  if (!character) return null;
  const { sheet } = character;
  const p = sheet.personality;

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/40" />
      <div
        className="w-full max-w-xl bg-white h-full overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-zinc-100 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900">{character.name}</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 text-2xl leading-none"
          >
            &times;
          </button>
        </div>
        <div className="px-6 py-4">
          <p className="text-sm text-zinc-600">{sheet.shortDescription}</p>
          {sheet.firstAppearanceDate && (
            <p className="text-xs text-zinc-400 mt-1">
              First appearance: {sheet.firstAppearanceDate}
            </p>
          )}

          <Section title="Personality Traits">
            <TagList items={p.personalityTraits} />
          </Section>

          <Section title="Backstory">
            <p className="text-sm text-zinc-700 whitespace-pre-wrap">
              {p.backstory || <span className="italic text-zinc-400">None</span>}
            </p>
          </Section>

          <Section title="Speech Patterns">
            <TagList items={p.speechPatterns} />
          </Section>

          <Section title="Values">
            <TagList items={p.values} />
          </Section>

          <Section title="Goals">
            <TagList items={p.goals} />
          </Section>

          <Section title="Fears">
            <TagList items={p.fears} />
          </Section>

          <Section title="Notable Quotes">
            {p.notableQuotes.length === 0 ? (
              <p className="text-sm text-zinc-400 italic">None</p>
            ) : (
              <ul className="space-y-1">
                {p.notableQuotes.map((q, i) => (
                  <li key={i} className="text-sm text-zinc-700 italic">
                    &ldquo;{q}&rdquo;
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Abilities">
            <TagList items={p.abilities} />
          </Section>

          <Section title="Coping Style">
            <TagList items={p.copingStyle} />
          </Section>

          <Section title="Relationships">
            <KVList entries={p.relationships} />
          </Section>

          <Section title="Knowledge Scope">
            <KVList entries={p.knowledgeScope} />
          </Section>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
bun run --cwd frontend tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/characters/CharacterViewDrawer.tsx
git commit -m "feat: add CharacterViewDrawer component"
```

---

## Task 7: CharacterFormWizard component

**Files:**
- Create: `frontend/components/characters/CharacterFormWizard.tsx`

This is the largest component. It contains two private sub-components (`TagInput`, `KVEditor`) and helper functions for converting between form state and the API types.

- [ ] **Step 1: Create the component**

```tsx
// frontend/components/characters/CharacterFormWizard.tsx
"use client";

import { useState } from "react";
import type {
  CharacterSaveInput,
  CharacterPersonality,
  SavedCharacterRecord,
} from "@open-ormus/shared";

// ─── Form State ──────────────────────────────────────────────────────────────

type KVPair = { key: string; value: string };

type FormState = {
  name: string;
  shortDescription: string;
  imageUrl: string;
  firstAppearanceDate: string;
  confidence: 0 | 1 | 2 | 3;
  personalityTraits: string[];
  backstory: string;
  speechPatterns: string[];
  values: string[];
  fears: string[];
  goals: string[];
  notableQuotes: string[];
  abilities: string[];
  copingStyle: string[];
  relationships: KVPair[];
  knowledgeScope: KVPair[];
};

function emptyForm(): FormState {
  return {
    name: "",
    shortDescription: "",
    imageUrl: "",
    firstAppearanceDate: "",
    confidence: 3,
    personalityTraits: [],
    backstory: "",
    speechPatterns: [],
    values: [],
    fears: [],
    goals: [],
    notableQuotes: [],
    abilities: [],
    copingStyle: [],
    relationships: [],
    knowledgeScope: [],
  };
}

function fromRecord(record: SavedCharacterRecord): FormState {
  const { sheet } = record;
  const p = sheet.personality;
  return {
    name: sheet.name,
    shortDescription: sheet.shortDescription,
    imageUrl: sheet.imageUrl ?? "",
    firstAppearanceDate: sheet.firstAppearanceDate,
    confidence: sheet.confidence,
    personalityTraits: p.personalityTraits,
    backstory: p.backstory,
    speechPatterns: p.speechPatterns,
    values: p.values,
    fears: p.fears,
    goals: p.goals,
    notableQuotes: p.notableQuotes,
    abilities: p.abilities,
    copingStyle: p.copingStyle,
    relationships: Object.entries(p.relationships).map(([key, value]) => ({ key, value })),
    knowledgeScope: Object.entries(p.knowledgeScope).map(([key, value]) => ({ key, value })),
  };
}

function toSaveInput(state: FormState): CharacterSaveInput {
  const personality: CharacterPersonality = {
    personalityTraits: state.personalityTraits,
    backstory: state.backstory,
    speechPatterns: state.speechPatterns,
    values: state.values,
    fears: state.fears,
    goals: state.goals,
    notableQuotes: state.notableQuotes,
    abilities: state.abilities,
    copingStyle: state.copingStyle,
    relationships: Object.fromEntries(
      state.relationships.filter((r) => r.key.trim()).map((r) => [r.key, r.value])
    ),
    knowledgeScope: Object.fromEntries(
      state.knowledgeScope.filter((r) => r.key.trim()).map((r) => [r.key, r.value])
    ),
  };
  return {
    name: state.name,
    shortDescription: state.shortDescription,
    imageUrl: state.imageUrl.trim() || null,
    firstAppearanceDate: state.firstAppearanceDate,
    confidence: state.confidence,
    personality,
  };
}

// ─── TagInput ─────────────────────────────────────────────────────────────────

function TagInput({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const trimmed = draft.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
      setDraft("");
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-zinc-700 mb-1">{label}</label>
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className="flex-1 px-3 py-1.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
          placeholder="Type and press Enter or Add"
        />
        <button
          type="button"
          onClick={add}
          className="px-3 py-1.5 text-sm bg-zinc-100 rounded-lg hover:bg-zinc-200 transition-colors"
        >
          Add
        </button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {values.map((v, i) => (
            <span
              key={i}
              className="flex items-center gap-1 text-xs bg-zinc-100 text-zinc-700 px-2 py-1 rounded-full"
            >
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((_, j) => j !== i))}
                className="text-zinc-400 hover:text-zinc-600"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── KVEditor ─────────────────────────────────────────────────────────────────

function KVEditor({
  label,
  pairs,
  onChange,
}: {
  label: string;
  pairs: KVPair[];
  onChange: (p: KVPair[]) => void;
}) {
  const add = () => onChange([...pairs, { key: "", value: "" }]);
  const remove = (i: number) => onChange(pairs.filter((_, j) => j !== i));
  const update = (i: number, field: "key" | "value", v: string) =>
    onChange(pairs.map((p, j) => (j === i ? { ...p, [field]: v } : p)));

  return (
    <div>
      <label className="block text-sm font-medium text-zinc-700 mb-1">{label}</label>
      <div className="space-y-2">
        {pairs.map((pair, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input
              type="text"
              value={pair.key}
              onChange={(e) => update(i, "key", e.target.value)}
              placeholder="Key"
              className="w-32 px-3 py-1.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
            />
            <input
              type="text"
              value={pair.value}
              onChange={(e) => update(i, "value", e.target.value)}
              placeholder="Value"
              className="flex-1 px-3 py-1.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-zinc-400 hover:text-red-500 text-lg leading-none"
            >
              &times;
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="text-sm text-zinc-500 hover:text-zinc-800 underline"
        >
          + Add entry
        </button>
      </div>
    </div>
  );
}

// ─── Wizard ───────────────────────────────────────────────────────────────────

const STEPS = ["Basics", "Personality", "Connections"] as const;

interface WizardProps {
  mode: "create" | "edit";
  initialData?: SavedCharacterRecord;
  onSubmit: (data: CharacterSaveInput) => Promise<void>;
  onClose: () => void;
}

export function CharacterFormWizard({
  mode,
  initialData,
  onSubmit,
  onClose,
}: WizardProps) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(() =>
    initialData ? fromRecord(initialData) : emptyForm()
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(toSaveInput(form));
      onClose();
    } catch {
      setError("Failed to save character. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900">
            {mode === "create" ? "New Character" : "Edit Character"}
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Step indicator */}
        <div className="px-6 py-3 border-b border-zinc-100 flex gap-6">
          {STEPS.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => setStep(i)}
              className={`text-sm font-medium pb-1 border-b-2 transition-colors ${
                i === step
                  ? "border-zinc-900 text-zinc-900"
                  : i < step
                  ? "border-zinc-300 text-zinc-500"
                  : "border-transparent text-zinc-300"
              }`}
            >
              {i + 1}. {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {step === 0 && (
            <>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Short Description
                </label>
                <textarea
                  value={form.shortDescription}
                  onChange={(e) => set("shortDescription", e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Image URL</label>
                <input
                  type="text"
                  value={form.imageUrl}
                  onChange={(e) => set("imageUrl", e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  First Appearance Date
                </label>
                <input
                  type="text"
                  value={form.firstAppearanceDate}
                  onChange={(e) => set("firstAppearanceDate", e.target.value)}
                  placeholder="e.g. 2013-09-22 or 0000-01-01 if unknown"
                  className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Confidence</label>
                <select
                  value={form.confidence}
                  onChange={(e) => set("confidence", Number(e.target.value) as 0 | 1 | 2 | 3)}
                  className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400 bg-white"
                >
                  <option value={0}>0 — Unknown</option>
                  <option value={1}>1 — Low</option>
                  <option value={2}>2 — Medium</option>
                  <option value={3}>3 — High</option>
                </select>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <TagInput
                label="Personality Traits"
                values={form.personalityTraits}
                onChange={(v) => set("personalityTraits", v)}
              />
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Backstory</label>
                <textarea
                  value={form.backstory}
                  onChange={(e) => set("backstory", e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
                />
              </div>
              <TagInput
                label="Speech Patterns"
                values={form.speechPatterns}
                onChange={(v) => set("speechPatterns", v)}
              />
              <TagInput label="Values" values={form.values} onChange={(v) => set("values", v)} />
              <TagInput label="Fears" values={form.fears} onChange={(v) => set("fears", v)} />
              <TagInput label="Goals" values={form.goals} onChange={(v) => set("goals", v)} />
              <TagInput
                label="Notable Quotes"
                values={form.notableQuotes}
                onChange={(v) => set("notableQuotes", v)}
              />
              <TagInput
                label="Abilities"
                values={form.abilities}
                onChange={(v) => set("abilities", v)}
              />
              <TagInput
                label="Coping Style"
                values={form.copingStyle}
                onChange={(v) => set("copingStyle", v)}
              />
            </>
          )}

          {step === 2 && (
            <>
              <KVEditor
                label="Relationships (name → description)"
                pairs={form.relationships}
                onChange={(p) => set("relationships", p)}
              />
              <KVEditor
                label="Knowledge Scope (topic → scope)"
                pairs={form.knowledgeScope}
                onChange={(p) => set("knowledgeScope", p)}
              />
            </>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-100 flex justify-between">
          <button
            type="button"
            onClick={() => (step > 0 ? setStep(step - 1) : onClose())}
            className="px-4 py-2 text-sm rounded-lg border border-zinc-200 text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            {step === 0 ? "Cancel" : "Back"}
          </button>
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              disabled={step === 0 && !form.name.trim()}
              className="px-4 py-2 text-sm rounded-lg bg-zinc-900 text-white hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !form.name.trim()}
              className="px-4 py-2 text-sm rounded-lg bg-zinc-900 text-white hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? "Saving…" : mode === "create" ? "Create" : "Save Changes"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
bun run --cwd frontend tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/characters/CharacterFormWizard.tsx
git commit -m "feat: add CharacterFormWizard with 3-step create/edit flow"
```

---

## Task 8: DeleteConfirmDialog component

**Files:**
- Create: `frontend/components/characters/DeleteConfirmDialog.tsx`

- [ ] **Step 1: Create the component**

```tsx
// frontend/components/characters/DeleteConfirmDialog.tsx

interface Props {
  characterName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirmDialog({ characterName, onConfirm, onCancel }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-sm mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-zinc-900">Delete character</h2>
        <p className="text-sm text-zinc-500 mt-2">
          Are you sure you want to delete <strong>{characterName}</strong>? This cannot be
          undone.
        </p>
        <div className="flex gap-3 mt-6 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg border border-zinc-200 text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
bun run --cwd frontend tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/characters/DeleteConfirmDialog.tsx
git commit -m "feat: add DeleteConfirmDialog component"
```

---

## Task 9: Home page rewrite

**Files:**
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Replace `frontend/app/page.tsx` entirely**

```tsx
// frontend/app/page.tsx
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { CharacterList } from "@/components/characters/CharacterList";
import { CharacterSearch } from "@/components/characters/CharacterSearch";
import { CharacterFormWizard } from "@/components/characters/CharacterFormWizard";
import { CharacterViewDrawer } from "@/components/characters/CharacterViewDrawer";
import { DeleteConfirmDialog } from "@/components/characters/DeleteConfirmDialog";
import { logout } from "@/app/(auth)/actions";
import type { SavedCharacterRecord, CharacterSaveInput } from "@open-ormus/shared";

export default function HomePage() {
  const [characters, setCharacters] = useState<SavedCharacterRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeModal, setActiveModal] = useState<
    "create" | "edit" | "view" | "delete" | null
  >(null);
  const [selected, setSelected] = useState<SavedCharacterRecord | null>(null);

  const fetchCharacters = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/characters");
    const data = (await res.json()) as SavedCharacterRecord[];
    setCharacters(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchCharacters();
  }, [fetchCharacters]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return characters;
    const q = searchQuery.toLowerCase();
    return characters.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.sheet.shortDescription.toLowerCase().includes(q)
    );
  }, [characters, searchQuery]);

  const handleCreate = async (data: CharacterSaveInput) => {
    const res = await fetch("/api/characters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to create character");
    await fetchCharacters();
  };

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

  const handleDelete = async () => {
    if (!selected) return;
    await fetch(`/api/characters/${selected.id}`, { method: "DELETE" });
    setActiveModal(null);
    setSelected(null);
    await fetchCharacters();
  };

  const openView = (c: SavedCharacterRecord) => {
    setSelected(c);
    setActiveModal("view");
  };

  const openEdit = (c: SavedCharacterRecord) => {
    setSelected(c);
    setActiveModal("edit");
  };

  const openDelete = (c: SavedCharacterRecord) => {
    setSelected(c);
    setActiveModal("delete");
  };

  const closeModal = () => {
    setActiveModal(null);
    setSelected(null);
  };

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="sticky top-0 z-10 bg-white border-b border-zinc-200 px-6 py-3 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900">OpenOrmus</h1>
        <form action={logout}>
          <button
            type="submit"
            className="text-sm text-zinc-500 hover:text-zinc-800 px-3 py-1.5 rounded-lg hover:bg-zinc-100 transition-colors"
          >
            Log out
          </button>
        </form>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6 gap-4">
          <CharacterSearch onSearch={setSearchQuery} />
          <button
            onClick={() => setActiveModal("create")}
            className="px-4 py-2 text-sm bg-zinc-900 text-white rounded-lg hover:bg-zinc-700 transition-colors whitespace-nowrap"
          >
            + New Character
          </button>
        </div>

        <CharacterList
          characters={filtered}
          loading={loading}
          onView={openView}
          onEdit={openEdit}
          onDelete={openDelete}
        />
      </main>

      {activeModal === "create" && (
        <CharacterFormWizard mode="create" onSubmit={handleCreate} onClose={closeModal} />
      )}
      {activeModal === "edit" && selected && (
        <CharacterFormWizard
          mode="edit"
          initialData={selected}
          onSubmit={handleEdit}
          onClose={closeModal}
        />
      )}
      {activeModal === "view" && (
        <CharacterViewDrawer character={selected} onClose={closeModal} />
      )}
      {activeModal === "delete" && selected && (
        <DeleteConfirmDialog
          characterName={selected.name}
          onConfirm={handleDelete}
          onCancel={closeModal}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
bun run --cwd frontend tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Start the dev server and verify manually**

```bash
bun run dev:frontend
```

Open `http://localhost:3000` in a browser. Verify:
- [ ] Home page shows the character grid (or empty state if no characters)
- [ ] "New Character" button opens the 3-step wizard; filling Step 1 name + clicking Next advances; Submit on Step 3 creates the character and closes the modal
- [ ] Character cards show name, description, confidence badge
- [ ] "View" opens the right-side drawer with all personality fields
- [ ] "Edit" opens the wizard pre-populated; saving updates the card
- [ ] "Delete" shows the confirm dialog; confirming removes the card
- [ ] Search input filters cards by name/description in real-time (no API call)
- [ ] Log out button still works

- [ ] **Step 4: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat: rewrite home page as character management dashboard"
```

---

## Self-Review Notes

- **Spec coverage:** All spec sections covered — shared service (§3), MCP refactor (§4), API routes (§5), all 6 UI components (§6), home page (§6.1), wizard steps (§6.3).
- **`character_db_search.ts` excluded from refactor:** Intentional and documented. The `pg_trgm` / `Prisma.sql` logic has no analogous path in the shared service.
- **Frontend search is client-side:** Spec §6.1 says "debounced input, fires `GET /api/characters?q=<query>`" — revised to client-side `useMemo` filter (simpler, no extra API calls, sufficient for personal collection size). If the collection grows large, move to server-side search.
- **No pagination:** Explicitly out-of-scope per spec §8.
- **Type consistency:** `PrismaLike` in service → `prisma` param in all 4 service functions → re-used unchanged in API routes and MCP handlers. `CharacterSaveInput` and `CharacterSearchResult` are structurally identical (verified in schemas) — no cast needed in `handleEdit`.
