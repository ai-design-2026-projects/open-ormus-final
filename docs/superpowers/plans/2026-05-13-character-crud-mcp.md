# Character CRUD MCP Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace in-memory character tools with four DB-backed CRUD tools persisting characters (using the `CharacterSearchResult` structure) to Supabase PostgreSQL via Prisma, scoped by user.

**Architecture:** Second Prisma generator in `schema.prisma` outputs to `mcp_server/src/generated/prisma`. `AsyncLocalStorage` threads `userId` from the validated JWT on each HTTP request into tool handlers, without changing `createRegistry()`. Each tool handler reads `userIdStorage.getStore()` and scopes all Prisma queries with `WHERE userId = current`.

**Tech Stack:** Prisma 7 + `@prisma/adapter-pg` + `pg`, `AsyncLocalStorage` (Node built-in), Zod v3 (mcp_server), Bun test with `mock.module` for unit tests.

---

## File Map

### New files
| File | Responsibility |
|---|---|
| `mcp_server/src/auth/context.ts` | `AsyncLocalStorage<string>` singleton export |
| `mcp_server/src/db.ts` | Prisma singleton (mirrors `frontend/lib/prisma.ts`) |
| `mcp_server/src/generated/prisma/` | Prisma-generated client (gitignored) |
| `packages/shared/schema/character_saved.ts` | Zod schemas: save/update/delete inputs + DB record type |
| `packages/shared/schema/character_saved.test.ts` | Schema parse/reject tests |
| `mcp_server/src/registry/tools/character_save.ts` | INSERT handler + tool registration |
| `mcp_server/src/registry/tools/character_save.test.ts` | Unit tests with mocked Prisma |
| `mcp_server/src/registry/tools/character_list.ts` | SELECT all for user handler + registration |
| `mcp_server/src/registry/tools/character_list.test.ts` | Unit tests |
| `mcp_server/src/registry/tools/character_update.ts` | UPDATE handler + registration |
| `mcp_server/src/registry/tools/character_update.test.ts` | Unit tests |
| `mcp_server/src/registry/tools/character_delete.ts` | DELETE handler + registration |
| `mcp_server/src/registry/tools/character_delete.test.ts` | Unit tests |

### Modified files
| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `generator client_mcp` + `Character` model + `User.characters` relation |
| `mcp_server/package.json` | Add `@prisma/client`, `@prisma/adapter-pg`, `pg` deps; `@types/pg` dev dep |
| `packages/shared/index.ts` | Replace old character exports with `character_saved` exports |
| `mcp_server/src/transport/streamable-http.ts` | Wrap `transport.handleRequest` in `userIdStorage.run` |
| `mcp_server/src/transport/sse.ts` | Wrap `transport.handlePostMessage` in `userIdStorage.run` |
| `mcp_server/src/registry/registry.ts` | Remove old tool registrations, add 4 new ones |
| `.gitignore` | Add `mcp_server/src/generated/` |

### Deleted files
| File | Reason |
|---|---|
| `packages/shared/schema/character.ts` | In-memory schema, replaced by `character_saved.ts` |
| `packages/shared/schema/character.test.ts` | Tests for deleted schema |
| `mcp_server/src/registry/store.ts` | In-memory store, replaced by Prisma |
| `mcp_server/src/registry/store.test.ts` | Tests for deleted store |
| `mcp_server/src/registry/tools/character_create.ts` | Replaced by `character_save.ts` |
| `mcp_server/src/registry/tools/character_create.test.ts` | Tests for deleted tool |
| `mcp_server/src/registry/tools/character_get.ts` | Replaced by `character_list.ts` |
| `mcp_server/src/registry/tools/character_get.test.ts` | Tests for deleted tool |

---

## Task 1: Update Prisma schema and add dependencies

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `mcp_server/package.json`

- [ ] **Step 1: Add second Prisma generator to schema.prisma**

Open `prisma/schema.prisma`. Add the `client_mcp` generator block after the existing `client` generator, and add the `Character` model and the relation to `User`:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../frontend/lib/generated/prisma"
}

