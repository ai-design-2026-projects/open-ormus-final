# Character DB Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `mcp__openormus__character_db_search` MCP tool that searches a user's saved characters by name or short description using PostgreSQL pg_trgm fuzzy similarity.

**Architecture:** Enable the `pg_trgm` extension via a manual Prisma migration, add a Zod input schema to `packages/shared`, implement a new tool file following the existing `register()` pattern, and wire it into the registry. No changes to existing tools.

**Tech Stack:** PostgreSQL `pg_trgm`, Prisma `$queryRaw` (tagged template), `@open-ormus/shared` Zod schemas, `bun:test` for tests, `@modelcontextprotocol/sdk` MCP server.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `prisma/migrations/20260513000000_character_db_search/migration.sql` | Create | Enable pg_trgm extension and GIN indexes |
| `packages/shared/schema/character_saved.ts` | Modify | Add `CharacterDbSearchInputSchema` and inferred type |
| `mcp_server/src/registry/tools/character_db_search.ts` | Create | Handler function + `register()` export |
| `mcp_server/src/registry/tools/character_db_search.test.ts` | Create | Unit tests for the handler |
| `mcp_server/src/registry/registry.ts` | Modify | Import and call `registerCharacterDbSearch` |

---

## Task 1: Create and apply the pg_trgm migration

**Files:**
- Create: `prisma/migrations/20260513000000_character_db_search/migration.sql`

- [ ] **Step 1: Create the migration directory and SQL file**

```bash
mkdir -p prisma/migrations/20260513000000_character_db_search
```

Then create `prisma/migrations/20260513000000_character_db_search/migration.sql`:

```sql
-- Enable pg_trgm for fuzzy string similarity
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN index on character name for fast trigram lookup
CREATE INDEX IF NOT EXISTS idx_characters_name_trgm
  ON characters USING GIN (name gin_trgm_ops);

-- GIN index on shortDescription extracted from the sheet JSONB column
-- Extra parentheses required for expression indexes in PostgreSQL
CREATE INDEX IF NOT EXISTS idx_characters_description_trgm
  ON characters USING GIN ((sheet->>'shortDescription') gin_trgm_ops);
```

- [ ] **Step 2: Apply the migration**

```bash
bun run --cwd frontend prisma migrate dev
```

When prompted for a migration name, enter: `character_db_search`

Expected output includes:
```
Applying migration `20260513000000_character_db_search`
Your database is now in sync with your schema.
```

If Prisma generates a new empty migration after applying yours (because schema.prisma did not change), delete that empty migration directory.

- [ ] **Step 3: Verify indexes exist**

```bash
bun run --cwd frontend prisma migrate status
```

Expected: `20260513000000_character_db_search` listed as Applied.

- [ ] **Step 4: Commit**

```bash
git add prisma/migrations/20260513000000_character_db_search/migration.sql
git commit -m "feat: add pg_trgm extension and GIN indexes for character search"
```

---

## Task 2: Add CharacterDbSearchInputSchema to shared schema

**Files:**
- Modify: `packages/shared/schema/character_saved.ts`

- [ ] **Step 1: Add the schema at the bottom of the file**

Open `packages/shared/schema/character_saved.ts`. The file currently ends at:

```typescript
export const SavedCharacterRecordSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  name: z.string(),
  sheet: CharacterSearchResultSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SavedCharacterRecord = z.infer<typeof SavedCharacterRecordSchema>;
```

Append after that block:

```typescript
// DB search input — fuzzy similarity on name and shortDescription
export const CharacterDbSearchInputShape = {
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(10),
} as const;

export const CharacterDbSearchInputSchema = z.object(CharacterDbSearchInputShape);
export type CharacterDbSearchInput = z.infer<typeof CharacterDbSearchInputSchema>;
```

- [ ] **Step 2: Type-check shared package**

```bash
bun run --cwd packages/shared tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/schema/character_saved.ts
git commit -m "feat: add CharacterDbSearchInputSchema to shared schema"
```

---

## Task 3: Write failing tests for character_db_search handler

**Files:**
- Create: `mcp_server/src/registry/tools/character_db_search.test.ts`

The handler (`characterDbSearchHandler`) does not exist yet. Tests must fail because the import fails.

- [ ] **Step 1: Create the test file**

