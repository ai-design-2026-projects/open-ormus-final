# Conversation Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two MCP tools — `conversation_start` and `conversation_job_status` — that let an AI agent run a multi-character conversation and poll results without any UI involvement.

**Architecture:** MCP server is a thin HTTP client: it mints a short-lived JWT (signed with the shared `JWT_SECRET`), then calls two new internal Next.js API routes. Those routes validate the token, create the conversation + job in Postgres via Prisma, and hand off to the existing `startJob` runner. No engine duplication.

**Tech Stack:** TypeScript · Bun · Next.js 15 App Router · Prisma 7 · `jsonwebtoken` (mcp_server) · `bun:test` · Zod v4

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `packages/shared/schema/conversation_start.ts` | `ConversationStartInputSchema`, `ConversationJobStatusSchema`, inferred types, shapes |
| Create | `packages/shared/schema/conversation_start.test.ts` | Schema unit tests |
| Modify | `packages/shared/tool-descriptions.ts` | Add `conversation_start`, `conversation_job_status` descriptions |
| Modify | `packages/shared/index.ts` | Export new schemas and types |
| Create | `frontend/lib/internal-auth.ts` | JWT Bearer validation (no Supabase, uses native crypto) |
| Create | `frontend/lib/__tests__/internal-auth.test.ts` | Auth helper unit tests |
| Create | `frontend/app/api/internal/conversation-jobs/route.ts` | POST — create conversation + job |
| Create | `frontend/app/api/internal/conversation-jobs/[jobId]/route.ts` | GET — job status + messages |
| Create | `mcp_server/src/auth/internal-token.ts` | Mint outbound JWT for frontend calls |
| Create | `mcp_server/src/registry/tools/conversation_start.ts` | MCP tool handler |
| Create | `mcp_server/src/registry/tools/conversation_start.test.ts` | Tool handler unit tests |
| Create | `mcp_server/src/registry/tools/conversation_job_status.ts` | MCP tool handler |
| Create | `mcp_server/src/registry/tools/conversation_job_status.test.ts` | Tool handler unit tests |
| Modify | `mcp_server/src/registry/registry.ts` | Register both new tools |
| Modify | `mcp_server/src/registry/registry.test.ts` | Add mock.module entries for new tools |
| Modify | `.env.example` | Document `FRONTEND_INTERNAL_URL` |

---

## Task 1: Shared schemas and tool descriptions

**Files:**
- Create: `packages/shared/schema/conversation_start.ts`
- Create: `packages/shared/schema/conversation_start.test.ts`
- Modify: `packages/shared/tool-descriptions.ts`
- Modify: `packages/shared/index.ts`

- [ ] **Step 1: Write the failing schema tests**

