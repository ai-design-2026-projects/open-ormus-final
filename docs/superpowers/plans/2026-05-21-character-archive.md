# Character Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace character deletion with permanent soft-archive — characters become invisible and read-only while preserving FK integrity for messages and conversation participants.

**Architecture:** Add `archivedAt DateTime?` to the `characters` table; all read queries filter `archivedAt IS NULL`; `deleteCharacter` is replaced by `archiveCharacter`; API and MCP surface the same external contract (DELETE verb / same tool ID) with updated semantics.

**Tech Stack:** Prisma 7, Zod v4 (packages/shared), Next.js 16 App Router (frontend), Express 5 + MCP SDK (mcp_server), Bun test runner.

---

## File Map

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `archivedAt DateTime? @map("archived_at")` to `Character` |
| `packages/shared/schema/character_saved.ts` | Add `archivedAt` to `SavedCharacterRecordSchema`; add `CharacterArchiveInputSchema` |
| `packages/shared/index.ts` | Swap `deleteCharacter` → `archiveCharacter`; export new archive schema types |
| `packages/shared/services/character.service.ts` | Update interfaces; filter `listCharacters`; guard `updateCharacter`; add `archiveCharacter`; remove `deleteCharacter` |
| `mcp_server/src/registry/tools/character_list.test.ts` | Assert `archivedAt: null` in `findMany` where; add `archivedAt` to mock row |
| `mcp_server/src/registry/tools/character_update.test.ts` | Fix `findUnique` → `findFirst` mock; add `archivedAt: null` to mock row; add archived test case |
| `mcp_server/src/registry/tools/character_delete.test.ts` | Full rewrite for archive semantics |
| `mcp_server/src/registry/tools/character_delete.ts` | Call `archiveCharacter`; format error text |
| `mcp_server/src/registry/tools/character_update.ts` | Handle `{ error: "archived" }` response |
| `mcp_server/src/registry/tools/character_db_search.ts` | Add `AND archived_at IS NULL` to raw SQL |
| `frontend/app/api/characters/[id]/route.ts` | `DELETE` → `archiveCharacter`; `PUT` → handle 409 for archived |

---

## Task 1: Prisma schema — add `archivedAt` column

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `archivedAt` field to Character model**

  In `prisma/schema.prisma`, add one line inside the `Character` model after `updatedAt`:

  ```prisma
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

    @@map("characters")
  }
  ```

- [ ] **Step 2: Run migration**

  ```bash
  bun run prisma:migrate:dev
  ```

  When prompted for a migration name, enter: `add_character_archived_at`

  Expected: Migration file created, `ALTER TABLE characters ADD COLUMN archived_at TIMESTAMPTZ` applied.

- [ ] **Step 3: Regenerate Prisma client**

  ```bash
  cd frontend && DIRECT_URL="$(grep DIRECT_URL ../.env.local | cut -d'"' -f2)" DATABASE_URL="$(grep '^DATABASE_URL' ../.env.local | cut -d'"' -f2)" bunx prisma generate
  ```

  Expected output ends with: `✔ Generated Prisma Client`

- [ ] **Step 4: Commit**

  ```bash
  git add prisma/schema.prisma prisma/migrations/
  git commit -m "feat: add archivedAt column to characters table"
  ```

---

## Task 2: Shared schema — `SavedCharacterRecordSchema` + `CharacterArchiveInputSchema`

**Files:**
- Modify: `packages/shared/schema/character_saved.ts`

- [ ] **Step 1: Write failing typecheck test**

  Run typecheck — it will pass now. The test is that after this task, the schema exports `CharacterArchiveInputSchema`. Confirm it does NOT exist yet:

  ```bash
  grep -n "CharacterArchiveInputSchema" packages/shared/schema/character_saved.ts
  ```

  Expected: no output.

