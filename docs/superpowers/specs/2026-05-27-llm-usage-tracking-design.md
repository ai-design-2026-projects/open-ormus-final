# LLM Usage Tracking — Design

**Date:** 2026-05-27  
**Branch:** `worktree-llm-usage`

---

## Goal

Track every LLM API call: token counts (input, output, reasoning, cached), cost in USD (OpenRouter only), latency, model, and source context. Store in Postgres via Prisma. Hard fail on tracking errors so records are complete.

---

## Decisions

| Question | Decision |
|---|---|
| Storage | Prisma DB (new `LlmUsage` table) |
| Cost | OpenRouter only — detect via `LLM_BASE_URL` containing `openrouter.ai` |
| Scope | All 6 LLM call sites |
| Error mode | Hard fail — tracking errors propagate upstream |
| Context | Track source type + optional conversationId / agentSessionId / userId |
| Streaming cost | Follow-up `GET /api/v1/generation?id={id}` after stream completes |

---

## LLM Call Sites (6 total)

| # | File | Source enum | Context available | Mode |
|---|------|------------|-------------------|------|
| 1 | `frontend/lib/conversation/next.ts` | `CONVERSATION` | `conversationId`, `userId` | streaming |
| 2 | `frontend/lib/orchestrator.ts` | `ORCHESTRATOR` | `conversationId` (add param) | non-streaming |
| 3 | `frontend/lib/agent/loop.ts` | `AGENT_SESSION` | `agentSessionId`, `userId` (add params) | streaming, multi-turn |
| 4 | `frontend/app/api/chat/stream/route.ts` → `autoTitle` | `AGENT_SESSION` | `sessionId`, `userId` | non-streaming, fire-and-forget |
| 5 | `frontend/app/api/conversations/improve-context/route.ts` | `IMPROVE_CONTEXT` | `userId` | non-streaming |
| 6 | `frontend/app/api/chat/stream/route.ts` → main loop via `runAgentLoop` | `AGENT_SESSION` | `sessionId`, `userId` (passed to loop) | streaming via #3 |

Note: call sites 3 and 6 are the same code path — `runAgentLoop` handles logging internally, the route handler passes context.

Note on `autoTitle` (site 4): already wrapped in `try-catch` that swallows errors. Tracking hard-fail inside `autoTitle` will be caught by its own catch block and logged to stderr — effectively fire-and-forget for this site only. This is an acceptable exception given `autoTitle` is non-critical.

---

## Data Model

### New enum + model in `prisma/schema.prisma`

```prisma
enum LlmUsageSource {
  CONVERSATION
  ORCHESTRATOR
  AGENT_SESSION
  IMPROVE_CONTEXT
  OTHER
}

model LlmUsage {
  id              String         @id @default(cuid())
  createdAt       DateTime       @default(now())
  source          LlmUsageSource
  conversationId  String?
  agentSessionId  String?
  userId          String?
  model           String
  inputTokens     Int
  outputTokens    Int
  reasoningTokens Int?
  cachedTokens    Int?
  costUsd         Float?
  latencyMs       Int

  conversation    Conversation?  @relation(fields: [conversationId], references: [id])
  agentSession    AgentSession?  @relation(fields: [agentSessionId], references: [id])
  user            User?          @relation(fields: [userId], references: [id])
}
```

Add back-relations to existing models:
- `Conversation` → `usages LlmUsage[]`
- `AgentSession` → `usages LlmUsage[]`
- `User` → `usages LlmUsage[]`

---

## Utility: `frontend/lib/llm-usage.ts` (new file)

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
  generationId: string;   // response.id from OpenAI SDK
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

// Throws if fetch fails or total_cost missing.
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

// Hard fail: throws on any error (DB write or cost fetch).
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

---

## Call Site Changes

### Non-streaming pattern (orchestrator, improve-context, autoTitle)

```typescript
const startTime = Date.now();
const response = await client.chat.completions.create({ model, ... });
await logLlmUsage(ctx, {
  generationId: response.id,
  model,
  inputTokens: response.usage?.prompt_tokens ?? 0,
  outputTokens: response.usage?.completion_tokens ?? 0,
  cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens,
  reasoningTokens: response.usage?.completion_tokens_details?.reasoning_tokens,
  latencyMs: Date.now() - startTime,
});
```