Create `packages/shared/schema/conversation_start.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import {
  ConversationStartInputSchema,
  ConversationJobStatusSchema,
} from "./conversation_start";

const VALID_UUID_1 = "00000000-0000-0000-0000-000000000001";
const VALID_UUID_2 = "00000000-0000-0000-0000-000000000002";

describe("ConversationStartInputSchema", () => {
  test("valid input with all fields passes", () => {
    const result = ConversationStartInputSchema.safeParse({
      characterIds: [VALID_UUID_1, VALID_UUID_2],
      context: "A tense negotiation in a dark room.",
      turnStrategy: "ROUND_ROBIN",
      turns: 5,
      title: "Negotiation Scene",
    });
    expect(result.success).toBe(true);
  });

  test("title is optional", () => {
    const result = ConversationStartInputSchema.safeParse({
      characterIds: [VALID_UUID_1, VALID_UUID_2],
      context: "Context here",
      turnStrategy: "ORCHESTRATOR",
      turns: 3,
    });
    expect(result.success).toBe(true);
  });

  test("requires at least 2 characterIds", () => {
    const result = ConversationStartInputSchema.safeParse({
      characterIds: [VALID_UUID_1],
      context: "Context",
      turnStrategy: "ROUND_ROBIN",
      turns: 3,
    });
    expect(result.success).toBe(false);
  });

  test("rejects turns = 0", () => {
    const result = ConversationStartInputSchema.safeParse({
      characterIds: [VALID_UUID_1, VALID_UUID_2],
      context: "Context",
      turnStrategy: "ROUND_ROBIN",
      turns: 0,
    });
    expect(result.success).toBe(false);
  });

  test("rejects turns = 501", () => {
    const result = ConversationStartInputSchema.safeParse({
      characterIds: [VALID_UUID_1, VALID_UUID_2],
      context: "Context",
      turnStrategy: "ROUND_ROBIN",
      turns: 501,
    });
    expect(result.success).toBe(false);
  });

  test("accepts turns = 1 and turns = 500", () => {
    const base = {
      characterIds: [VALID_UUID_1, VALID_UUID_2],
      context: "Context",
      turnStrategy: "ORCHESTRATOR" as const,
    };
    expect(ConversationStartInputSchema.safeParse({ ...base, turns: 1 }).success).toBe(true);
    expect(ConversationStartInputSchema.safeParse({ ...base, turns: 500 }).success).toBe(true);
  });

  test("rejects invalid turn strategy", () => {
    const result = ConversationStartInputSchema.safeParse({
      characterIds: [VALID_UUID_1, VALID_UUID_2],
      context: "Context",
      turnStrategy: "RANDOM",
      turns: 3,
    });
    expect(result.success).toBe(false);
  });

  test("rejects malformed UUID in characterIds", () => {
    const result = ConversationStartInputSchema.safeParse({
      characterIds: ["not-a-uuid", VALID_UUID_2],
      context: "Context",
      turnStrategy: "ROUND_ROBIN",
      turns: 3,
    });
    expect(result.success).toBe(false);
  });
});

describe("ConversationJobStatusSchema", () => {
  test("pending status passes", () => {
    const result = ConversationJobStatusSchema.safeParse({
      status: "pending",
      doneTurns: 0,
      totalTurns: 5,
    });
    expect(result.success).toBe(true);
  });

  test("completed status with messages passes", () => {
    const result = ConversationJobStatusSchema.safeParse({
      status: "completed",
      doneTurns: 5,
      totalTurns: 5,
      messages: [
        {
          id: VALID_UUID_1,
          conversationId: VALID_UUID_2,
          characterId: VALID_UUID_1,
          authorUserId: null,
          characterName: "Arthur",
          content: "Hello.",
          reasoning: null,
          emotion: "Joy",
          intensity: "low",
          subtext: "",
          createdAt: "2026-06-03T00:00:00.000Z",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("failed status with error passes", () => {
    const result = ConversationJobStatusSchema.safeParse({
      status: "failed",
      doneTurns: 2,
      totalTurns: 5,
      error: "LLM error",
    });
    expect(result.success).toBe(true);
  });

  test("rejects unknown status", () => {
    const result = ConversationJobStatusSchema.safeParse({
      status: "unknown",
      doneTurns: 0,
      totalTurns: 5,
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test --cwd packages/shared schema/conversation_start.test.ts
```

Expected: error — module not found or type errors.

- [ ] **Step 3: Create the schema file**

Create `packages/shared/schema/conversation_start.ts`:

```ts
import { z } from "zod";
import { TurnStrategySchema, MessageRecordSchema } from "./conversation.js";

const uuidSchema = z
  .string()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    "Invalid UUID"
  );

export const ConversationStartInputSchema = z.object({
  characterIds: z.array(uuidSchema).min(2),
  context: z.string().min(1),
  turnStrategy: TurnStrategySchema,
  turns: z.number().int().min(1).max(500),
  title: z.string().optional(),
});
export type ConversationStartInput = z.infer<typeof ConversationStartInputSchema>;
export const ConversationStartInputShape = ConversationStartInputSchema.shape;

export const ConversationJobStatusSchema = z.object({
  status: z.enum(["pending", "running", "completed", "failed", "cancelled", "awaiting_user"]),
  doneTurns: z.number().int(),
  totalTurns: z.number().int(),
  error: z.string().optional(),
  messages: z.array(MessageRecordSchema).optional(),
});
export type ConversationJobStatus = z.infer<typeof ConversationJobStatusSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test --cwd packages/shared schema/conversation_start.test.ts
```

Expected: all 9 tests pass.