generator client_mcp {
  provider = "prisma-client"
  output   = "../mcp_server/src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

model User {
  id         String      @id @db.Uuid
  email      String      @unique
  createdAt  DateTime    @default(now()) @map("created_at")
  updatedAt  DateTime    @updatedAt @map("updated_at")
  characters Character[]

  @@map("users")
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

- [ ] **Step 2: Add dependencies to mcp_server/package.json**

Add under `"dependencies"`:
```json
"@prisma/adapter-pg": "^7.8.0",
"@prisma/client": "^7.8.0",
"pg": "^8.20.0"
```

Add under `"devDependencies"`:
```json
"@types/pg": "^8.20.0"
```

- [ ] **Step 3: Install new dependencies**

```bash
bun install
```

Expected: resolves without errors, `@prisma/adapter-pg`, `@prisma/client`, `pg` appear in lockfile.

- [ ] **Step 4: Run migration**

```bash
bun run --cwd frontend prisma migrate dev --name add_characters
```

Expected output contains: `The following migration(s) have been created and applied: migrations/..._add_characters/migration.sql`

- [ ] **Step 5: Generate Prisma clients**

```bash
bun run --cwd frontend prisma generate
```

Expected output mentions generating two clients — one for `frontend/lib/generated/prisma` and one for `mcp_server/src/generated/prisma`.

- [ ] **Step 6: Gitignore the generated mcp_server client**

Open `.gitignore` (root). Add:
```
mcp_server/src/generated/
```

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma mcp_server/package.json bun.lockb .gitignore
git commit -m "chore: add Character model and Prisma client for mcp_server"
```

---

## Task 2: Create AsyncLocalStorage context

**Files:**
- Create: `mcp_server/src/auth/context.ts`

- [ ] **Step 1: Write the failing test**

Create `mcp_server/src/auth/context.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { userIdStorage } from "./context";

describe("userIdStorage", () => {
  test("getStore returns undefined outside of run()", () => {
    expect(userIdStorage.getStore()).toBeUndefined();
  });

  test("getStore returns value inside run()", async () => {
    const result = await userIdStorage.run("user-123", () =>
      Promise.resolve(userIdStorage.getStore())
    );
    expect(result).toBe("user-123");
  });

  test("nested run() scopes do not bleed", async () => {
    let inner: string | undefined;
    await userIdStorage.run("outer", async () => {
      await userIdStorage.run("inner", () => {
        inner = userIdStorage.getStore();
        return Promise.resolve();
      });
      expect(userIdStorage.getStore()).toBe("outer");
    });
    expect(inner).toBe("inner");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test mcp_server/src/auth/context.test.ts
```

Expected: FAIL — `Cannot find module './context'`

- [ ] **Step 3: Implement context.ts**

Create `mcp_server/src/auth/context.ts`:

```typescript
import { AsyncLocalStorage } from "node:async_hooks";

export const userIdStorage = new AsyncLocalStorage<string>();
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test mcp_server/src/auth/context.test.ts
```

Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add mcp_server/src/auth/context.ts mcp_server/src/auth/context.test.ts
git commit -m "feat: add AsyncLocalStorage context for per-request userId"
```

---

## Task 3: Create Prisma singleton for mcp_server

**Files:**
- Create: `mcp_server/src/db.ts`

No unit test for this file (it's a thin singleton — integration-tested implicitly by tool tests).

- [ ] **Step 1: Create db.ts**

Create `mcp_server/src/db.ts`:

```typescript
import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: process.env["DATABASE_URL"],
  });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env["NODE_ENV"] !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 2: Commit**

```bash
git add mcp_server/src/db.ts
git commit -m "feat: add Prisma singleton for mcp_server"
```

---

## Task 4: Add shared schemas for saved characters

**Files:**
- Create: `packages/shared/schema/character_saved.ts`
- Create: `packages/shared/schema/character_saved.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/schema/character_saved.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import {
  CharacterSaveInputSchema,
  CharacterSaveInputShape,
  CharacterUpdateInputSchema,
  CharacterDeleteInputSchema,
  SavedCharacterRecordSchema,
} from "./character_saved";

const validPersonality = {
  personalityTraits: ["brave", "cunning"],
  backstory: "Grew up in the north",
  relationships: { Merlin: "mentor" },
  speechPatterns: ["speaks formally"],
  values: ["loyalty"],
  fears: ["betrayal"],
  goals: ["unite the kingdom"],
  notableQuotes: ["A king serves his people."],
  abilities: ["sword fighting"],
  copingStyle: ["stoicism"],
  knowledgeScope: { history: "expert" },
};

const validSheet = {
  name: "Arthur",
  imageUrl: null,
  shortDescription: "Legendary king",
  firstAppearanceDate: "500 AD",
  confidence: 3 as const,
  personality: validPersonality,
};

describe("CharacterSaveInputSchema", () => {
  test("parses valid save input", () => {
    const result = CharacterSaveInputSchema.parse(validSheet);
    expect(result.name).toBe("Arthur");
    expect(result.confidence).toBe(3);
    expect(result.personality.personalityTraits).toEqual(["brave", "cunning"]);
  });

  test("rejects empty name", () => {
    expect(() =>
      CharacterSaveInputSchema.parse({ ...validSheet, name: "" })
    ).toThrow();
  });

  test("rejects confidence out of range", () => {
    expect(() =>
      CharacterSaveInputSchema.parse({ ...validSheet, confidence: 4 })
    ).toThrow();
  });

  test("accepts null imageUrl", () => {
    const result = CharacterSaveInputSchema.parse({ ...validSheet, imageUrl: null });
    expect(result.imageUrl).toBeNull();
  });
});

describe("CharacterSaveInputShape", () => {
  test("is a plain object of Zod fields", () => {
    expect(typeof CharacterSaveInputShape).toBe("object");
    expect(typeof CharacterSaveInputShape.name.parse).toBe("function");
  });
});

describe("CharacterUpdateInputSchema", () => {
  test("parses valid update input", () => {
    const result = CharacterUpdateInputSchema.parse({
      id: "00000000-0000-0000-0000-000000000001",
      sheet: validSheet,
    });
    expect(result.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(result.sheet.name).toBe("Arthur");
  });

  test("rejects non-uuid id", () => {
    expect(() =>
      CharacterUpdateInputSchema.parse({ id: "not-a-uuid", sheet: validSheet })
    ).toThrow();
  });
});

describe("CharacterDeleteInputSchema", () => {
  test("parses valid id", () => {
    const result = CharacterDeleteInputSchema.parse({
      id: "00000000-0000-0000-0000-000000000001",
    });
    expect(result.id).toBe("00000000-0000-0000-0000-000000000001");
  });

  test("rejects non-uuid id", () => {
    expect(() =>
      CharacterDeleteInputSchema.parse({ id: "bad" })
    ).toThrow();
  });
});

describe("SavedCharacterRecordSchema", () => {
  test("parses valid DB record", () => {
    const record = SavedCharacterRecordSchema.parse({
      id: "00000000-0000-0000-0000-000000000001",
      userId: "00000000-0000-0000-0000-000000000002",
      name: "Arthur",
      sheet: validSheet,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(record.name).toBe("Arthur");
    expect(record.sheet.personality.personalityTraits).toEqual(["brave", "cunning"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test packages/shared/schema/character_saved.test.ts
```

Expected: FAIL — `Cannot find module './character_saved'`

- [ ] **Step 3: Implement character_saved.ts**

Create `packages/shared/schema/character_saved.ts`:

```typescript
import { z } from "zod";
import { CharacterPersonalitySchema, CharacterSearchResultSchema } from "./character_search";

// Save input — mirrors CharacterSearchResult fields
export const CharacterSaveInputShape = {
  name: z.string().min(1),
  imageUrl: z.string().nullable(),
  shortDescription: z.string(),
  firstAppearanceDate: z.string(),
  confidence: z.number().int().min(0).max(3) as z.ZodType<0 | 1 | 2 | 3>,
  personality: CharacterPersonalitySchema,
} as const;

export const CharacterSaveInputSchema = z.object(CharacterSaveInputShape);
export type CharacterSaveInput = z.infer<typeof CharacterSaveInputSchema>;

// Update input — full sheet replacement
export const CharacterUpdateInputShape = {
  id: z.string().uuid(),
  sheet: CharacterSearchResultSchema,
} as const;

export const CharacterUpdateInputSchema = z.object(CharacterUpdateInputShape);
export type CharacterUpdateInput = z.infer<typeof CharacterUpdateInputSchema>;

// Delete input
export const CharacterDeleteInputShape = {
  id: z.string().uuid(),
} as const;

export const CharacterDeleteInputSchema = z.object(CharacterDeleteInputShape);
export type CharacterDeleteInput = z.infer<typeof CharacterDeleteInputSchema>;

// DB record returned to callers
export const SavedCharacterRecordSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string(),
  sheet: CharacterSearchResultSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SavedCharacterRecord = z.infer<typeof SavedCharacterRecordSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test packages/shared/schema/character_saved.test.ts
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/schema/character_saved.ts packages/shared/schema/character_saved.test.ts
git commit -m "feat: add shared Zod schemas for saved characters"
```

---

## Task 5: Update shared index.ts, delete old character schema

**Files:**
- Modify: `packages/shared/index.ts`
- Delete: `packages/shared/schema/character.ts`
- Delete: `packages/shared/schema/character.test.ts`

- [ ] **Step 1: Update packages/shared/index.ts**

Replace the old character exports with the new ones. The file should become:

```typescript
export * from "./types";
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
  SavedCharacterRecordSchema,
  type SavedCharacterRecord,
} from "./schema/character_saved";
export {
  CharacterSearchInputShape,
  CharacterSearchInputSchema,
  type CharacterSearchInput,
  CharacterPersonalitySchema,
  type CharacterPersonality,
  CharacterSearchResultSchema,
  type CharacterSearchResult,
} from "./schema/character_search";
export {
  SceneSimulateInputShape,
  SceneSimulateInputSchema,
  SceneResultSchema,
} from "./schema/scene";
export {
  ShowSearchInputShape,
  ShowSearchInputSchema,
  ShowResultSchema,
  ShowSearchResultSchema,
} from "./schema/show_search";
```

- [ ] **Step 2: Delete the old character schema files**

```bash
rm packages/shared/schema/character.ts packages/shared/schema/character.test.ts
```

- [ ] **Step 3: Type-check shared package**

```bash
bun run --cwd packages/shared tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add packages/shared/index.ts
git rm packages/shared/schema/character.ts packages/shared/schema/character.test.ts
git commit -m "refactor: replace in-memory character schema with character_saved schemas"
```

---

## Task 6: Thread userId via AsyncLocalStorage in transports

**Files:**
- Modify: `mcp_server/src/transport/streamable-http.ts`
- Modify: `mcp_server/src/transport/sse.ts`

- [ ] **Step 1: Update streamable-http.ts**

Replace the file content with:

```typescript
import { randomUUID } from "node:crypto";
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createRegistry } from "../registry/registry.js";
import { userIdStorage } from "../auth/context.js";

// Session map: mcp-session-id header → transport instance
const sessions = new Map<string, StreamableHTTPServerTransport>();

export function createStreamableHttpRouter(): Router {
  const router = createRouter();

  router.post("/", async (req: Request, res: Response): Promise<void> => {
    const rawSessionId = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;

    if (sessionId) {
      const transport = sessions.get(sessionId);
      if (!transport) {
        res.status(404).json({ error: "session_not_found" });
        return;
      }
      await userIdStorage.run(req.userId, () =>
        transport.handleRequest(req, res, req.body)
      );
      return;
    }

    // No session ID — must be an initialize request to start a new session
    if (!isInitializeRequest(req.body)) {
      res.status(400).json({ error: "missing_session_id" });
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, transport);
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };

    // A new McpServer instance per session — McpServer.connect() cannot be called more than once
    // on the same instance (it throws "Already connected to a transport").
    const mcpServer = createRegistry();

    // Cast required: tsc reports TS2379 — Argument of type 'StreamableHTTPServerTransport' is not
    // assignable to parameter of type 'Transport' with 'exactOptionalPropertyTypes: true'.
    // The conflict is on 'onclose': the class getter returns `(() => void) | undefined` but the
    // Transport interface declares `onclose?: () => void` (no undefined in the value type under
    // exactOptionalPropertyTypes). The class structurally implements Transport at runtime.
    await mcpServer.connect(transport as Transport);
    await userIdStorage.run(req.userId, () =>
      transport.handleRequest(req, res, req.body)
    );
  });

  return router;
}
```

- [ ] **Step 2: Update sse.ts**

Replace the file content with:

```typescript
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createRegistry } from "../registry/registry.js";
import { userIdStorage } from "../auth/context.js";

// Session map: sessionId → SSE transport
// Separate map from StreamableHTTP — different transport type.
const sseSessions = new Map<string, SSEServerTransport>();

export function createSseRouter(): Router {
  const router = createRouter();

  // Client opens SSE stream here. Server responds with `event: endpoint` pointing
  // to POST /mcp/messages?sessionId=<id>. Client then posts messages there.
  router.get("/sse", async (_req: Request, res: Response): Promise<void> => {
    const mcpServer = createRegistry();
    const transport = new SSEServerTransport("/mcp/messages", res);
    sseSessions.set(transport.sessionId, transport);

    transport.onclose = () => {
      sseSessions.delete(transport.sessionId);
    };

    await mcpServer.connect(transport);
    await transport.start();
  });

  // Client posts messages to this endpoint after receiving the session ID from /sse.
  // Each POST is a tool call — userId is threaded here per-request from the validated JWT.
  router.post("/messages", async (req: Request, res: Response): Promise<void> => {
    const rawSessionId = req.query["sessionId"];
    const sessionId = typeof rawSessionId === "string" ? rawSessionId : undefined;
    if (!sessionId) {
      res.status(400).json({ error: "missing_sessionId" });
      return;
    }

    const transport = sseSessions.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }

    await userIdStorage.run(req.userId, () =>
      transport.handlePostMessage(req, res, req.body)
    );
  });

  return router;
}
```

- [ ] **Step 3: Type-check mcp_server**

```bash
bun run --cwd mcp_server tsc --noEmit 2>&1 | head -40
```

Expected: 0 new errors (existing `@ts-expect-error` on character_get is still there temporarily).

- [ ] **Step 4: Commit**

```bash
git add mcp_server/src/transport/streamable-http.ts mcp_server/src/transport/sse.ts
git commit -m "feat: thread userId via AsyncLocalStorage in MCP transports"
```

---

## Task 7: Implement character_save tool (TDD)

**Files:**
- Create: `mcp_server/src/registry/tools/character_save.ts`
- Create: `mcp_server/src/registry/tools/character_save.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mcp_server/src/registry/tools/character_save.test.ts`:

```typescript
import { mock } from "bun:test";

const mockCharacterCreate = mock(async () => ({
  id: "00000000-0000-0000-0000-000000000099",
  userId: "test-user",
  name: "Arthur",
  sheet: {
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
  },
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
}));

mock.module("../../db.js", () => ({
  prisma: { character: { create: mockCharacterCreate } },
}));

import { describe, test, expect, beforeEach } from "bun:test";
import { characterSaveHandler } from "./character_save";
import { userIdStorage } from "../../auth/context";

const validInput = {
  name: "Arthur",
  imageUrl: null as string | null,
  shortDescription: "Legendary king",
  firstAppearanceDate: "500 AD",
  confidence: 3 as 0 | 1 | 2 | 3,
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

  test("creates character and returns SavedCharacterRecord", async () => {
    const result = await userIdStorage.run("test-user", () =>
      characterSaveHandler(validInput)
    );
    expect(result.id).toBe("00000000-0000-0000-0000-000000000099");
    expect(result.name).toBe("Arthur");
    expect(result.sheet.confidence).toBe(3);
    expect(result.createdAt).toBeTruthy();
  });

  test("calls prisma.character.create with correct userId and sheet", async () => {
    await userIdStorage.run("test-user", () => characterSaveHandler(validInput));
    expect(mockCharacterCreate).toHaveBeenCalledTimes(1);
    const call = mockCharacterCreate.mock.calls[0]?.[0] as {
      data: { userId: string; name: string; sheet: unknown };
    };
    expect(call.data.userId).toBe("test-user");
    expect(call.data.name).toBe("Arthur");
  });

  test("throws if userId not in context", async () => {
    expect(() => characterSaveHandler(validInput)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test mcp_server/src/registry/tools/character_save.test.ts
```

Expected: FAIL — `Cannot find module './character_save'`

- [ ] **Step 3: Implement character_save.ts**

Create `mcp_server/src/registry/tools/character_save.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CharacterSaveInputShape,
  type CharacterSaveInput,
  type SavedCharacterRecord,
} from "@open-ormus/shared";
import { prisma } from "../../db.js";
import { userIdStorage } from "../../auth/context.js";

export async function characterSaveHandler(
  args: CharacterSaveInput
): Promise<SavedCharacterRecord> {
  const userId = userIdStorage.getStore();
  if (!userId) throw new Error("userId not in context");

  const record = await prisma.character.create({
    data: {
      userId,
      name: args.name,
      sheet: args,
    },
  });

  return {
    id: record.id,
    userId: record.userId,
    name: record.name,
    sheet: args,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__character_save",
    "Save a character to your collection. Accepts the full character profile returned by character_search.",
    CharacterSaveInputShape,
    async (args: CharacterSaveInput) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await characterSaveHandler(args)),
        },
      ],
    })
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test mcp_server/src/registry/tools/character_save.test.ts
```

Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add mcp_server/src/registry/tools/character_save.ts mcp_server/src/registry/tools/character_save.test.ts
git commit -m "feat: add character_save MCP tool"
```

---

## Task 8: Implement character_list tool (TDD)

**Files:**
- Create: `mcp_server/src/registry/tools/character_list.ts`
- Create: `mcp_server/src/registry/tools/character_list.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mcp_server/src/registry/tools/character_list.test.ts`:

```typescript
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
  });

  test("queries only current user's characters", async () => {
    await userIdStorage.run("test-user", () => characterListHandler());
    const call = mockFindMany.mock.calls[0]?.[0] as {
      where: { userId: string };
    };
    expect(call.where.userId).toBe("test-user");
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
bun test mcp_server/src/registry/tools/character_list.test.ts
```

Expected: FAIL — `Cannot find module './character_list'`

- [ ] **Step 3: Implement character_list.ts**

Create `mcp_server/src/registry/tools/character_list.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CharacterSearchResultSchema,
  type SavedCharacterRecord,
} from "@open-ormus/shared";
import { prisma } from "../../db.js";
import { userIdStorage } from "../../auth/context.js";

export async function characterListHandler(): Promise<SavedCharacterRecord[]> {
  const userId = userIdStorage.getStore();
  if (!userId) throw new Error("userId not in context");

  const records = await prisma.character.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  return records.map((record) => ({
    id: record.id,
    userId: record.userId,
    name: record.name,
    sheet: CharacterSearchResultSchema.parse(record.sheet),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }));
}

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__character_list",
    "List all characters saved in your collection.",
    {},
    async () => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await characterListHandler()),
        },
      ],
    })
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test mcp_server/src/registry/tools/character_list.test.ts
```

Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add mcp_server/src/registry/tools/character_list.ts mcp_server/src/registry/tools/character_list.test.ts
git commit -m "feat: add character_list MCP tool"
```

---

## Task 9: Implement character_update tool (TDD)

**Files:**
- Create: `mcp_server/src/registry/tools/character_update.ts`
- Create: `mcp_server/src/registry/tools/character_update.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mcp_server/src/registry/tools/character_update.test.ts`:

```typescript
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

const mockUpdate = mock(async () => ({
  id: "00000000-0000-0000-0000-000000000001",
  userId: "test-user",
  name: "Arthur Updated",
  sheet: validSheet,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-06-01"),
}));

const mockFindFirst = mock(async () => ({
  id: "00000000-0000-0000-0000-000000000001",
  userId: "test-user",
  name: "Arthur",
  sheet: {},
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
}));

mock.module("../../db.js", () => ({
  prisma: {
    character: {
      findFirst: mockFindFirst,
      update: mockUpdate,
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
    mockUpdate.mockClear();
    mockFindFirst.mockClear();
  });

  test("updates character and returns updated record", async () => {
    const result = await userIdStorage.run("test-user", () =>
      characterUpdateHandler(validInput)
    );
    if ("error" in result) throw new Error("expected success");
    expect(result.name).toBe("Arthur Updated");
    expect(result.sheet.confidence).toBe(2);
  });

  test("scopes update to current userId", async () => {
    await userIdStorage.run("test-user", () =>
      characterUpdateHandler(validInput)
    );
    const findCall = mockFindFirst.mock.calls[0]?.[0] as {
      where: { id: string; userId: string };
    };
    expect(findCall.where.userId).toBe("test-user");
    expect(findCall.where.id).toBe("00000000-0000-0000-0000-000000000001");
  });

  test("returns not_found when record does not belong to user", async () => {
    mockFindFirst.mockImplementation(async () => null);
    const result = await userIdStorage.run("test-user", () =>
      characterUpdateHandler(validInput)
    );
    expect(result).toEqual({ error: "not_found" });
  });

  test("throws if userId not in context", async () => {
    expect(() => characterUpdateHandler(validInput)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test mcp_server/src/registry/tools/character_update.test.ts
```

Expected: FAIL — `Cannot find module './character_update'`

- [ ] **Step 3: Implement character_update.ts**

Create `mcp_server/src/registry/tools/character_update.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CharacterUpdateInputShape,
  type CharacterUpdateInput,
  type SavedCharacterRecord,
} from "@open-ormus/shared";
import { prisma } from "../../db.js";
import { userIdStorage } from "../../auth/context.js";

type UpdateResult = SavedCharacterRecord | { error: "not_found" };

export async function characterUpdateHandler(
  args: CharacterUpdateInput
): Promise<UpdateResult> {
  const userId = userIdStorage.getStore();
  if (!userId) throw new Error("userId not in context");

  const existing = await prisma.character.findFirst({
    where: { id: args.id, userId },
  });
  if (!existing) return { error: "not_found" };

  const record = await prisma.character.update({
    where: { id: args.id },
    data: {
      name: args.sheet.name,
      sheet: args.sheet,
    },
  });

  return {
    id: record.id,
    userId: record.userId,
    name: record.name,
    sheet: args.sheet,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__character_update",
    "Update a saved character's full profile. Replaces the existing sheet entirely.",
    CharacterUpdateInputShape,
    async (args: CharacterUpdateInput) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await characterUpdateHandler(args)),
        },
      ],
    })
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test mcp_server/src/registry/tools/character_update.test.ts
```

Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add mcp_server/src/registry/tools/character_update.ts mcp_server/src/registry/tools/character_update.test.ts
git commit -m "feat: add character_update MCP tool"
```

---

## Task 10: Implement character_delete tool (TDD)

**Files:**
- Create: `mcp_server/src/registry/tools/character_delete.ts`
- Create: `mcp_server/src/registry/tools/character_delete.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mcp_server/src/registry/tools/character_delete.test.ts`:

```typescript
import { mock } from "bun:test";

const mockFindFirst = mock(async () => ({
  id: "00000000-0000-0000-0000-000000000001",
  userId: "test-user",
}));

const mockDelete = mock(async () => ({
  id: "00000000-0000-0000-0000-000000000001",
}));

mock.module("../../db.js", () => ({
  prisma: {
    character: {
      findFirst: mockFindFirst,
      delete: mockDelete,
    },
  },
}));

import { describe, test, expect, beforeEach } from "bun:test";
import { characterDeleteHandler } from "./character_delete";
import { userIdStorage } from "../../auth/context";

describe("characterDeleteHandler", () => {
  beforeEach(() => {
    mockFindFirst.mockClear();
    mockDelete.mockClear();
  });

  test("deletes character and returns success", async () => {
    const result = await userIdStorage.run("test-user", () =>
      characterDeleteHandler({ id: "00000000-0000-0000-0000-000000000001" })
    );
    expect(result).toEqual({ success: true });
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  test("scopes delete to current userId via findFirst check", async () => {
    await userIdStorage.run("test-user", () =>
      characterDeleteHandler({ id: "00000000-0000-0000-0000-000000000001" })
    );
    const findCall = mockFindFirst.mock.calls[0]?.[0] as {
      where: { id: string; userId: string };
    };
    expect(findCall.where.userId).toBe("test-user");
  });

  test("returns not_found when record does not belong to user", async () => {
    mockFindFirst.mockImplementation(async () => null);
    const result = await userIdStorage.run("test-user", () =>
      characterDeleteHandler({ id: "00000000-0000-0000-0000-000000000001" })
    );
    expect(result).toEqual({ error: "not_found" });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  test("throws if userId not in context", async () => {
    expect(() =>
      characterDeleteHandler({ id: "00000000-0000-0000-0000-000000000001" })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test mcp_server/src/registry/tools/character_delete.test.ts
```

Expected: FAIL — `Cannot find module './character_delete'`

- [ ] **Step 3: Implement character_delete.ts**

Create `mcp_server/src/registry/tools/character_delete.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CharacterDeleteInputShape,
  type CharacterDeleteInput,
} from "@open-ormus/shared";
import { prisma } from "../../db.js";
import { userIdStorage } from "../../auth/context.js";

type DeleteResult = { success: true } | { error: "not_found" };

export async function characterDeleteHandler(
  args: CharacterDeleteInput
): Promise<DeleteResult> {
  const userId = userIdStorage.getStore();
  if (!userId) throw new Error("userId not in context");

  const existing = await prisma.character.findFirst({
    where: { id: args.id, userId },
  });
  if (!existing) return { error: "not_found" };

  await prisma.character.delete({ where: { id: args.id } });

  return { success: true };
}

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__character_delete",
    "Delete a saved character from your collection by id.",
    CharacterDeleteInputShape,
    async (args: CharacterDeleteInput) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await characterDeleteHandler(args)),
        },
      ],
    })
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test mcp_server/src/registry/tools/character_delete.test.ts
```

Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add mcp_server/src/registry/tools/character_delete.ts mcp_server/src/registry/tools/character_delete.test.ts
git commit -m "feat: add character_delete MCP tool"
```

---

## Task 11: Update registry, delete old files

**Files:**
- Modify: `mcp_server/src/registry/registry.ts`
- Delete: `mcp_server/src/registry/store.ts`
- Delete: `mcp_server/src/registry/store.test.ts`
- Delete: `mcp_server/src/registry/tools/character_create.ts`
- Delete: `mcp_server/src/registry/tools/character_create.test.ts`
- Delete: `mcp_server/src/registry/tools/character_get.ts`
- Delete: `mcp_server/src/registry/tools/character_get.test.ts`

- [ ] **Step 1: Update registry.ts**

Replace `mcp_server/src/registry/registry.ts` with:

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

- [ ] **Step 2: Delete old files**

```bash
rm mcp_server/src/registry/store.ts \
   mcp_server/src/registry/store.test.ts \
   mcp_server/src/registry/tools/character_create.ts \
   mcp_server/src/registry/tools/character_create.test.ts \
   mcp_server/src/registry/tools/character_get.ts \
   mcp_server/src/registry/tools/character_get.test.ts
```

- [ ] **Step 3: Run all mcp_server tests**

```bash
bun test --cwd mcp_server
```

Expected: all tests pass, no references to deleted files.

- [ ] **Step 4: Type-check mcp_server**

```bash
bun run --cwd mcp_server tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 5: Type-check shared**

```bash
bun run --cwd packages/shared tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add mcp_server/src/registry/registry.ts
git rm mcp_server/src/registry/store.ts \
       mcp_server/src/registry/store.test.ts \
       mcp_server/src/registry/tools/character_create.ts \
       mcp_server/src/registry/tools/character_create.test.ts \
       mcp_server/src/registry/tools/character_get.ts \
       mcp_server/src/registry/tools/character_get.test.ts
git commit -m "refactor: replace in-memory character tools with DB-backed CRUD tools"
```

---

## Task 12: Final verification

- [ ] **Step 1: Run full test suite**

```bash
bun test
```

Expected: all tests pass across all workspaces.

- [ ] **Step 2: Start the MCP server and verify health**

```bash
MCP_AUTH_DISABLED=true bun run --cwd mcp_server dev &
sleep 2
curl -s http://localhost:3001/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 3: Kill the dev server**

```bash
kill %1
```