- [ ] **Step 2: Add `archivedAt` to `SavedCharacterRecordSchema` and add `CharacterArchiveInputSchema`**

  Replace the `SavedCharacterRecordSchema` block and add the archive schema. Final state of the relevant section:

  ```ts
  // DB record returned to callers
  export const SavedCharacterRecordSchema = z.object({
    id: uuidSchema,
    userId: uuidSchema,
    name: z.string(),
    sheet: CharacterSearchResultSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
    archivedAt: z.string().datetime().nullable(),
  });
  export type SavedCharacterRecord = z.infer<typeof SavedCharacterRecordSchema>;

  // Archive input — same shape as delete input, separate for semantic clarity
  export const CharacterArchiveInputSchema = z.object({ id: uuidSchema });
  export type CharacterArchiveInput = z.infer<typeof CharacterArchiveInputSchema>;
  ```

  Leave all other exports in the file unchanged.

- [ ] **Step 3: Verify typecheck passes**

  ```bash
  cd /Users/davide/Documents/uni/large-scale/open-ormus/.claude/worktrees/character-safe-archive && bun run --cwd frontend tsc --noEmit 2>&1 | head -20
  ```

  Expected: no output (0 errors).

- [ ] **Step 4: Commit**

  ```bash
  git add packages/shared/schema/character_saved.ts
  git commit -m "feat: add archivedAt to SavedCharacterRecord and CharacterArchiveInputSchema"
  ```

---

## Task 3: Shared index — swap exports

**Files:**
- Modify: `packages/shared/index.ts`