- [ ] **Step 5: Add tool descriptions**

In `packages/shared/tool-descriptions.ts`, add two entries to the `TOOL_DESCRIPTIONS` object (before the closing `} as const`):

```ts
  conversation_start:
    "Start a new multi-character conversation and run it for a fixed number of turns. " +
    "Provide at least 2 character IDs (use character_list or character_find to resolve them), " +
    "a context string describing the scene, a turn strategy (ORCHESTRATOR lets an AI pick who speaks next; " +
    "ROUND_ROBIN rotates speakers in order), and the number of turns to run (1–500). " +
    "Returns a conversationId and jobId immediately — the conversation runs in the background. " +
    "Poll conversation_job_status with the jobId until status is 'completed'.",

  conversation_job_status:
    "Poll the status of a background conversation job started with conversation_start. " +
    "Returns status ('pending', 'running', 'completed', 'failed', 'cancelled'), " +
    "doneTurns, totalTurns, and — when completed — the full array of messages. " +
    "Keep polling until status is a terminal value: 'completed', 'failed', or 'cancelled'.",
```

- [ ] **Step 6: Export from shared index**

In `packages/shared/index.ts`, add after the existing conversation exports block:

```ts
export {
  ConversationStartInputSchema,
  ConversationStartInputShape,
  type ConversationStartInput,
  ConversationJobStatusSchema,
  type ConversationJobStatus,
} from "./schema/conversation_start";
```

- [ ] **Step 7: Run full shared test suite**

```bash
bun test --cwd packages/shared
```

Expected: 65 + 9 = 74 tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/schema/conversation_start.ts packages/shared/schema/conversation_start.test.ts packages/shared/tool-descriptions.ts packages/shared/index.ts
git commit -m "feat(shared): add ConversationStartInput and ConversationJobStatus schemas"
```

---

## Task 2: Frontend internal auth helper

**Files:**
- Create: `frontend/lib/internal-auth.ts`
- Create: `frontend/lib/__tests__/internal-auth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/lib/__tests__/internal-auth.test.ts`:

```ts
import { describe, test, expect, beforeAll } from "bun:test";

// Must be set before module import since the function reads it at call time.
beforeAll(() => {
  process.env["JWT_SECRET"] = "test-secret-for-internal-auth";
});

import { validateInternalToken } from "../internal-auth";
import { generateToolToken } from "../agent/token";

