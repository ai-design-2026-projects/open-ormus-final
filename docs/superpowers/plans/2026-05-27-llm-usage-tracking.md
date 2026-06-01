# LLM Usage Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track every LLM API call across all 6 call sites — token counts, cost (OpenRouter only via follow-up GET), latency, and source context — and persist records to a new `llm_usages` Postgres table.

**Architecture:** Explicit `logLlmUsage()` utility (hard fail) called at each call site after the LLM response completes. Streaming calls capture usage from the final chunk; cost is fetched from OpenRouter's `/api/v1/generation?id=` endpoint after the stream. Provider detection is URL-based (`LLM_BASE_URL` contains `openrouter.ai`).

**Tech Stack:** Prisma 7 (schema + migration), OpenAI SDK v4 (usage extraction), Bun test runner (`bun test`)

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `prisma/schema.prisma` | Add `LlmUsageSource` enum + `LlmUsage` model + back-relations |
| Create | `frontend/lib/llm-usage.ts` | `logLlmUsage()` utility + `isOpenRouter()` helper |
| Create | `frontend/lib/__tests__/llm-usage.test.ts` | Unit tests for the utility |
| Modify | `frontend/lib/orchestrator.ts` | Add `conversationId` param; log after non-streaming response |
| Modify | `frontend/app/api/conversations/improve-context/route.ts` | Log after non-streaming response |
| Modify | `frontend/lib/conversation/next.ts` | Capture streaming usage; update orchestrator call |
| Modify | `frontend/lib/agent/loop.ts` | Add `ctx: UsageContext` param; log per iteration |
| Modify | `frontend/app/api/chat/stream/route.ts` | Pass ctx to `runAgentLoop`; log `autoTitle` |

---

### Task 1: Prisma schema — add `LlmUsage` table

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add enum and model to schema**

In `prisma/schema.prisma`, append after the closing `}` of the `TurnStrategy` enum (line 142):

```prisma
enum LlmUsageSource {
  CONVERSATION
  ORCHESTRATOR
  AGENT_SESSION
  IMPROVE_CONTEXT
  OTHER
}

model LlmUsage {
  id              String         @id @default(uuid()) @db.Uuid
  createdAt       DateTime       @default(now()) @map("created_at")
  source          LlmUsageSource
  conversationId  String?        @db.Uuid @map("conversation_id")
  agentSessionId  String?        @db.Uuid @map("agent_session_id")
  userId          String?        @db.Uuid @map("user_id")
  model           String
  inputTokens     Int            @map("input_tokens")
  outputTokens    Int            @map("output_tokens")
  reasoningTokens Int?           @map("reasoning_tokens")
  cachedTokens    Int?           @map("cached_tokens")
  costUsd         Float?         @map("cost_usd")
  latencyMs       Int            @map("latency_ms")

  conversation    Conversation?  @relation(fields: [conversationId], references: [id], onDelete: SetNull)
  agentSession    AgentSession?  @relation(fields: [agentSessionId], references: [id], onDelete: SetNull)
  user            User?          @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([conversationId])
  @@index([agentSessionId])
  @@index([userId])
  @@map("llm_usages")
}
```

- [ ] **Step 2: Add back-relations to existing models**

In `prisma/schema.prisma`:

In the `User` model (after line `conversationJobs ConversationJob[]`), add:
```prisma
  llmUsages        LlmUsage[]
```

In the `Conversation` model (after line `jobs ConversationJob[]`), add:
```prisma
  llmUsages        LlmUsage[]
```

In the `AgentSession` model (after line `turns AgentTurn[]`), add:
```prisma
  llmUsages        LlmUsage[]
```

- [ ] **Step 3: Run migration**

```bash
bun run prisma:migrate:dev
```

When prompted for migration name, enter: `add_llm_usage`

Expected output: `✔ Generated Prisma Client` with no errors.

- [ ] **Step 4: Regenerate client**

```bash
bun run prisma:generate
```

Expected: `✔ Generated Prisma Client (7.x.x) to ./../../frontend/lib/generated/prisma`

- [ ] **Step 5: Verify type is available**

