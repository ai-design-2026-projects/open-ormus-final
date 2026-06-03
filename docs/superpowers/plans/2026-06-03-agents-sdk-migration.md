# OpenAI Agents SDK Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-rolled chat-completions agent loop and raw MCP fetch bridge with the OpenAI Agents SDK (`@openai/agents`), keeping the frontend SSE protocol and per-call usage logging intact.

**Architecture:** A per-request `Agent` runs via `Runner.run(..., { stream:true })` in chat-completions mode against OpenRouter. A native `MCPServerStreamableHttp` (JWT header) auto-discovers tools, replacing the hand-written schemas. SDK run events are mapped to the existing `StreamChunk` SSE protocol. Per-LLM-call usage is logged by wrapping the model.

**Tech Stack:** Next.js 16 App Router, `@openai/agents` (chat-completions mode), `openai` SDK client, `@modelcontextprotocol/sdk` server (unchanged), Prisma 7, Bun test.

**Spec:** `docs/superpowers/specs/2026-06-03-agents-sdk-migration-design.md`

---

## File Structure

- `frontend/lib/agent/sdk.ts` — **new.** Global SDK config (custom client, chat-completions mode, tracing off) + the usage-logging model wrapper. One responsibility: SDK/provider wiring.
- `frontend/lib/agent/mcp_bridge.ts` — **rewritten.** Single `createMcpServer(jwt)` factory returning a connected-on-demand `MCPServerStreamableHttp`. All fetch/JSON-RPC and hand-written schemas deleted.
- `frontend/lib/agent/stream.ts` — **extended.** `StreamChunk` + `encodeChunk` unchanged; add pure `mapRunEvent`.
- `frontend/lib/agent/loop.ts` — **rewritten.** Thin `runAgent` that builds the agent, runs the streamed Runner, maps events, returns accumulated items + error.
- `frontend/lib/agent/history.ts` — **rewritten.** Persist/reload SDK `AgentInputItem[]` via a new `item` JSON column.
- `frontend/lib/agent/types.ts` — **deleted.** `AnthropicTool` no longer used.
- `frontend/app/api/chat/stream/route.ts` — **edited.** Wire `runAgent` + MCP connect/close lifecycle.
- `prisma/schema.prisma` — **edited.** Add `AgentTurn.item Json?`.

---

## Task 0: Spike — install the SDK and confirm its shapes

De-risks R1/R2/R3 before the rewrite. Produces a short findings note that later tasks reference. No production code is kept from this task except the dependency.

**Files:**
- Modify: `package.json` / `frontend/package.json` (add dependency)
- Create (throwaway): `frontend/lib/agent/_spike.ts`
- Create: `docs/superpowers/plans/2026-06-03-spike-findings.md`

- [ ] **Step 1: Get approval and add the dependency**

AGENTS.md §10 requires explicit approval for new deps. Confirm with the user, then:

```bash
cd frontend && bun add @openai/agents && cd ..
```

Expected: `@openai/agents` appears in `frontend/package.json` dependencies.

- [ ] **Step 2: Confirm chat-completions mode against OpenRouter**

Create `frontend/lib/agent/_spike.ts`:

```ts
import OpenAI from "openai";
import {
  Agent,
  Runner,
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled,
  OpenAIChatCompletionsModel,
} from "@openai/agents";

const client = new OpenAI({
  baseURL: process.env["LLM_BASE_URL"],
  apiKey: process.env["LLM_API_KEY"],
});
setDefaultOpenAIClient(client);
setOpenAIAPI("chat_completions");
setTracingDisabled(true);

async function main() {
  const model = new OpenAIChatCompletionsModel(client, process.env["CONVERSATION_MODEL"] ?? "default");
  const agent = new Agent({ name: "spike", instructions: "Reply with one word.", model });
  const stream = await new Runner().run(agent, "say hi", { stream: true });
  for await (const event of stream) {
    console.log("EVENT_TYPE:", event.type, JSON.stringify(event).slice(0, 300));
  }
  console.log("FINAL_USAGE:", JSON.stringify((stream as unknown as { finalResult?: { usage?: unknown } }).finalResult?.usage));
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Run: `bun run frontend/lib/agent/_spike.ts`
Expected: a stream of events ending in a final output; capture exact `event.type` strings for text deltas. Record them in the findings doc (resolves the **R-stream** part of streaming).

- [ ] **Step 3: Confirm MCP native client, auth header, and tool names (R1)**

Start the MCP server (`bun run dev:mcp`). Extend `_spike.ts` `main()` to mint a JWT and attach an MCP server:

```ts
import { generateToolToken } from "@/lib/agent/token";
import { MCPServerStreamableHttp } from "@openai/agents";