describe("validateInternalToken", () => {
  test("accepts a valid token produced by generateToolToken", () => {
    process.env["JWT_SECRET"] = "test-secret-for-internal-auth";
    const token = generateToolToken("user-abc");
    const userId = validateInternalToken(`Bearer ${token}`);
    expect(userId).toBe("user-abc");
  });

  test("throws on missing Authorization header", () => {
    expect(() => validateInternalToken(null)).toThrow("missing_token");
  });

  test("throws on non-Bearer prefix", () => {
    expect(() => validateInternalToken("Basic abc")).toThrow("missing_token");
  });

  test("throws on tampered signature", () => {
    process.env["JWT_SECRET"] = "test-secret-for-internal-auth";
    const token = generateToolToken("user-abc");
    const parts = token.split(".");
    const tampered = `${parts[0]}.${parts[1]}.invalidsignature`;
    expect(() => validateInternalToken(`Bearer ${tampered}`)).toThrow("invalid_token");
  });

  test("throws on token with wrong number of parts", () => {
    expect(() => validateInternalToken("Bearer notavalidjwt")).toThrow("invalid_token");
  });

  test("throws when JWT_SECRET is not set", () => {
    const saved = process.env["JWT_SECRET"];
    delete process.env["JWT_SECRET"];
    try {
      expect(() => validateInternalToken("Bearer anything")).toThrow("jwt_secret_not_configured");
    } finally {
      process.env["JWT_SECRET"] = saved;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test --cwd frontend lib/__tests__/internal-auth.test.ts
```

Expected: error — `../internal-auth` not found.

- [ ] **Step 3: Create the auth helper**

Create `frontend/lib/internal-auth.ts`:

```ts
import { createHmac } from "crypto";
import { z } from "zod";

const PayloadSchema = z.object({
  userId: z.string(),
  exp: z.number(),
});

export function validateInternalToken(authHeader: string | null): string {
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("missing_token");
  }

  const token = authHeader.slice(7);
  const secret = process.env["JWT_SECRET"];
  if (!secret) throw new Error("jwt_secret_not_configured");

  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("invalid_token");

  const [header, payload, sig] = parts as [string, string, string];

  const expectedSig = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  if (sig !== expectedSig) throw new Error("invalid_token");

  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    throw new Error("invalid_token");
  }

  const parsed = PayloadSchema.safeParse(data);
  if (!parsed.success) throw new Error("invalid_token");

  if (parsed.data.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("token_expired");
  }

  return parsed.data.userId;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test --cwd frontend lib/__tests__/internal-auth.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/internal-auth.ts frontend/lib/__tests__/internal-auth.test.ts
git commit -m "feat(frontend): add internal JWT Bearer validation helper"
```

---

## Task 3: Frontend POST /api/internal/conversation-jobs

**Files:**
- Create: `frontend/app/api/internal/conversation-jobs/route.ts`

- [ ] **Step 1: Create the route**

Create `frontend/app/api/internal/conversation-jobs/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { startJob } from "@/lib/jobs/runner";
import { ensureStarted } from "@/lib/jobs/startup";
import { validateInternalToken } from "@/lib/internal-auth";
import { ConversationStartInputSchema } from "@open-ormus/shared";

export async function POST(request: Request) {
  let userId: string;
  try {
    userId = validateInternalToken(request.headers.get("authorization"));
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureStarted();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ConversationStartInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  const { characterIds, context, turnStrategy, turns, title } = parsed.data;

  // Verify all characters exist and belong to this user.
  const chars = await prisma.character.findMany({
    where: { id: { in: characterIds }, userId },
    select: { id: true },
  });
  if (chars.length !== characterIds.length) {
    return NextResponse.json(
      { error: "One or more characters not found" },
      { status: 404 }
    );
  }

  const conversation = await prisma.conversation.create({
    data: {
      title: title ?? context.slice(0, 50),
      context,
      turnStrategy,
      userId,
      participants: {
        create: characterIds.map((characterId, i) => ({
          characterId,
          turnOrder: i,
          isUserParticipant: false,
        })),
      },
    },
  });

  const job = await prisma.conversationJob.create({
    data: {
      conversationId: conversation.id,
      userId,
      totalTurns: turns,
      status: "pending",
    },
  });

  void startJob(job.id, conversation.id, userId, turns);

  return NextResponse.json(
    { conversationId: conversation.id, jobId: job.id },
    { status: 202 }
  );
}
```

- [ ] **Step 2: Run typecheck to verify no type errors**

```bash
bun run typecheck
```

Expected: exits 0. Fix any type errors before continuing.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/api/internal/conversation-jobs/route.ts
git commit -m "feat(frontend): add internal POST /api/internal/conversation-jobs route"
```

---

## Task 4: Frontend GET /api/internal/conversation-jobs/[jobId]

**Files:**
- Create: `frontend/app/api/internal/conversation-jobs/[jobId]/route.ts`

- [ ] **Step 1: Create the route**

Create `frontend/app/api/internal/conversation-jobs/[jobId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateInternalToken } from "@/lib/internal-auth";
import { ConversationJobStatusSchema } from "@open-ormus/shared";

type RouteContext = { params: Promise<{ jobId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  let userId: string;
  try {
    userId = validateInternalToken(request.headers.get("authorization"));
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await params;

  const job = await prisma.conversationJob.findFirst({
    where: { id: jobId, userId },
  });

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let messages: unknown = undefined;
  if (job.status === "completed") {
    const conversation = await prisma.conversation.findFirst({
      where: { id: job.conversationId, userId },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          include: { character: { select: { name: true } } },
        },
      },
    });

    messages = conversation?.messages.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      characterId: m.characterId,
      authorUserId: m.authorUserId,
      characterName: m.character?.name ?? "Unknown",
      content: m.content,
      reasoning: m.reasoning,
      emotion: m.emotion,
      intensity: m.intensity,
      subtext: m.subtext,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  const result = ConversationJobStatusSchema.parse({
    status: job.status,
    doneTurns: job.doneTurns,
    totalTurns: job.totalTurns,
    error: job.errorMessage ?? undefined,
    messages,
  });

  return NextResponse.json(result);
}
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add "frontend/app/api/internal/conversation-jobs/[jobId]/route.ts"
git commit -m "feat(frontend): add internal GET /api/internal/conversation-jobs/[jobId] route"
```

---

## Task 5: MCP internal token helper

**Files:**
- Create: `mcp_server/src/auth/internal-token.ts`

- [ ] **Step 1: Create the helper**

Create `mcp_server/src/auth/internal-token.ts`:

```ts
import jwt from "jsonwebtoken";

export function mintInternalToken(userId: string): string {
  const secret = process.env["JWT_SECRET"];
  if (!secret) throw new Error("JWT_SECRET not configured");
  return jwt.sign({ userId, internal: true }, secret, { expiresIn: 60 });
}
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add mcp_server/src/auth/internal-token.ts
git commit -m "feat(mcp): add internal JWT mint helper"
```

---

## Task 6: MCP conversation_start tool

**Files:**
- Create: `mcp_server/src/registry/tools/conversation_start.ts`
- Create: `mcp_server/src/registry/tools/conversation_start.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mcp_server/src/registry/tools/conversation_start.test.ts`:

```ts
import { mock } from "bun:test";

const mockGetStore = mock(() => "test-user-id" as string | undefined);

mock.module("../../auth/context.js", () => ({
  userIdStorage: { getStore: mockGetStore },
}));

mock.module("../../auth/internal-token.js", () => ({
  mintInternalToken: () => "mock-jwt-token",
}));

import { describe, test, expect, beforeEach } from "bun:test";
import { conversationStartHandler } from "./conversation_start.js";

const VALID_UUID_1 = "00000000-0000-0000-0000-000000000001";
const VALID_UUID_2 = "00000000-0000-0000-0000-000000000002";

const mockFetchSuccess = mock(async () => ({
  ok: true,
  status: 202,
  json: async () => ({ conversationId: "conv-1", jobId: "job-1" }),
} as unknown as Response));

describe("conversationStartHandler", () => {
  beforeEach(() => {
    mockFetchSuccess.mockClear();
    mockGetStore.mockImplementation(() => "test-user-id");
    globalThis.fetch = mockFetchSuccess;
    process.env["FRONTEND_INTERNAL_URL"] = "http://localhost:3000";
  });

  test("calls correct endpoint with Authorization header", async () => {
    await conversationStartHandler({
      characterIds: [VALID_UUID_1, VALID_UUID_2],
      context: "A tense scene.",
      turnStrategy: "ROUND_ROBIN",
      turns: 5,
    });

    expect(mockFetchSuccess.mock.calls).toHaveLength(1);
    const [url, init] = mockFetchSuccess.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/internal/conversation-jobs");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer mock-jwt-token");
    expect(init.method).toBe("POST");
  });

  test("returns conversationId and jobId on success", async () => {
    const result = await conversationStartHandler({
      characterIds: [VALID_UUID_1, VALID_UUID_2],
      context: "Scene.",
      turnStrategy: "ORCHESTRATOR",
      turns: 3,
    });

    expect(result.conversationId).toBe("conv-1");
    expect(result.jobId).toBe("job-1");
  });

  test("throws on non-ok response", async () => {
    globalThis.fetch = mock(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: "Not found" }),
    } as unknown as Response));

    await expect(
      conversationStartHandler({
        characterIds: [VALID_UUID_1, VALID_UUID_2],
        context: "Scene.",
        turnStrategy: "ROUND_ROBIN",
        turns: 3,
      })
    ).rejects.toThrow("Failed to start conversation");
  });

  test("throws if userId not in context", async () => {
    mockGetStore.mockImplementation(() => undefined);

    await expect(
      conversationStartHandler({
        characterIds: [VALID_UUID_1, VALID_UUID_2],
        context: "Scene.",
        turnStrategy: "ROUND_ROBIN",
        turns: 3,
      })
    ).rejects.toThrow("userId not in context");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test --cwd mcp_server src/registry/tools/conversation_start.test.ts
```

Expected: error — module not found.

- [ ] **Step 3: Create the tool**

Create `mcp_server/src/registry/tools/conversation_start.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  TOOL_DESCRIPTIONS,
  ConversationStartInputShape,
  type ConversationStartInput,
} from "@open-ormus/shared";
import { userIdStorage } from "../../auth/context.js";
import { mintInternalToken } from "../../auth/internal-token.js";

export async function conversationStartHandler(
  args: ConversationStartInput
): Promise<{ conversationId: string; jobId: string }> {
  const userId = userIdStorage.getStore();
  if (!userId) throw new Error("userId not in context");

  const token = mintInternalToken(userId);
  const baseUrl = process.env["FRONTEND_INTERNAL_URL"] ?? "http://localhost:3000";

  const res = await fetch(`${baseUrl}/api/internal/conversation-jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(args),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      `Failed to start conversation: ${res.status} ${JSON.stringify(body)}`
    );
  }

  return res.json() as Promise<{ conversationId: string; jobId: string }>;
}

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__conversation_start",
    TOOL_DESCRIPTIONS.conversation_start,
    ConversationStartInputShape,
    async (args: ConversationStartInput) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await conversationStartHandler(args)),
        },
      ],
    })
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test --cwd mcp_server src/registry/tools/conversation_start.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add mcp_server/src/registry/tools/conversation_start.ts mcp_server/src/registry/tools/conversation_start.test.ts
git commit -m "feat(mcp): add conversation_start tool"
```

---

## Task 7: MCP conversation_job_status tool

**Files:**
- Create: `mcp_server/src/registry/tools/conversation_job_status.ts`
- Create: `mcp_server/src/registry/tools/conversation_job_status.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mcp_server/src/registry/tools/conversation_job_status.test.ts`:

```ts
import { mock } from "bun:test";