```bash
grep -r "LlmUsageSource\|LlmUsage" frontend/lib/generated/prisma/models/ | head -5
```

Expected: matches in generated model files showing the new type.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma frontend/lib/generated/prisma/ mcp_server/src/generated/prisma/
git commit -m "feat: add LlmUsage table to schema"
```

---

### Task 2: Create `llm-usage.ts` utility

**Files:**
- Create: `frontend/lib/llm-usage.ts`
- Create: `frontend/lib/__tests__/llm-usage.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/lib/__tests__/llm-usage.test.ts`:

```typescript
import { mock } from "bun:test";

const mockCreate = mock(async () => ({ id: "usage-1" }));

mock.module("@/lib/prisma", () => ({
  prisma: { llmUsage: { create: mockCreate } },
}));

import { describe, test, expect, beforeEach } from "bun:test";
import { logLlmUsage, isOpenRouter } from "../llm-usage";
import { LlmUsageSource } from "../generated/prisma";

const baseCtx = {
  source: LlmUsageSource.CONVERSATION,
  conversationId: "11111111-0000-0000-0000-000000000001",
  userId: "11111111-0000-0000-0000-000000000002",
};
const baseRaw = {
  generationId: "gen-abc123",
  model: "gemini/gemini-2.5-flash",
  inputTokens: 100,
  outputTokens: 50,
  latencyMs: 200,
};

describe("isOpenRouter", () => {
  test("returns true when LLM_BASE_URL contains openrouter.ai", () => {
    process.env.LLM_BASE_URL = "https://openrouter.ai/api/v1";
    expect(isOpenRouter()).toBe(true);
  });

  test("returns false for other base URLs", () => {
    process.env.LLM_BASE_URL = "http://localhost:11434/v1";
    expect(isOpenRouter()).toBe(false);
  });

  test("returns false when LLM_BASE_URL is unset", () => {
    delete process.env.LLM_BASE_URL;
    expect(isOpenRouter()).toBe(false);
  });
});