```typescript
// mcp_server/src/registry/tools/character_db_search.test.ts
import { mock } from "bun:test";

const mockSheet = {
  name: "Spider-Man",
  imageUrl: null,
  shortDescription: "Friendly neighborhood superhero",
  firstAppearanceDate: "1962-08-10",
  confidence: 3,
  personality: {
    personalityTraits: ["brave", "witty"],
    backstory: "Bitten by a radioactive spider",
    relationships: {},
    speechPatterns: [],
    values: ["responsibility"],
    fears: ["losing loved ones"],
    goals: ["protect New York"],
    notableQuotes: ["With great power comes great responsibility"],
    abilities: ["wall-crawling", "web-slinging"],
    copingStyle: ["humor"],
    knowledgeScope: {},
  },
};

const mockRawRow = {
  id: "00000000-0000-0000-0000-000000000001",
  userId: "test-user",
  name: "Spider-Man",
  sheet: mockSheet,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  score: 0.45,
};

const mockQueryRaw = mock(async () => [mockRawRow]);

mock.module("../../db.js", () => ({
  prisma: { $queryRaw: mockQueryRaw },
}));

import { describe, test, expect, beforeEach } from "bun:test";
import { characterDbSearchHandler } from "./character_db_search";
import { userIdStorage } from "../../auth/context";
import type { CharacterDbSearchInput } from "@open-ormus/shared";

describe("characterDbSearchHandler", () => {
  beforeEach(() => {
    mockQueryRaw.mockClear();
  });

  test("returns matched characters shaped as SavedCharacterRecord[]", async () => {
    const input: CharacterDbSearchInput = { query: "spiderman", limit: 10 };
    const result = await userIdStorage.run("test-user", () =>
      characterDbSearchHandler(input)
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(result[0]?.name).toBe("Spider-Man");
    expect(result[0]?.userId).toBe("test-user");
    expect(result[0]?.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result[0]?.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    // score must NOT be present in output
    expect((result[0] as Record<string, unknown>)["score"]).toBeUndefined();
  });

  test("returns empty array when no characters match", async () => {
    mockQueryRaw.mockImplementation(async () => []);
    const result = await userIdStorage.run("test-user", () =>
      characterDbSearchHandler({ query: "zzznomatch", limit: 10 })
    );
    expect(result).toEqual([]);
  });

  test("calls $queryRaw once per invocation", async () => {
    await userIdStorage.run("test-user", () =>
      characterDbSearchHandler({ query: "spider", limit: 5 })
    );
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  test("throws if userId not in context", async () => {
    expect(() =>
      characterDbSearchHandler({ query: "spider", limit: 10 })
    ).toThrow("userId not in context");
  });
});
```

- [ ] **Step 2: Run tests — verify they fail because handler does not exist**

```bash
cd mcp_server && bun test src/registry/tools/character_db_search.test.ts
```

Expected: error such as `Cannot find module './character_db_search'` or similar import failure.

---

## Task 4: Implement character_db_search tool

**Files:**
- Create: `mcp_server/src/registry/tools/character_db_search.ts`

- [ ] **Step 1: Create the tool file**

```typescript
// mcp_server/src/registry/tools/character_db_search.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Prisma } from "../../generated/prisma/client.js";
import {
  CharacterDbSearchInputShape,
  CharacterSearchResultSchema,
  type CharacterDbSearchInput,
  type SavedCharacterRecord,
} from "@open-ormus/shared";
import { prisma } from "../../db.js";
import { userIdStorage } from "../../auth/context.js";

// Shape of a row returned by the raw pg_trgm similarity query.
// Timestamps come back as Date objects from the pg driver.
// score is excluded from the public SavedCharacterRecord output.
type RawRow = {
  id: string;
  userId: string;
  name: string;
  sheet: unknown;
  createdAt: Date;
  updatedAt: Date;
  score: number;
};

export async function characterDbSearchHandler(
  args: CharacterDbSearchInput
): Promise<SavedCharacterRecord[]> {
  const userId = userIdStorage.getStore();
  if (!userId) throw new Error("userId not in context");

  const { query, limit } = args;

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
      AND (
        similarity(name, ${query}) > 0.15
        OR similarity(sheet->>'shortDescription', ${query}) > 0.15
      )
    ORDER BY score DESC
    LIMIT ${limit}
  `);

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    name: row.name,
    sheet: CharacterSearchResultSchema.parse(row.sheet),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__character_db_search",
    "Search your saved characters by name or description using fuzzy similarity. Returns characters ranked by match score.",
    CharacterDbSearchInputShape,
    async (args: CharacterDbSearchInput) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await characterDbSearchHandler(args)),
        },
      ],
    })
  );
}
```

- [ ] **Step 2: Run tests — verify they pass**

```bash
cd mcp_server && bun test src/registry/tools/character_db_search.test.ts
```

Expected:
```
✓ returns matched characters shaped as SavedCharacterRecord[]
✓ returns empty array when no characters match
✓ calls $queryRaw once per invocation
✓ throws if userId not in context