const jwt = generateToolToken("00000000-0000-0000-0000-000000000000");
const mcp = new MCPServerStreamableHttp({
  url: process.env["MCP_SERVER_URL"] ?? "http://localhost:3001/mcp",
  name: "openormus",
  requestInit: { headers: { Authorization: `Bearer ${jwt}` } },
});
await mcp.connect();
const tools = await mcp.listTools();
console.log("TOOL_NAMES:", tools.map((t: { name: string }) => t.name));
await mcp.close();
```

Run: `bun run frontend/lib/agent/_spike.ts`
Expected: `TOOL_NAMES` prints the discovered names. **Record whether they are exactly `mcp__openormus__show_research` etc. or prefixed/renamed by the SDK.** This decides whether Task 4's `mapRunEvent` needs a name transform (R1).

- [ ] **Step 4: Confirm per-call usage interception point (R2)**

In `_spike.ts`, subclass the model and log per call:

```ts
class ProbeModel extends OpenAIChatCompletionsModel {
  async *getStreamedResponse(request: Parameters<OpenAIChatCompletionsModel["getStreamedResponse"]>[0]) {
    const start = Date.now();
    for await (const event of super.getStreamedResponse(request)) {
      console.log("RAW_EVENT:", event.type, JSON.stringify(event).slice(0, 200));
      yield event;
    }
    console.log("CALL_DONE latencyMs:", Date.now() - start);
  }
}
```

Run a multi-tool prompt (e.g. "research Walter White from Breaking Bad and create him") with the agent using `ProbeModel` + the MCP server.
Expected: one `CALL_DONE` per LLM round; identify which raw event carries `usage` (tokens, cached, reasoning) and the generation id. **Record the exact field paths** — Task 1 reads them.

- [ ] **Step 5: Confirm abort + partial history (R3)**

Pass an `AbortController` signal to `Runner.run(agent, input, { stream: true, signal: ac.signal })`, abort mid-run, and inspect what the stream's final result exposes for already-completed items.
Expected: record the property that yields completed items after abort (e.g. `stream.history` / `finalResult.history` / `result.newItems`). Task 5 persists from it.

- [ ] **Step 6: Write findings and delete the spike**

Write `docs/superpowers/plans/2026-06-03-spike-findings.md` with: text-delta event type, tool-call/output event types and item shapes, discovered tool names (+ transform needed?), usage field paths + generation-id path, abort/partial-history property, and `maxTurns`/`MaxTurnsExceededError` import path.

```bash
rm frontend/lib/agent/_spike.ts
git add frontend/package.json frontend/bun.lock docs/superpowers/plans/2026-06-03-spike-findings.md
git commit -m "chore: add @openai/agents and record SDK shape findings"
```

> The code blocks in Tasks 1–6 are written to the most likely SDK signatures. Where a step is marked **(reconcile with Task 0)**, adjust field/event names to the findings before running.

---

## Task 1: SDK bootstrap + usage-logging model wrapper

**Files:**
- Create: `frontend/lib/agent/sdk.ts`

- [ ] **Step 1: Write the bootstrap module**

```ts
import OpenAI from "openai";
import {
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled,
  OpenAIChatCompletionsModel,
} from "@openai/agents";
import { logLlmUsage, type UsageContext } from "@/lib/llm-usage";

// Custom OpenAI-compatible client (OpenRouter). Configured once at module load.
const client = new OpenAI({
  baseURL: process.env["LLM_BASE_URL"],
  apiKey: process.env["LLM_API_KEY"],
});