### Streaming pattern — `conversation/next.ts`

1. Add `stream_options: { include_usage: true }` to the `create()` call.
2. In the `for await` loop, capture `generationId = chunk.id` from the first chunk.
3. After the loop, read usage from the final chunk (the one with `choices: []`). Capture it into a local variable during iteration.
4. Call `logLlmUsage` after the stream loop, before saving the message to DB.

```typescript
const startTime = Date.now();
let generationId = "";
let finalUsage: OpenAI.CompletionUsage | null = null;

for await (const chunk of stream) {
  if (!generationId) generationId = chunk.id;
  if (chunk.usage) finalUsage = chunk.usage;
  // ... existing token parsing logic ...
}

await logLlmUsage(
  { source: "CONVERSATION", conversationId, userId },
  {
    generationId,
    model,
    inputTokens: finalUsage?.prompt_tokens ?? 0,
    outputTokens: finalUsage?.completion_tokens ?? 0,
    cachedTokens: finalUsage?.prompt_tokens_details?.cached_tokens,
    reasoningTokens: finalUsage?.completion_tokens_details?.reasoning_tokens,
    latencyMs: Date.now() - startTime,
  },
);
// then: await prisma.message.create(...)
```

### Streaming pattern — `agent/loop.ts`

`runAgentLoop` receives a new `ctx: UsageContext` parameter. In each while-loop iteration:

1. Record `iterStartTime = Date.now()` before `.stream()`.
2. After `finalChatCompletion()`, extract `finalMessage.usage` and `finalMessage.id`.
3. Call `logLlmUsage(ctx, { ... })`.
4. Error propagates — breaks out of the agent loop and surfaces to the route handler.

```typescript
export async function runAgentLoop(
  priorMessages: ChatCompletionMessageParam[],
  userMessage: string,
  mcpSession: McpSession,
  onChunk: (data: Uint8Array) => void,
  ctx: UsageContext,   // NEW
): Promise<{ messages: ChatCompletionMessageParam[]; assistantText: string; toolCallsJson: unknown }>
```

The route handler (`api/chat/stream/route.ts`) passes:
```typescript
{ source: "AGENT_SESSION", agentSessionId: sessionId, userId: user.id }
```

### Signature changes needed

**`orchestrator.ts`:** Add `conversationId: string` parameter.

**`conversation/next.ts`:** Already has `conversationId` and `userId` — no signature change needed, but must pass `userId` down to orchestrator call.

**`runAgentLoop`:** Add `ctx: UsageContext` parameter.

---

## OpenRouter Cost — Streaming Flow

```
stream starts
  └─ capture chunk.id (generationId) from first chunk
stream ends
  └─ logLlmUsage() called
       └─ isOpenRouter() → true
            └─ GET /api/v1/generation?id={generationId}
                 └─ response.data.total_cost → costUsd
                      └─ prisma.llmUsage.create()
```

The follow-up GET adds ~100–300ms after stream completion. Since this is a server-side operation (after SSE stream is flushed to client), it does not add visible latency to the user.

---

## Error Handling

| Site | On tracking failure |
|------|---------------------|
| `conversation/next.ts` | Rethrow as `ConversationError("LITELLM_ERROR", ...)` — no message saved |
| `orchestrator.ts` | Propagates as plain `Error` — caller in `next.ts` catches and rethrows |
| `agent/loop.ts` | Propagates out of while loop → route handler catches → SSE `error` chunk |
| `improve-context/route.ts` | Returns 500 |
| `autoTitle` | Caught by existing try-catch → logged to stderr only (exception to hard-fail rule) |

---

## Migration

Run after schema changes:
```bash
bun run prisma:migrate:dev
bun run prisma:generate
bun run typecheck
```

No data migration needed — new table starts empty.

---

## Out of Scope

- Cost tracking for non-OpenRouter providers
- Usage dashboard / UI
- Alerting on cost thresholds
- Prompt hash logging (not requested)