- [ ] **Step 1: Update character_saved exports**

  In `packages/shared/index.ts`, replace the `character_saved` export block:

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
    CharacterArchiveInputSchema,
    type CharacterArchiveInput,
    SavedCharacterRecordSchema,
    type SavedCharacterRecord,
    CharacterDbSearchInputShape,
    CharacterDbSearchInputSchema,
    type CharacterDbSearchInput,
  } from "./schema/character_saved";
  ```

- [ ] **Step 2: Update services exports**

  In `packages/shared/index.ts`, replace the services export block:

  ```ts
  export {
    listCharacters,
    saveCharacter,
    updateCharacter,
    archiveCharacter,
  } from "./services/character.service";
  ```

  (`deleteCharacter` is removed; `archiveCharacter` is added.)

- [ ] **Step 3: Verify grep**

  ```bash
  grep -n "deleteCharacter\|archiveCharacter" packages/shared/index.ts
  ```

  Expected: one line containing `archiveCharacter`, zero lines containing `deleteCharacter`.

- [ ] **Step 4: Commit**

  ```bash
  git add packages/shared/index.ts
  git commit -m "chore: swap deleteCharacter for archiveCharacter in shared index"
  ```

---

## Task 4: Service — interfaces, `toRecord`, and `listCharacters` filter

**Files:**
- Modify: `packages/shared/services/character.service.ts`
- Test: `mcp_server/src/registry/tools/character_list.test.ts`

- [ ] **Step 1: Write failing test**

  Open `mcp_server/src/registry/tools/character_list.test.ts`. Add `archivedAt: null` to the mock row and add an assertion that `findMany` is called with `archivedAt: null` in the where clause.

  Full updated file:

  ```ts
  import { mock } from "bun:test";

  const mockSheet = {
    name: "Arthur",
    imageUrl: null,
    shortDescription: "Legendary king",
    firstAppearanceDate: "500 AD",
    confidence: 3,
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
  };

  const mockFindMany = mock(async () => [
    {
      id: "00000000-0000-0000-0000-000000000001",
      userId: "test-user",
      name: "Arthur",
      sheet: mockSheet,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
      archivedAt: null,
    },
  ]);

  mock.module("../../db.js", () => ({
    prisma: { character: { findMany: mockFindMany } },
  }));

  import { describe, test, expect, beforeEach } from "bun:test";
  import { characterListHandler } from "./character_list";
  import { userIdStorage } from "../../auth/context";

  describe("characterListHandler", () => {
    beforeEach(() => {
      mockFindMany.mockClear();
    });

    test("returns list of saved characters for current user", async () => {
      const result = await userIdStorage.run("test-user", () =>
        characterListHandler()
      );
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("Arthur");
      expect(result[0]?.id).toBe("00000000-0000-0000-0000-000000000001");
      expect(result[0]?.archivedAt).toBeNull();
    });

    test("queries only active (non-archived) characters for current user", async () => {
      await userIdStorage.run("test-user", () => characterListHandler());
      const call = mockFindMany.mock.calls[0]?.[0] as {
        where: { userId: string; archivedAt: null };
      };
      expect(call.where.userId).toBe("test-user");
      expect(call.where.archivedAt).toBeNull();
    });

    test("returns empty array when user has no characters", async () => {
      mockFindMany.mockImplementation(async () => []);
      const result = await userIdStorage.run("test-user", () =>
        characterListHandler()
      );
      expect(result).toEqual([]);
    });

    test("throws if userId not in context", async () => {
      expect(() => characterListHandler()).toThrow();
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  bun test --cwd mcp_server src/registry/tools/character_list.test.ts
  ```

  Expected: FAIL — `call.where.archivedAt` is `undefined` (filter not yet applied).

- [ ] **Step 3: Update service — `CharacterRow`, `PrismaLike.findMany`, `toRecord`, `listCharacters`**

  In `packages/shared/services/character.service.ts`, make these changes:

  **`CharacterRow` interface** — add `archivedAt`:
  ```ts
  interface CharacterRow {
    id: string;
    userId: string;
    name: string;
    sheet: unknown;
    createdAt: Date;
    updatedAt: Date;
    archivedAt: Date | null;
  }
  ```

  **`PrismaLike.findMany` where** — add `archivedAt: null`:
  ```ts
  findMany(args: {
    where: { userId: string; archivedAt: null };
    orderBy?: { createdAt: "asc" | "desc" };
  }): Promise<CharacterRow[]>;
  ```

  **`toRecord`** — add `archivedAt` field:
  ```ts
  function toRecord(row: CharacterRow): SavedCharacterRecord {
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      sheet: CharacterSearchResultSchema.parse(row.sheet),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      archivedAt: row.archivedAt?.toISOString() ?? null,
    };
  }
  ```

  **`saveCharacter`** — add `archivedAt: null` to its manual return object (new characters are never archived):

  ```ts
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    sheet: data,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: null,
  };
  ```

  **`listCharacters`** — add `archivedAt: null` to where:
  ```ts
  export async function listCharacters(
    prisma: PrismaLike,
    userId: string
  ): Promise<SavedCharacterRecord[]> {
    const rows = await prisma.character.findMany({
      where: { userId, archivedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toRecord);
  }
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  bun test --cwd mcp_server src/registry/tools/character_list.test.ts
  ```

  Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

  ```bash
  git add packages/shared/services/character.service.ts \
          mcp_server/src/registry/tools/character_list.test.ts
  git commit -m "feat: filter archived characters from listCharacters"
  ```

---

## Task 5: Service — `updateCharacter` archive guard

**Files:**
- Modify: `packages/shared/services/character.service.ts`
- Test: `mcp_server/src/registry/tools/character_update.test.ts`

- [ ] **Step 1: Write failing tests**

  Full updated `mcp_server/src/registry/tools/character_update.test.ts`:

  ```ts
  import { mock } from "bun:test";

  const validSheet = {
    name: "Arthur Updated",
    imageUrl: "https://example.com/arthur.jpg",
    shortDescription: "Updated description",
    firstAppearanceDate: "500 AD",
    confidence: 2 as const,
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

  mock.module("../../db.js", () => ({
    prisma: {
      character: {
        updateMany: mockUpdateMany,
        findFirst: mockFindFirst,
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
    });

    test("updates character and returns updated record", async () => {
      const result = await userIdStorage.run("test-user", () =>
        characterUpdateHandler(validInput)
      );
      if ("error" in result) throw new Error("expected success");
      expect(result.name).toBe("Arthur Updated");
      expect(result.sheet.confidence).toBe(2);
      expect(result.archivedAt).toBeNull();
    });

    test("scopes update to current userId", async () => {
      await userIdStorage.run("test-user", () =>
        characterUpdateHandler(validInput)
      );
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

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  bun test --cwd mcp_server src/registry/tools/character_update.test.ts
  ```

  Expected: FAIL — `findFirst` mock not found (service uses `findUnique` currently — existing bug), archived test fails.

- [ ] **Step 3: Update `updateCharacter` in service**

  Replace the `updateCharacter` function body in `packages/shared/services/character.service.ts`:

  ```ts
  export async function updateCharacter(
    prisma: PrismaLike,
    userId: string,
    data: CharacterUpdateInput
  ): Promise<SavedCharacterRecord | { error: "not_found" } | { error: "archived" }> {
    const existing = await prisma.character.findFirst({ where: { id: data.id, userId } });
    if (!existing) return { error: "not_found" };
    if (existing.archivedAt !== null) return { error: "archived" };
    await prisma.character.updateMany({
      where: { id: data.id, userId },
      data: { name: data.sheet.name, sheet: data.sheet as unknown as InputJsonValue },
    });
    const row = await prisma.character.findFirst({ where: { id: data.id, userId } });
    if (row === null) return { error: "not_found" };
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      sheet: data.sheet,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      archivedAt: row.archivedAt?.toISOString() ?? null,
    };
  }
  ```

- [ ] **Step 4: Run tests to verify they pass**

  ```bash
  bun test --cwd mcp_server src/registry/tools/character_update.test.ts
  ```

  Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

  ```bash
  git add packages/shared/services/character.service.ts \
          mcp_server/src/registry/tools/character_update.test.ts
  git commit -m "feat: guard updateCharacter against archived characters"
  ```

---

## Task 6: Service — `archiveCharacter`, remove `deleteCharacter`

**Files:**
- Modify: `packages/shared/services/character.service.ts`
- Test: `mcp_server/src/registry/tools/character_delete.test.ts`

- [ ] **Step 1: Write failing tests**

  Full rewrite of `mcp_server/src/registry/tools/character_delete.test.ts`:

  ```ts
  import { mock } from "bun:test";

  const mockUpdateMany = mock(async () => ({ count: 1 }));
  const mockFindFirst = mock(async () => null);

  mock.module("../../db.js", () => ({
    prisma: {
      character: {
        updateMany: mockUpdateMany,
        findFirst: mockFindFirst,
      },
    },
  }));

  import { describe, test, expect, beforeEach } from "bun:test";
  import { characterDeleteHandler } from "./character_delete";
  import { userIdStorage } from "../../auth/context";

  describe("characterDeleteHandler (archive)", () => {
    beforeEach(() => {
      mockUpdateMany.mockClear();
      mockFindFirst.mockClear();
    });

    test("archives character and returns success", async () => {
      const result = await userIdStorage.run("test-user", () =>
        characterDeleteHandler({ id: "00000000-0000-0000-0000-000000000001" })
      );
      expect(result).toEqual({ success: true });
      expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    });

    test("scopes archive to current userId and filters by archivedAt: null", async () => {
      await userIdStorage.run("test-user", () =>
        characterDeleteHandler({ id: "00000000-0000-0000-0000-000000000001" })
      );
      const updateCall = mockUpdateMany.mock.calls[0]?.[0] as {
        where: { id: string; userId: string; archivedAt: null };
        data: { archivedAt: Date };
      };
      expect(updateCall.where.userId).toBe("test-user");
      expect(updateCall.where.id).toBe("00000000-0000-0000-0000-000000000001");
      expect(updateCall.where.archivedAt).toBeNull();
      expect(updateCall.data.archivedAt).toBeInstanceOf(Date);
    });

    test("returns not_found when no row matches", async () => {
      mockUpdateMany.mockImplementationOnce(async () => ({ count: 0 }));
      // findFirst returns null → not_found
      const result = await userIdStorage.run("test-user", () =>
        characterDeleteHandler({ id: "00000000-0000-0000-0000-000000000001" })
      );
      expect(result).toEqual({ error: "not_found" });
    });

    test("returns already_archived when row exists but is already archived", async () => {
      mockUpdateMany.mockImplementationOnce(async () => ({ count: 0 }));
      mockFindFirst.mockImplementationOnce(async () => ({
        id: "00000000-0000-0000-0000-000000000001",
        userId: "test-user",
        name: "Arthur",
        sheet: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: new Date("2026-01-15"),
      }));
      const result = await userIdStorage.run("test-user", () =>
        characterDeleteHandler({ id: "00000000-0000-0000-0000-000000000001" })
      );
      expect(result).toEqual({ error: "already_archived" });
    });

    test("throws if userId not in context", async () => {
      expect(() =>
        characterDeleteHandler({ id: "00000000-0000-0000-0000-000000000001" })
      ).toThrow();
    });
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  bun test --cwd mcp_server src/registry/tools/character_delete.test.ts
  ```

  Expected: FAIL — `characterDeleteHandler` calls `deleteCharacter` which uses `deleteMany`, not `updateMany`.

- [ ] **Step 3: Update service — `PrismaLike.updateMany`, add `archiveCharacter`, remove `deleteCharacter`**

  **Update `PrismaLike`** — broaden `updateMany` to cover both update and archive patterns; remove `deleteMany`:

  ```ts
  interface PrismaLike {
    character: {
      findMany(args: {
        where: { userId: string; archivedAt: null };
        orderBy?: { createdAt: "asc" | "desc" };
      }): Promise<CharacterRow[]>;
      create(args: {
        data: { userId: string; name: string; sheet: InputJsonValue };
      }): Promise<CharacterRow>;
      updateMany(args: {
        where: { id: string; userId: string; archivedAt?: null };
        data: { name?: string; sheet?: InputJsonValue; archivedAt?: Date };
      }): Promise<{ count: number }>;
      findFirst(args: { where: { id: string; userId: string } }): Promise<CharacterRow | null>;
    };
  }
  ```

  **Add `archiveCharacter`** (at the end of the file, after `deleteCharacter`):

  ```ts
  export async function archiveCharacter(
    prisma: PrismaLike,
    userId: string,
    id: string
  ): Promise<{ success: true } | { error: "not_found" } | { error: "already_archived" }> {
    const result = await prisma.character.updateMany({
      where: { id, userId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (result.count === 0) {
      const existing = await prisma.character.findFirst({ where: { id, userId } });
      if (!existing) return { error: "not_found" };
      return { error: "already_archived" };
    }
    return { success: true };
  }
  ```

  **Remove `deleteCharacter`** — delete the entire function (lines 102–112 in the original file).

- [ ] **Step 4: Run tests to verify they pass**

  ```bash
  bun test --cwd mcp_server src/registry/tools/character_delete.test.ts
  ```

  Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

  ```bash
  git add packages/shared/services/character.service.ts \
          mcp_server/src/registry/tools/character_delete.test.ts
  git commit -m "feat: add archiveCharacter service, remove deleteCharacter"
  ```

---

## Task 7: MCP `character_delete` tool — call `archiveCharacter`, format errors as text

**Files:**
- Modify: `mcp_server/src/registry/tools/character_delete.ts`

- [ ] **Step 1: Replace the entire file**

  ```ts
  // mcp_server/src/registry/tools/character_delete.ts
  import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
  import {
    CharacterDeleteInputShape,
    type CharacterDeleteInput,
  } from "@open-ormus/shared";
  import { archiveCharacter } from "@open-ormus/shared/services/character.service";
  import { prisma } from "../../db.js";
  import { userIdStorage } from "../../auth/context.js";

  type ArchiveResult =
    | { success: true }
    | { error: "not_found" }
    | { error: "already_archived" };

  export async function characterDeleteHandler(
    args: CharacterDeleteInput
  ): Promise<ArchiveResult> {
    const userId = userIdStorage.getStore();
    if (!userId) throw new Error("userId not in context");
    return archiveCharacter(prisma, userId, args.id);
  }

  export function register(server: McpServer): void {
    server.tool(
      "mcp__openormus__character_delete",
      "Archive a saved character by id. The character is removed from all views and becomes read-only. This action is permanent.",
      CharacterDeleteInputShape,
      async (args: CharacterDeleteInput) => {
        const result = await characterDeleteHandler(args);
        let text: string;
        if ("error" in result) {
          text =
            result.error === "not_found"
              ? "Character not found."
              : "Character already archived.";
        } else {
          text = JSON.stringify(result);
        }
        return { content: [{ type: "text" as const, text }] };
      }
    );
  }
  ```

- [ ] **Step 2: Verify tests still pass**

  ```bash
  bun test --cwd mcp_server src/registry/tools/character_delete.test.ts
  ```

  Expected: PASS (5 tests).

- [ ] **Step 3: Commit**

  ```bash
  git add mcp_server/src/registry/tools/character_delete.ts
  git commit -m "feat: character_delete MCP tool now archives instead of deletes"
  ```

---

## Task 8: MCP `character_update` tool — handle archived error

**Files:**
- Modify: `mcp_server/src/registry/tools/character_update.ts`

- [ ] **Step 1: Update the file**

  Replace the entire file:

  ```ts
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

  type UpdateResult =
    | SavedCharacterRecord
    | { error: "not_found" }
    | { error: "archived" };

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
      async (args: CharacterUpdateInput) => {
        const result = await characterUpdateHandler(args);
        let text: string;
        if ("error" in result && result.error === "archived") {
          text = "Character is archived and cannot be modified.";
        } else {
          text = JSON.stringify(result);
        }
        return { content: [{ type: "text" as const, text }] };
      }
    );
  }
  ```

- [ ] **Step 2: Verify existing tests still pass**

  ```bash
  bun test --cwd mcp_server src/registry/tools/character_update.test.ts
  ```

  Expected: PASS (5 tests).

- [ ] **Step 3: Commit**

  ```bash
  git add mcp_server/src/registry/tools/character_update.ts
  git commit -m "feat: character_update MCP tool returns error text for archived characters"
  ```

---

## Task 9: MCP `character_db_search` — exclude archived from SQL

**Files:**
- Modify: `mcp_server/src/registry/tools/character_db_search.ts`

- [ ] **Step 1: Add `AND archived_at IS NULL` to the WHERE clause**

  In the raw SQL query, add the filter after `WHERE user_id = ${userId}::uuid`:

  ```ts
  const rows = await prisma.$queryRaw<RawRow[]>(Prisma.sql`
    SELECT
      id,
      user_id        AS "userId",
      name,
      sheet,
      created_at     AS "createdAt",
      updated_at     AS "updatedAt",
      GREATEST(
        similarity(name, ${query}),
        similarity(sheet->>'shortDescription', ${query})
      ) AS score
    FROM characters
    WHERE user_id = ${userId}::uuid
      AND archived_at IS NULL
      AND (
        similarity(name, ${query}) > 0.15
        OR similarity(sheet->>'shortDescription', ${query}) > 0.15
      )
    ORDER BY score DESC
    LIMIT ${Prisma.raw(String(limit))}
  `);
  ```

- [ ] **Step 2: Verify existing tests still pass**

  ```bash
  bun test --cwd mcp_server src/registry/tools/character_db_search.test.ts
  ```

  Expected: PASS (4 tests). The mock returns the same rows regardless of SQL; the filter is applied at DB level.

- [ ] **Step 3: Commit**

  ```bash
  git add mcp_server/src/registry/tools/character_db_search.ts
  git commit -m "feat: exclude archived characters from DB search"
  ```

---

## Task 10: API routes — `DELETE` → archive, `PUT` → handle archived 409

**Files:**
- Modify: `frontend/app/api/characters/[id]/route.ts`

- [ ] **Step 1: Replace the entire file**

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

    try {
      const result = await updateCharacter(prisma, user.id, parsed.data);
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

- [ ] **Step 2: Verify typecheck**

  ```bash
  cd /Users/davide/Documents/uni/large-scale/open-ormus/.claude/worktrees/character-safe-archive && bun run --cwd frontend tsc --noEmit 2>&1 | head -20
  ```

  Expected: no output (0 errors).

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/app/api/characters/\[id\]/route.ts
  git commit -m "feat: DELETE /api/characters/[id] archives instead of deletes; PUT returns 409 for archived"
  ```

---

## Task 11: Final verification

- [ ] **Step 1: Run all mcp_server tests**

  ```bash
  bun test --cwd mcp_server 2>&1
  ```

  Expected: all tests pass, 0 failures.

- [ ] **Step 2: Full typecheck**

  ```bash
  cd /Users/davide/Documents/uni/large-scale/open-ormus/.claude/worktrees/character-safe-archive && bun run --cwd frontend tsc --noEmit 2>&1
  ```

  Expected: no output.

- [ ] **Step 3: Build check**

  ```bash
  cd /Users/davide/Documents/uni/large-scale/open-ormus/.claude/worktrees/character-safe-archive/frontend && DIRECT_URL="$(grep DIRECT_URL ../.env.local | cut -d'"' -f2)" DATABASE_URL="$(grep '^DATABASE_URL' ../.env.local | cut -d'"' -f2)" bun run build 2>&1 | tail -10
  ```

  Expected: build succeeds.