setDefaultOpenAIClient(client);
// Force chat-completions; never the Responses API (OpenRouter beta is out of scope).
setOpenAIAPI("chat_completions");
// No OpenAI tracing backend — usage is logged via logLlmUsage instead.
setTracingDisabled(true);

const MODEL_NAME = process.env["CONVERSATION_MODEL"] ?? "default";

/**
 * Model wrapper that logs one LlmUsage row per underlying LLM call, across
 * every tool round the Runner drives. The aggregate RunResult usage is not
 * sufficient (AGENTS.md requires per-call records).
 */
export class LoggingModel extends OpenAIChatCompletionsModel {
  constructor(private readonly ctx: UsageContext) {
    super(client, MODEL_NAME);
  }

  // (reconcile with Task 0) field paths for usage + id come from spike findings.
  override async *getStreamedResponse(
    request: Parameters<OpenAIChatCompletionsModel["getStreamedResponse"]>[0],
  ): ReturnType<OpenAIChatCompletionsModel["getStreamedResponse"]> {
    const start = Date.now();
    let usage: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
      completion_tokens_details?: { reasoning_tokens?: number };
    } | null = null;
    let generationId = "";

    for await (const event of super.getStreamedResponse(request)) {
      const raw = event as unknown as { type: string; response?: { id?: string; usage?: typeof usage } };
      if (raw.response?.id && !generationId) generationId = raw.response.id;
      if (raw.response?.usage) usage = raw.response.usage;
      yield event;
    }

    await logLlmUsage(this.ctx, {
      generationId,
      model: MODEL_NAME,
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      ...(usage?.prompt_tokens_details?.cached_tokens !== undefined
        ? { cachedTokens: usage.prompt_tokens_details.cached_tokens }
        : {}),
      ...(usage?.completion_tokens_details?.reasoning_tokens !== undefined
        ? { reasoningTokens: usage.completion_tokens_details.reasoning_tokens }
        : {}),
      latencyMs: Date.now() - start,
    });
  }
}

export { MODEL_NAME };
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS. If `getStreamedResponse` signature differs, align it with the findings from Task 0 Step 4, then re-run.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/agent/sdk.ts
git commit -m "feat: SDK bootstrap and per-call usage-logging model wrapper"
```

---

## Task 2: MCP server factory

**Files:**
- Modify (full rewrite): `frontend/lib/agent/mcp_bridge.ts`

- [ ] **Step 1: Replace the file contents**

```ts
import { MCPServerStreamableHttp } from "@openai/agents";

const MCP_URL = process.env["MCP_SERVER_URL"] ?? "http://localhost:3001/mcp";

export type AgentMcpServer = MCPServerStreamableHttp;

/**
 * Builds a native MCP client for the OpenORMUS tool server. The JWT carries
 * the only trusted tenancy source; the server derives userId from it. Tools
 * are auto-discovered — no hand-written schemas. Caller must connect() before
 * use and close() in a finally block.
 */