4 pass, 0 fail
```

- [ ] **Step 3: Type-check mcp_server**

```bash
bun run --cwd mcp_server tsc --noEmit 2>&1 || true
```

Fix any type errors before proceeding. The `as unknown as Record<string, never>` cast on the input shape is intentional (Zod v3/v4 mismatch — matches existing tools).

- [ ] **Step 4: Commit**

```bash
git add mcp_server/src/registry/tools/character_db_search.ts \
        mcp_server/src/registry/tools/character_db_search.test.ts
git commit -m "feat: implement character_db_search tool with pg_trgm fuzzy similarity"
```

---

## Task 5: Register tool in registry and run full test suite

**Files:**
- Modify: `mcp_server/src/registry/registry.ts`

- [ ] **Step 1: Add import and registration call**

Open `mcp_server/src/registry/registry.ts`. Current content:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { register as registerCharacterSave } from "./tools/character_save.js";
import { register as registerCharacterList } from "./tools/character_list.js";
import { register as registerCharacterUpdate } from "./tools/character_update.js";
import { register as registerCharacterDelete } from "./tools/character_delete.js";
import { register as registerCharacterSearch } from "./tools/character_search.js";
import { register as registerShowSearch } from "./tools/show_search.js";
import { register as registerSceneSimulate } from "./tools/scene_simulate.js";

export function createRegistry(): McpServer {
  const server = new McpServer({
    name: "open-ormus",
    version: "0.0.1",
  });

  registerCharacterSave(server);
  registerCharacterList(server);
  registerCharacterUpdate(server);
  registerCharacterDelete(server);
  registerCharacterSearch(server);
  registerShowSearch(server);
  registerSceneSimulate(server);

  return server;
}
```

Replace with:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { register as registerCharacterSave } from "./tools/character_save.js";
import { register as registerCharacterList } from "./tools/character_list.js";
import { register as registerCharacterUpdate } from "./tools/character_update.js";
import { register as registerCharacterDelete } from "./tools/character_delete.js";
import { register as registerCharacterSearch } from "./tools/character_search.js";
import { register as registerCharacterDbSearch } from "./tools/character_db_search.js";
import { register as registerShowSearch } from "./tools/show_search.js";
import { register as registerSceneSimulate } from "./tools/scene_simulate.js";

export function createRegistry(): McpServer {
  const server = new McpServer({
    name: "open-ormus",
    version: "0.0.1",
  });

  registerCharacterSave(server);
  registerCharacterList(server);
  registerCharacterUpdate(server);
  registerCharacterDelete(server);
  registerCharacterSearch(server);
  registerCharacterDbSearch(server);
  registerShowSearch(server);
  registerSceneSimulate(server);

  return server;
}
```

- [ ] **Step 2: Run full mcp_server test suite**

```bash
cd mcp_server && bun test
```

Expected: all existing tests still pass, plus the 4 new character_db_search tests.

- [ ] **Step 3: Start MCP server and verify tool appears**

```bash
bun run --cwd mcp_server dev
```

In another terminal, send an MCP initialize request (or check server startup logs). Confirm no startup errors.

- [ ] **Step 4: Commit**

```bash
git add mcp_server/src/registry/registry.ts
git commit -m "feat: register mcp__openormus__character_db_search in tool registry"
```

---

## Done

All 4 files modified/created, 5 commits, all tests passing. The tool is live at `mcp__openormus__character_db_search` and searches the calling user's saved characters by fuzzy name/description similarity with pg_trgm.