describe("logLlmUsage", () => {
  beforeEach(() => {
    mockCreate.mockClear();
  });

  test("non-OpenRouter: writes record to DB with null cost, no fetch", async () => {
    process.env.LLM_BASE_URL = "http://localhost:11434/v1";

    await logLlmUsage(baseCtx, baseRaw);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArg = mockCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(callArg.data.costUsd).toBeNull();
    expect(callArg.data.inputTokens).toBe(100);
    expect(callArg.data.outputTokens).toBe(50);
    expect(callArg.data.latencyMs).toBe(200);
    expect(callArg.data.model).toBe("gemini/gemini-2.5-flash");
    expect(callArg.data.source).toBe(LlmUsageSource.CONVERSATION);
  });

  test("OpenRouter: fetches cost from generation endpoint and writes to DB", async () => {
    process.env.LLM_BASE_URL = "https://openrouter.ai/api/v1";
    process.env.LLM_API_KEY = "test-key";
    global.fetch = mock(async (_url: RequestInfo | URL) =>
      new Response(JSON.stringify({ data: { total_cost: 0.00123 } }), { status: 200 }),
    ) as unknown as typeof fetch;

    await logLlmUsage(baseCtx, baseRaw);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArg = mockCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(callArg.data.costUsd).toBe(0.00123);
  });

  test("OpenRouter: fetches from correct URL with Authorization header", async () => {
    process.env.LLM_BASE_URL = "https://openrouter.ai/api/v1";
    process.env.LLM_API_KEY = "my-key";
    const capturedUrl: string[] = [];
    const capturedHeaders: Record<string, string>[] = [];
    global.fetch = mock(async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl.push(String(url));
      capturedHeaders.push((init?.headers ?? {}) as Record<string, string>);
      return new Response(JSON.stringify({ data: { total_cost: 0.001 } }), { status: 200 });
    }) as unknown as typeof fetch;

    await logLlmUsage(baseCtx, { ...baseRaw, generationId: "gen-xyz" });

    expect(capturedUrl[0]).toBe("https://openrouter.ai/api/v1/generation?id=gen-xyz");
    expect(capturedHeaders[0]?.Authorization).toBe("Bearer my-key");
  });

  test("OpenRouter: throws and skips DB write when generation fetch returns non-200", async () => {
    process.env.LLM_BASE_URL = "https://openrouter.ai/api/v1";
    global.fetch = mock(async () =>
      new Response("Not Found", { status: 404 }),
    ) as unknown as typeof fetch;

    await expect(logLlmUsage(baseCtx, baseRaw)).rejects.toThrow(
      "OpenRouter generation fetch failed: 404",
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("OpenRouter: throws when total_cost missing from response", async () => {
    process.env.LLM_BASE_URL = "https://openrouter.ai/api/v1";
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ data: {} }), { status: 200 }),
    ) as unknown as typeof fetch;

    await expect(logLlmUsage(baseCtx, baseRaw)).rejects.toThrow(
      "OpenRouter generation response missing total_cost",
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("writes optional token fields when provided", async () => {
    process.env.LLM_BASE_URL = "http://localhost:11434/v1";

    await logLlmUsage(baseCtx, {
      ...baseRaw,
      reasoningTokens: 30,
      cachedTokens: 10,
    });

    const callArg = mockCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(callArg.data.reasoningTokens).toBe(30);
    expect(callArg.data.cachedTokens).toBe(10);
  });

  test("writes null for optional token fields when not provided", async () => {
    process.env.LLM_BASE_URL = "http://localhost:11434/v1";

    await logLlmUsage(baseCtx, baseRaw);

    const callArg = mockCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(callArg.data.reasoningTokens).toBeNull();
    expect(callArg.data.cachedTokens).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test ./frontend/lib/__tests__/llm-usage.test.ts
```

Expected: FAIL — `Cannot find module '../llm-usage'`

- [ ] **Step 3: Create `frontend/lib/llm-usage.ts`**

```typescript
import { prisma } from "@/lib/prisma";
import type { LlmUsageSource } from "@/lib/generated/prisma";

export type UsageContext = {
  source: LlmUsageSource;
  conversationId?: string;
  agentSessionId?: string;
  userId?: string;
};

export type RawUsage = {
  generationId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cachedTokens?: number;
  latencyMs: number;
};

export function isOpenRouter(): boolean {
  return (process.env.LLM_BASE_URL ?? "").includes("openrouter.ai");
}

async function fetchOpenRouterCost(generationId: string): Promise<number> {
  const res = await fetch(
    `https://openrouter.ai/api/v1/generation?id=${generationId}`,
    { headers: { Authorization: `Bearer ${process.env.LLM_API_KEY}` } },
  );
  if (!res.ok) {
    throw new Error(`OpenRouter generation fetch failed: ${res.status}`);
  }
  const body = (await res.json()) as { data?: { total_cost?: number } };
  const cost = body.data?.total_cost;
  if (cost === undefined) {
    throw new Error("OpenRouter generation response missing total_cost");
  }
  return cost;
}

export async function logLlmUsage(ctx: UsageContext, raw: RawUsage): Promise<void> {
  const costUsd = isOpenRouter() ? await fetchOpenRouterCost(raw.generationId) : null;
  await prisma.llmUsage.create({
    data: {
      source: ctx.source,
      conversationId: ctx.conversationId ?? null,
      agentSessionId: ctx.agentSessionId ?? null,
      userId: ctx.userId ?? null,
      model: raw.model,
      inputTokens: raw.inputTokens,
      outputTokens: raw.outputTokens,
      reasoningTokens: raw.reasoningTokens ?? null,
      cachedTokens: raw.cachedTokens ?? null,
      costUsd,
      latencyMs: raw.latencyMs,
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test ./frontend/lib/__tests__/llm-usage.test.ts
```

Expected: all tests PASS (8 tests, 0 failures).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/llm-usage.ts frontend/lib/__tests__/llm-usage.test.ts
git commit -m "feat: add logLlmUsage utility with OpenRouter cost support"
```

---

### Task 3: Instrument `orchestrator.ts` (non-streaming)

**Files:**
- Modify: `frontend/lib/orchestrator.ts`

- [ ] **Step 1: Add imports and update signature**

Replace the current file content with:

```typescript
import { createLLMClient } from "@/lib/llm-client";
import { logLlmUsage } from "@/lib/llm-usage";
import { LlmUsageSource } from "@/lib/generated/prisma";

type OrchestratorParticipant = {
  characterId: string;
  character: { name: string; sheet: unknown };
};

type OrchestratorMessage = {
  character: { name: string };
  content: string;
};

export async function selectNextSpeakerWithOrchestrator(
  participants: OrchestratorParticipant[],
  messages: OrchestratorMessage[],
  conversationId: string,
): Promise<string> {
  const model = process.env["CONVERSATION_MODEL"];

  if (!model) {
    console.error("[orchestrator] CONVERSATION_MODEL env var not set");
    return fallback(participants, messages);
  }

  const charactersList = participants
    .map(
      (p) =>
        `- id: ${p.characterId} | Name: ${p.character.name}` +
        (p.character.sheet != null
          ? ` | Character sheet: ${JSON.stringify(p.character.sheet)}`
          : "")
    )
    .join("\n");

  const historyText =
    messages.length > 0
      ? messages.map((m) => `[${m.character.name}]: ${m.content}`).join("\n")
      : "(The scene has just begun — no lines have been spoken yet.)";

  const userMessage = [
    "Characters:",
    charactersList,
    "",
    "Conversation so far:",
    historyText,
    "",
    "Which character should speak next? Reply with their characterId only.",
  ].join("\n");

  const client = createLLMClient();
  const startTime = Date.now();
  let response: Awaited<ReturnType<typeof client.chat.completions.create>>;

  try {
    response = await client.chat.completions.create({
      model,
      max_tokens: 64,
      messages: [
        {
          role: "system",
          content:
            "You are a conversation director for a multi-character roleplay scene. " +
            "Given the characters and conversation history below, decide which character " +
            "should speak next to make the conversation feel natural and engaging. " +
            "Reply with only the characterId of the chosen character, nothing else.",
        },
        { role: "user", content: userMessage },
      ],
    });
  } catch (err) {
    console.error("[orchestrator] Error:", err);
    return fallback(participants, messages);
  }

  await logLlmUsage(
    { source: LlmUsageSource.ORCHESTRATOR, conversationId },
    {
      generationId: response.id,
      model,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? undefined,
      reasoningTokens: response.usage?.completion_tokens_details?.reasoning_tokens ?? undefined,
      latencyMs: Date.now() - startTime,
    },
  );

  const chosen = (response.choices[0]?.message.content ?? "").trim();

  if (participants.some((p) => p.characterId === chosen)) {
    return chosen;
  }

  console.error(`[orchestrator] Invalid characterId returned: "${chosen}"`);
  return fallback(participants, messages);
}

function fallback(
  participants: OrchestratorParticipant[],
  messages: OrchestratorMessage[],
): string {
  return participants[messages.length % participants.length]!.characterId;
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck 2>&1 | grep -E "orchestrator|error TS" | head -20
```

Expected: no errors related to `orchestrator.ts`.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/orchestrator.ts
git commit -m "feat: instrument orchestrator with LLM usage tracking"
```

---

### Task 4: Instrument `improve-context/route.ts` (non-streaming)

**Files:**
- Modify: `frontend/app/api/conversations/improve-context/route.ts`

- [ ] **Step 1: Add import**

At the top of the file, after the existing imports, add:

```typescript
import { logLlmUsage } from "@/lib/llm-usage";
import { LlmUsageSource } from "@/lib/generated/prisma";
```

- [ ] **Step 2: Capture response and add usage logging**

In the `POST` handler, replace this block:

```typescript
  try {
    const response = await client.chat.completions.create({
      model,
      max_tokens: 1024,
      temperature: 1,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });
    improved = (response.choices[0]?.message.content ?? "").trim();
  } catch (err) {
    llmError = String(err);
  } finally {
```

with:

```typescript
  let llmResponse: Awaited<ReturnType<typeof client.chat.completions.create>> | null = null;
  try {
    llmResponse = await client.chat.completions.create({
      model,
      max_tokens: 1024,
      temperature: 1,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });
    improved = (llmResponse.choices[0]?.message.content ?? "").trim();
  } catch (err) {
    llmError = String(err);
  } finally {
```

Then, after the `if (llmError != null) { return ... }` early-return block and before `if (!improved) { return ... }`, add:

```typescript
  await logLlmUsage(
    { source: LlmUsageSource.IMPROVE_CONTEXT, userId: user.id },
    {
      generationId: llmResponse!.id,
      model,
      inputTokens: llmResponse!.usage?.prompt_tokens ?? 0,
      outputTokens: llmResponse!.usage?.completion_tokens ?? 0,
      cachedTokens: llmResponse!.usage?.prompt_tokens_details?.cached_tokens ?? undefined,
      reasoningTokens: llmResponse!.usage?.completion_tokens_details?.reasoning_tokens ?? undefined,
      latencyMs: Date.now() - start,
    },
  );
```

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | grep -E "improve-context|error TS" | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/api/conversations/improve-context/route.ts
git commit -m "feat: instrument improve-context with LLM usage tracking"
```

---

### Task 5: Instrument `conversation/next.ts` (streaming)

**Files:**
- Modify: `frontend/lib/conversation/next.ts`

This task also updates the call to `selectNextSpeakerWithOrchestrator` to pass `conversationId`.

- [ ] **Step 1: Add imports**

At the top of `frontend/lib/conversation/next.ts`, after the existing imports, add:

```typescript
import type { CompletionUsage } from "openai/resources";
import { logLlmUsage } from "@/lib/llm-usage";
import { LlmUsageSource } from "@/lib/generated/prisma";
```

- [ ] **Step 2: Update orchestrator call to pass conversationId**

Find:
```typescript
    const characterId = await selectNextSpeakerWithOrchestrator(
      conversation.participants,
      conversation.messages,
    );
```

Replace with:
```typescript
    const characterId = await selectNextSpeakerWithOrchestrator(
      conversation.participants,
      conversation.messages,
      conversation.id,
    );
```

- [ ] **Step 3: Add streaming usage capture variables and startTime**

Find the line:
```typescript
  let content = "";
  let reasoningText = "";
  let parsedEmotion: Emotion | null = null;
```

Replace with:
```typescript
  let content = "";
  let reasoningText = "";
  let parsedEmotion: Emotion | null = null;
  let generationId = "";
  let finalUsage: CompletionUsage | null = null;
  const llmStartTime = Date.now();
```

- [ ] **Step 4: Add stream_options and capture generationId/usage in loop**

Find:
```typescript
    const stream = await client.chat.completions.create(
      {
        model,
        max_tokens: 768,
        stream: true,
        messages: [
          { role: "system" as const, content: systemPrompt },
          ...contentMessages,
        ],
        extra_headers: openrouterHeaders,
        extra_body: { reasoning: { effort: "none" } },
      } as ChatCompletionCreateParamsStreaming,
      { signal },
    );
```

Replace with:
```typescript
    const stream = await client.chat.completions.create(
      {
        model,
        max_tokens: 768,
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          { role: "system" as const, content: systemPrompt },
          ...contentMessages,
        ],
        extra_headers: openrouterHeaders,
        extra_body: { reasoning: { effort: "none" } },
      } as ChatCompletionCreateParamsStreaming,
      { signal },
    );
```

Then, in the `for await (const chunk of stream)` loop, find:
```typescript
      const token = chunk.choices[0]?.delta.content;
      if (!token) continue;
```

Replace with:
```typescript
      if (!generationId) generationId = chunk.id;
      if (chunk.usage) finalUsage = chunk.usage;
      const token = chunk.choices[0]?.delta.content;
      if (!token) continue;
```

- [ ] **Step 5: Call logLlmUsage after stream loop inside try block**

Find (near the end of the try block):
```typescript
    if (parsedEmotion === null) {
      onEmotion?.(FALLBACK_EMOTION);
      yield { type: "thinking_done" };
    }
  } catch (err) {
```

Replace with:
```typescript
    if (parsedEmotion === null) {
      onEmotion?.(FALLBACK_EMOTION);
      yield { type: "thinking_done" };
    }

    await logLlmUsage(
      { source: LlmUsageSource.CONVERSATION, conversationId, userId },
      {
        generationId,
        model,
        inputTokens: finalUsage?.prompt_tokens ?? 0,
        outputTokens: finalUsage?.completion_tokens ?? 0,
        cachedTokens: finalUsage?.prompt_tokens_details?.cached_tokens ?? undefined,
        reasoningTokens: finalUsage?.completion_tokens_details?.reasoning_tokens ?? undefined,
        latencyMs: Date.now() - llmStartTime,
      },
    );
  } catch (err) {
```

- [ ] **Step 6: Typecheck**

```bash
bun run typecheck 2>&1 | grep -E "conversation/next|error TS" | head -20
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/conversation/next.ts
git commit -m "feat: instrument conversation next-turn with LLM usage tracking"
```

---

### Task 6: Instrument `agent/loop.ts` (streaming, multi-turn)

**Files:**
- Modify: `frontend/lib/agent/loop.ts`

- [ ] **Step 1: Add imports**

At the top of `frontend/lib/agent/loop.ts`, after the existing imports, add:

```typescript
import { logLlmUsage, type UsageContext } from "@/lib/llm-usage";
import { LlmUsageSource } from "@/lib/generated/prisma";
```

- [ ] **Step 2: Update `runAgentLoop` signature**

Find:
```typescript
export async function runAgentLoop(
  priorMessages: ChatCompletionMessageParam[],
  userMessage: string,
  mcpSession: McpSession,
  onChunk: (data: Uint8Array) => void,
): Promise<{ messages: ChatCompletionMessageParam[]; assistantText: string; toolCallsJson: unknown }> {
```

Replace with:
```typescript
export async function runAgentLoop(
  priorMessages: ChatCompletionMessageParam[],
  userMessage: string,
  mcpSession: McpSession,
  onChunk: (data: Uint8Array) => void,
  ctx: UsageContext,
): Promise<{ messages: ChatCompletionMessageParam[]; assistantText: string; toolCallsJson: unknown }> {
```

- [ ] **Step 3: Add per-iteration timing and usage logging**

Find (inside the while loop):
```typescript
  while (true) {
    const stream = client.chat.completions.stream({
      model: process.env["CONVERSATION_MODEL"] ?? "default",
      max_tokens: 4096,
      messages: [
        { role: "system", content: AGENT_SYSTEM_PROMPT },
        ...messages,
      ],
      tools,
    });
```

Replace with:
```typescript
  while (true) {
    const iterStartTime = Date.now();
    const stream = client.chat.completions.stream({
      model: process.env["CONVERSATION_MODEL"] ?? "default",
      max_tokens: 4096,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: AGENT_SYSTEM_PROMPT },
        ...messages,
      ],
      tools,
    });
```

Then find:
```typescript
    const finalMessage = await stream.finalChatCompletion();
    const choice = finalMessage.choices[0];
    if (!choice) break;
```

Replace with:
```typescript
    const finalMessage = await stream.finalChatCompletion();

    await logLlmUsage(ctx, {
      generationId: finalMessage.id,
      model: process.env["CONVERSATION_MODEL"] ?? "default",
      inputTokens: finalMessage.usage?.prompt_tokens ?? 0,
      outputTokens: finalMessage.usage?.completion_tokens ?? 0,
      cachedTokens: finalMessage.usage?.prompt_tokens_details?.cached_tokens ?? undefined,
      reasoningTokens: finalMessage.usage?.completion_tokens_details?.reasoning_tokens ?? undefined,
      latencyMs: Date.now() - iterStartTime,
    });

    const choice = finalMessage.choices[0];
    if (!choice) break;
```

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck 2>&1 | grep -E "agent/loop|error TS" | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/agent/loop.ts
git commit -m "feat: instrument agent loop with per-iteration LLM usage tracking"
```

---

### Task 7: Instrument `api/chat/stream/route.ts`

**Files:**
- Modify: `frontend/app/api/chat/stream/route.ts`

This task: (1) passes `UsageContext` to `runAgentLoop`, (2) logs usage in `autoTitle`.

- [ ] **Step 1: Add imports**

After the existing imports, add:

```typescript
import { logLlmUsage } from "@/lib/llm-usage";
import { LlmUsageSource } from "@/lib/generated/prisma";
```

- [ ] **Step 2: Pass ctx to runAgentLoop**

Find:
```typescript
        const { assistantText, toolCallsJson } = await runAgentLoop(
          priorMessages,
          message,
          mcpSession,
          onChunk,
        );
```

Replace with:
```typescript
        const { assistantText, toolCallsJson } = await runAgentLoop(
          priorMessages,
          message,
          mcpSession,
          onChunk,
          { source: LlmUsageSource.AGENT_SESSION, agentSessionId: sessionId, userId: user.id },
        );
```

- [ ] **Step 3: Add usage logging to autoTitle**

Find:
```typescript
async function autoTitle(sessionId: string, firstMessage: string): Promise<void> {
  try {
    const client = createLLMClient();
    const response = await client.chat.completions.create({
      model: process.env["CONVERSATION_MODEL"] ?? "default",
      max_tokens: 20,
      messages: [
        {
          role: "system",
          content:
            "Generate a 3-6 word title for a chat session. Reply with ONLY the title, no punctuation.",
        },
        { role: "user", content: firstMessage },
      ],
    });
    const text = response.choices[0]?.message.content ?? "";
    if (text) {
      await setSessionTitle(prisma, sessionId, text.slice(0, 100));
    }
  } catch (err) {
    console.error("autoTitle failed:", err);
  }
}
```

Replace with:
```typescript
async function autoTitle(sessionId: string, firstMessage: string, userId: string): Promise<void> {
  try {
    const client = createLLMClient();
    const startTime = Date.now();
    const model = process.env["CONVERSATION_MODEL"] ?? "default";
    const response = await client.chat.completions.create({
      model,
      max_tokens: 20,
      messages: [
        {
          role: "system",
          content:
            "Generate a 3-6 word title for a chat session. Reply with ONLY the title, no punctuation.",
        },
        { role: "user", content: firstMessage },
      ],
    });
    await logLlmUsage(
      { source: LlmUsageSource.AGENT_SESSION, agentSessionId: sessionId, userId },
      {
        generationId: response.id,
        model,
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? undefined,
        reasoningTokens: response.usage?.completion_tokens_details?.reasoning_tokens ?? undefined,
        latencyMs: Date.now() - startTime,
      },
    );
    const text = response.choices[0]?.message.content ?? "";
    if (text) {
      await setSessionTitle(prisma, sessionId, text.slice(0, 100));
    }
  } catch (err) {
    console.error("autoTitle failed:", err);
  }
}
```

- [ ] **Step 4: Update autoTitle call to pass userId**

Find:
```typescript
        if (isFirstTurn) {
          void autoTitle(sessionId, message);
        }
```

Replace with:
```typescript
        if (isFirstTurn) {
          void autoTitle(sessionId, message, user.id);
        }
```

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck 2>&1 | grep -E "chat/stream|error TS" | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/api/chat/stream/route.ts
git commit -m "feat: instrument agent stream route with LLM usage tracking"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run all tests**

```bash
bun test ./frontend/lib/__tests__/llm-usage.test.ts
```

Expected: 8 tests pass, 0 fail.

- [ ] **Step 2: Full typecheck**

```bash
bun run typecheck 2>&1
```

Expected: no errors (0 diagnostics).

- [ ] **Step 3: Build**

```bash
bun run build 2>&1 | tail -10
```

Expected: `✓ Compiled successfully` with no errors.

- [ ] **Step 4: Verify schema migration applied**

```bash
bun run prisma:studio
```

Open `http://localhost:5555` in browser, navigate to `LlmUsage` table — it should exist with the correct columns.

Alternatively check via psql:
```bash
bun run prisma:migrate:status 2>&1 | tail -5
```

Expected: `All migrations have been applied.`

- [ ] **Step 5: Final commit if any cleanup needed**

```bash
git status
```

If clean, no commit needed. If there are any stray changes, commit them with:
```bash
git commit -m "chore: cleanup after LLM usage tracking implementation"
```