export function createMcpServer(jwt: string): AgentMcpServer {
  return new MCPServerStreamableHttp({
    url: MCP_URL,
    name: "openormus",
    requestInit: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: errors only in `loop.ts` / `route.ts` (they still import the deleted `buildMcpTools`/`initMcpSession`/`callMcpTool`). Those are fixed in Tasks 5–6. The `mcp_bridge.ts` file itself must type-check clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/agent/mcp_bridge.ts
git commit -m "feat: native MCP streamable-http server factory, drop fetch bridge"
```

---

## Task 3: Stream event mapper (TDD)

**Files:**
- Modify: `frontend/lib/agent/stream.ts`
- Test: `frontend/lib/agent/stream.test.ts`

- [ ] **Step 1: Write the failing test**

(reconcile with Task 0) The synthetic events below use the event/item type strings recorded in the spike. Update the literals if the findings differ.

```ts
import { test, expect } from "bun:test";
import { mapRunEvent } from "./stream";

test("text delta maps to text_delta chunk", () => {
  const event = { type: "raw_model_stream_event", data: { type: "output_text_delta", delta: "Hello" } };
  expect(mapRunEvent(event as never)).toEqual({ type: "text_delta", text: "Hello" });
});

test("tool call item maps to tool_start chunk", () => {
  const event = {
    type: "run_item_stream_event",
    item: { type: "tool_call_item", rawItem: { name: "mcp__openormus__character_list", arguments: "{}" } },
  };
  expect(mapRunEvent(event as never)).toEqual({
    type: "tool_start",
    tool: "mcp__openormus__character_list",
    input: {},
  });
});

test("tool output item maps to tool_result chunk with 300-char preview", () => {
  const big = "x".repeat(500);
  const event = {
    type: "run_item_stream_event",
    item: { type: "tool_call_output_item", rawItem: { name: "mcp__openormus__character_list" }, output: big },
  };
  const chunk = mapRunEvent(event as never);
  expect(chunk?.type).toBe("tool_result");
  if (chunk?.type === "tool_result") {
    expect(chunk.tool).toBe("mcp__openormus__character_list");
    expect(chunk.preview.length).toBe(300);
  }
});

test("unrelated events map to null", () => {
  expect(mapRunEvent({ type: "agent_updated_stream_event" } as never)).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test frontend/lib/agent/stream.test.ts`
Expected: FAIL — `mapRunEvent` is not exported.

- [ ] **Step 3: Implement `mapRunEvent`**

Append to `frontend/lib/agent/stream.ts` (leave `StreamChunk` and `encodeChunk` untouched):

```ts
import type { RunStreamEvent } from "@openai/agents";

/**
 * Maps an SDK run-stream event to a StreamChunk, or null when the event has no
 * frontend representation. (reconcile with Task 0) event/item type strings and
 * field paths come from the spike findings.
 */
export function mapRunEvent(event: RunStreamEvent): StreamChunk | null {
  if (event.type === "raw_model_stream_event") {
    const data = (event as unknown as { data?: { type?: string; delta?: string } }).data;
    if (data?.type === "output_text_delta" && typeof data.delta === "string") {
      return { type: "text_delta", text: data.delta };
    }
    return null;
  }

  if (event.type === "run_item_stream_event") {
    const item = (event as unknown as {
      item?: { type?: string; rawItem?: { name?: string; arguments?: string }; output?: unknown };
    }).item;
    if (!item) return null;

    if (item.type === "tool_call_item") {
      let input: unknown = {};
      try {
        input = JSON.parse(item.rawItem?.arguments ?? "{}");
      } catch {
        input = {};
      }
      return { type: "tool_start", tool: item.rawItem?.name ?? "", input };
    }

    if (item.type === "tool_call_output_item") {
      const preview = JSON.stringify(item.output).slice(0, 300);
      return { type: "tool_result", tool: item.rawItem?.name ?? "", preview };
    }
  }

  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test frontend/lib/agent/stream.test.ts`
Expected: PASS (4 tests). If event shapes differ from the spike, fix the field paths in both test and implementation.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/agent/stream.ts frontend/lib/agent/stream.test.ts
git commit -m "feat: map SDK run events to StreamChunk SSE protocol"
```

---

## Task 4: History — SDK item storage (schema + TDD round-trip)

**Files:**
- Modify: `prisma/schema.prisma:115-128`
- Modify (rewrite of mapping logic): `frontend/lib/agent/history.ts`
- Test: `frontend/lib/agent/history.test.ts`

- [ ] **Step 1: Add the `item` column**

Edit `model AgentTurn` (the `content` field becomes optional since reasoning/tool items may have no text; the full SDK item lives in `item`):

```prisma
model AgentTurn {
  id        String       @id @default(uuid()) @db.Uuid
  sessionId String       @db.Uuid @map("session_id")
  seq       Int          @default(autoincrement())
  role      String
  content   String       @default("")
  item      Json?
  toolCalls Json?        @map("tool_calls")
  createdAt DateTime     @default(now()) @map("created_at")

  session AgentSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId, seq])
  @@map("agent_turns")
}
```

- [ ] **Step 2: Create the migration and regenerate the client**

Run:
```bash
bun run prisma:migrate:dev --name agent_turn_item
bun run prisma:generate
```
Expected: a new migration under `prisma/migrations/`, client regenerated, no errors.

- [ ] **Step 3: Write the failing round-trip test**

Pure serialize/deserialize helpers are unit-tested without a DB.

```ts
import { test, expect } from "bun:test";
import { itemsToRows, rowsToItems } from "./history";
import type { AgentInputItem } from "@openai/agents";

test("items survive a rows round-trip", () => {
  const items = [
    { type: "message", role: "user", content: "hi" },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "hello" }] },
  ] as unknown as AgentInputItem[];

  const rows = itemsToRows("session-1", items);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ sessionId: "session-1", role: "user" });

  const restored = rowsToItems(rows.map((r) => ({ role: r.role, content: r.content, item: r.item })));
  expect(restored).toEqual(items);
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `bun test frontend/lib/agent/history.test.ts`
Expected: FAIL — `itemsToRows` / `rowsToItems` not exported.

- [ ] **Step 5: Rewrite `history.ts`**

Replace `appendTurns` and `getSessionMessages` to store/read SDK items. `createSession`, `listSessions`, `setSessionTitle` are unchanged.

```ts
import type { PrismaClient } from "@/lib/generated/prisma/client";
import { Prisma } from "@/lib/generated/prisma/client";
import type { AgentInputItem } from "@openai/agents";

// ... createSession / AgentSessionSummary unchanged ...

type TurnRow = { sessionId: string; role: string; content: string; item: Prisma.InputJsonValue };

/** Serializes SDK items to AgentTurn row data. Pure — unit tested. */
export function itemsToRows(sessionId: string, items: AgentInputItem[]): TurnRow[] {
  return items.map((item) => {
    const role = (item as { role?: string; type?: string }).role
      ?? (item as { type?: string }).type
      ?? "item";
    const text = extractText(item);
    return { sessionId, role, content: text, item: item as unknown as Prisma.InputJsonValue };
  });
}

/** Rebuilds SDK items from stored rows. Pure — unit tested. */
export function rowsToItems(rows: { role: string; content: string; item: unknown }[]): AgentInputItem[] {
  return rows
    .filter((r) => r.item != null)
    .map((r) => r.item as AgentInputItem);
}

function extractText(item: AgentInputItem): string {
  const content = (item as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === "object" && c && "text" in c ? String((c as { text: unknown }).text) : ""))
      .join("");
  }
  return "";
}

export async function appendTurns(
  prisma: PrismaClient,
  sessionId: string,
  newItems: AgentInputItem[],
): Promise<void> {
  const data = itemsToRows(sessionId, newItems);
  if (data.length === 0) return;
  // Row lock serializes concurrent appends to one session so the global seq
  // sequence is not interleaved (preserves message order on reload).
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM agent_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
    await tx.agentTurn.createMany({ data });
  });
}

export async function getSessionMessages(
  prisma: PrismaClient,
  sessionId: string,
  userId: string,
): Promise<AgentInputItem[]> {
  const session = await prisma.agentSession.findFirst({
    where: { id: sessionId, userId },
    include: { turns: { orderBy: { seq: "asc" } } },
  });
  if (!session) return [];
  return rowsToItems(session.turns.map((t) => ({ role: t.role, content: t.content, item: t.item })));
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test frontend/lib/agent/history.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations frontend/lib/agent/history.ts frontend/lib/agent/history.test.ts
git commit -m "feat: persist agent history as SDK items"
```

---

## Task 5: `runAgent` — the loop replacement

**Files:**
- Modify (full rewrite): `frontend/lib/agent/loop.ts`

- [ ] **Step 1: Replace the file contents**

(reconcile with Task 0) `maxTurns`/`MaxTurnsExceededError` import and the partial-history property come from the spike.

```ts
import { Agent, Runner, MaxTurnsExceededError } from "@openai/agents";
import type { AgentInputItem } from "@openai/agents";
import { LoggingModel } from "./sdk";
import { encodeChunk, mapRunEvent } from "./stream";
import { AGENT_SYSTEM_PROMPT } from "./prompt";
import type { AgentMcpServer } from "./mcp_bridge";
import type { UsageContext } from "@/lib/llm-usage";
import { LlmUsageSource } from "@/lib/generated/prisma/client";

const MAX_TURNS = Number(process.env["AGENT_MAX_ITERATIONS"] ?? 12);

export async function runAgent(
  priorItems: AgentInputItem[],
  userMessage: string,
  mcpServer: AgentMcpServer,
  onChunk: (data: Uint8Array) => void,
  ctx: UsageContext = { source: LlmUsageSource.AGENT_SESSION },
  signal?: AbortSignal,
): Promise<{ items: AgentInputItem[]; error: Error | null }> {
  const send = (chunk: Parameters<typeof encodeChunk>[0]) => onChunk(encodeChunk(chunk));

  const input: AgentInputItem[] = [
    ...priorItems,
    { type: "message", role: "user", content: userMessage } as AgentInputItem,
  ];

  const agent = new Agent({
    name: "openormus",
    instructions: AGENT_SYSTEM_PROMPT,
    model: new LoggingModel(ctx),
    mcpServers: [mcpServer],
  });

  let error: Error | null = null;
  let finalItems: AgentInputItem[] = input;

  try {
    const stream = await new Runner().run(agent, input, {
      stream: true,
      maxTurns: MAX_TURNS,
      ...(signal ? { signal } : {}),
    });

    for await (const event of stream) {
      const chunk = mapRunEvent(event);
      if (chunk) send(chunk);
    }
    await stream.completed;
    // (reconcile with Task 0) `history` is the full item list after the run.
    finalItems = stream.history as AgentInputItem[];
  } catch (err) {
    if (err instanceof MaxTurnsExceededError) {
      send({ type: "text_delta", text: "\n\n[Stopped: reached maximum tool-call rounds.]" });
    } else {
      const isAbort = signal?.aborted || (err instanceof Error && err.name === "AbortError");
      if (!isAbort) error = err instanceof Error ? err : new Error("Agent run failed");
    }
    // (reconcile with Task 0) recover completed items after abort/error/cap.
    const partial = (err as { state?: { history?: AgentInputItem[] } })?.state?.history;
    if (Array.isArray(partial)) finalItems = partial;
  }

  return { items: finalItems, error };
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: errors only in `route.ts` (still calls the old `runAgentLoop` signature). `loop.ts` itself must type-check clean. Adjust `stream.history` / partial-history access to the exact properties from Task 0 Step 5.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/agent/loop.ts
git commit -m "feat: replace hand-rolled loop with Agents SDK Runner"
```

---

## Task 6: Wire the route + MCP lifecycle

**Files:**
- Modify: `frontend/app/api/chat/stream/route.ts:8-15,44,63-91`

- [ ] **Step 1: Update imports**

Replace the history/bridge/loop import block:

```ts
import {
  createSession,
  appendTurns,
  getSessionMessages,
  setSessionTitle,
} from "@/lib/agent/history";
import { createMcpServer } from "@/lib/agent/mcp_bridge";
import { runAgent } from "@/lib/agent/loop";
```

`priorMessages` is now `AgentInputItem[]`; the variable name and the `isFirstTurn`/`slice` logic stay valid.

- [ ] **Step 2: Replace the run block inside `start(controller)`**

Replace the `try { const mcpSession = await initMcpSession(...) ... }` body (lines ~63–91) with:

```ts
const mcp = createMcpServer(jwt);
try {
  await mcp.connect();

  const { items, error } = await runAgent(
    priorMessages,
    message,
    mcp,
    safeEnqueue,
    { source: LlmUsageSource.AGENT_SESSION, agentSessionId: sessionId, userId: user.id },
    request.signal,
  );

  // Persist regardless of error so the user turn and completed tool rounds survive.
  try {
    await appendTurns(prisma, sessionId, items.slice(priorMessages.length));
  } catch (err) {
    console.error("Failed to persist AgentTurn:", err);
  }

  if (isFirstTurn) void autoTitle(sessionId, message, user.id);

  if (error) safeEnqueue(encodeChunk({ type: "error", message: error.message }));
  else safeEnqueue(encodeChunk({ type: "done", sessionId }));
} catch (err) {
  const msg = err instanceof Error ? err.message : "Agent error";
  safeEnqueue(encodeChunk({ type: "error", message: msg }));
} finally {
  try { await mcp.close(); } catch { /* already closed */ }
  try { controller.close(); } catch { /* already closed */ }
}
```

- [ ] **Step 3: Typecheck and build**

Run: `bun run typecheck && bun run build`
Expected: PASS. Fix any residual signature mismatches.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/api/chat/stream/route.ts
git commit -m "feat: wire chat route to Agents SDK runAgent and MCP lifecycle"
```

---

## Task 7: Cleanup + full verification

**Files:**
- Delete: `frontend/lib/agent/types.ts`
- Verify: whole agent path

- [ ] **Step 1: Confirm `AnthropicTool` has no remaining importers**

Run: `grep -rn "AnthropicTool\|types\"" frontend/lib/agent frontend/app/api/chat`
Expected: no references to `./types` / `AnthropicTool`. If clean:

```bash
git rm frontend/lib/agent/types.ts
```

- [ ] **Step 2: Confirm the old bridge symbols are gone**

Run: `grep -rn "buildMcpTools\|initMcpSession\|callMcpTool\|runAgentLoop\|ChatCompletionMessageParam" frontend/lib/agent frontend/app/api/chat`
Expected: no matches. Any hit is dead code to remove or a missed call site.

- [ ] **Step 3: Full static verification**

Run:
```bash
bun run typecheck
bun run build
bun test frontend/lib/agent/stream.test.ts frontend/lib/agent/history.test.ts
```
Expected: all PASS.

- [ ] **Step 4: Manual end-to-end checklist (start both servers)**

Run `bun run dev:mcp` and `bun run dev:frontend`, then in the chat UI verify:
- Text streams token-by-token.
- "list my characters" → a `tool_start` + `tool_result` render with the tool name matching Task 0's findings (**R1**).
- "research Walter White from Breaking Bad and create him" → multi-tool flow completes and the character is created.
- Open Prisma Studio (`bun run prisma:studio`): one `LlmUsage` row per LLM round with non-zero `latencyMs` (**R2**).
- Click Stop mid-stream, reload the session → the user turn and any completed tool rounds are present (**R3**).
- Reload the page → the full conversation re-renders from persisted items.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove dead AnthropicTool type and legacy bridge symbols"
```

---

## Self-Review

**Spec coverage:**
- Provider bootstrap (chat-completions, no Responses) → Task 1.
- Native MCP, drop hand-written schemas → Task 2.
- Streaming adapter, `StreamChunk` unchanged → Task 3.
- Per-call usage logging → Task 1 (`LoggingModel`), verified Task 7 Step 4.
- History as SDK items, greenfield → Task 4.
- Loop semantics (maxTurns, abort, parallel tools, persist-on-failure) → Task 5.
- Route + MCP lifecycle → Task 6.
- Cleanup (`types.ts`, dead symbols) → Task 7.
- New dependency approval → Task 0 Step 1.
- Risks R1/R2/R3 → resolved in Task 0, verified in Task 7.

**Type consistency:** `runAgent` (Task 5) matches the route call (Task 6). `itemsToRows`/`rowsToItems` (Task 4 impl) match the test (Task 4) and `appendTurns`/`getSessionMessages` consumers. `mapRunEvent` (Task 3) is consumed by `loop.ts` (Task 5). `LoggingModel` / `createMcpServer` / `AgentMcpServer` names are consistent across Tasks 1, 2, 5.

**Placeholders:** none. Steps marked **(reconcile with Task 0)** carry complete best-guess code plus a named verification anchor — not deferred work.