const mockGetStore = mock(() => "test-user-id" as string | undefined);

mock.module("../../auth/context.js", () => ({
  userIdStorage: { getStore: mockGetStore },
}));

mock.module("../../auth/internal-token.js", () => ({
  mintInternalToken: () => "mock-jwt-token",
}));

import { describe, test, expect, beforeEach } from "bun:test";
import { conversationJobStatusHandler } from "./conversation_job_status.js";

const mockRunningPayload = {
  status: "running",
  doneTurns: 2,
  totalTurns: 5,
};

const mockCompletedPayload = {
  status: "completed",
  doneTurns: 5,
  totalTurns: 5,
  messages: [],
};

describe("conversationJobStatusHandler", () => {
  beforeEach(() => {
    process.env["FRONTEND_INTERNAL_URL"] = "http://localhost:3000";
  });

  test("returns job status from frontend API", async () => {
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      json: async () => mockRunningPayload,
    } as unknown as Response));

    const result = await conversationJobStatusHandler("job-abc");
    expect(result.status).toBe("running");
    expect(result.doneTurns).toBe(2);
    expect(result.totalTurns).toBe(5);
  });

  test("calls correct URL with Authorization header", async () => {
    const mockFetch = mock(async () => ({
      ok: true,
      status: 200,
      json: async () => mockCompletedPayload,
    } as unknown as Response));
    globalThis.fetch = mockFetch;

    await conversationJobStatusHandler("job-xyz");

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/internal/conversation-jobs/job-xyz");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer mock-jwt-token");
  });

  test("throws on 404", async () => {
    globalThis.fetch = mock(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: "Not found" }),
    } as unknown as Response));

    await expect(conversationJobStatusHandler("missing-job")).rejects.toThrow(
      "Job missing-job not found"
    );
  });

  test("throws on other non-ok status", async () => {
    globalThis.fetch = mock(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as unknown as Response));

    await expect(conversationJobStatusHandler("job-abc")).rejects.toThrow(
      "Failed to get job status: 500"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test --cwd mcp_server src/registry/tools/conversation_job_status.test.ts
```

Expected: error — module not found.

- [ ] **Step 3: Create the tool**

Create `mcp_server/src/registry/tools/conversation_job_status.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TOOL_DESCRIPTIONS, type ConversationJobStatus } from "@open-ormus/shared";
import { userIdStorage } from "../../auth/context.js";
import { mintInternalToken } from "../../auth/internal-token.js";

const JobStatusInputShape = {
  jobId: z.string().uuid(),
};

export async function conversationJobStatusHandler(
  jobId: string
): Promise<ConversationJobStatus> {
  const userId = userIdStorage.getStore();
  if (!userId) throw new Error("userId not in context");

  const token = mintInternalToken(userId);
  const baseUrl = process.env["FRONTEND_INTERNAL_URL"] ?? "http://localhost:3000";

  const res = await fetch(
    `${baseUrl}/api/internal/conversation-jobs/${jobId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (res.status === 404) throw new Error(`Job ${jobId} not found`);
  if (!res.ok) throw new Error(`Failed to get job status: ${res.status}`);

  return res.json() as Promise<ConversationJobStatus>;
}

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__conversation_job_status",
    TOOL_DESCRIPTIONS.conversation_job_status,
    JobStatusInputShape,
    async (args: { jobId: string }) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await conversationJobStatusHandler(args.jobId)),
        },
      ],
    })
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test --cwd mcp_server src/registry/tools/conversation_job_status.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add mcp_server/src/registry/tools/conversation_job_status.ts mcp_server/src/registry/tools/conversation_job_status.test.ts
git commit -m "feat(mcp): add conversation_job_status tool"
```

---

## Task 8: Register tools, update registry test, and env example

**Files:**
- Modify: `mcp_server/src/registry/registry.ts`
- Modify: `mcp_server/src/registry/registry.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Register the two new tools in the registry**

In `mcp_server/src/registry/registry.ts`, add the imports and register calls:

```ts
// Add these two imports after the existing register imports:
import { register as registerConversationStart } from "./tools/conversation_start.js";
import { register as registerConversationJobStatus } from "./tools/conversation_job_status.js";
```

And inside `createRegistry()`, after the last existing `register*` call:

```ts
  registerConversationStart(server);
  registerConversationJobStatus(server);
```

- [ ] **Step 2: Add mock entries in registry.test.ts**

In `mcp_server/src/registry/registry.test.ts`, add two `mock.module` lines after the existing ones (before the `import { createRegistry }` line):

```ts
mock.module("./tools/conversation_start.js", () => ({ register: () => {} }));
mock.module("./tools/conversation_job_status.js", () => ({ register: () => {} }));
```

- [ ] **Step 3: Add FRONTEND_INTERNAL_URL to .env.example**

In `.env.example`, add after the `MCP_SERVER_URL` line:

```
# URL the MCP server uses to call frontend internal API routes (no trailing slash)
FRONTEND_INTERNAL_URL=http://localhost:3000
```

- [ ] **Step 4: Run full mcp_server test suite**

```bash
bun test --cwd mcp_server
```

Expected: all tests pass (including the two new tool test files).

- [ ] **Step 5: Run typecheck**

```bash
bun run typecheck
```

Expected: exits 0.

- [ ] **Step 6: Run full shared + frontend test suites**

```bash
bun test --cwd packages/shared && bun test --cwd frontend
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add mcp_server/src/registry/registry.ts mcp_server/src/registry/registry.test.ts .env.example
git commit -m "feat(mcp): register conversation_start and conversation_job_status tools"
```

---

## Task 9: Final verification

- [ ] **Step 1: Run typecheck one last time**

```bash
bun run typecheck
```

Expected: exits 0.

- [ ] **Step 2: Run all test suites**

```bash
bun test --cwd packages/shared && bun test --cwd frontend && bun test --cwd mcp_server
```

Expected: all pass with no failures.

- [ ] **Step 3: Verify the two tools appear in the registry**

Start the MCP server and check the tool list:

```bash
bun run dev:mcp &
sleep 2
curl -s -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -H "MCP_AUTH_DISABLED: true" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}' | grep -o '"name":"[^"]*"'
```

Expected output includes: `"name":"mcp__openormus__conversation_start"` and `"name":"mcp__openormus__conversation_job_status"`.

Kill the background server after verifying (`kill %1`).
