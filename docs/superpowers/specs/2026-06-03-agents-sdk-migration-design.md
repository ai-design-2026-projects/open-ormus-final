# Migrate the agent loop to the OpenAI Agents SDK

**Date:** 2026-06-03
**Status:** Approved (design)
**Scope:** `frontend/lib/agent/**` and `frontend/app/api/chat/stream/route.ts`

## Problem

The production chat agent is a hand-rolled loop built directly on the OpenAI chat-completions
SDK. Four files carry custom machinery that the OpenAI Agents SDK now provides natively:

- `loop.ts` — manual tool-call accumulation, parallel execution, max-iteration cap, abort/error
  capture, per-call usage logging.
- `mcp_bridge.ts` — raw `fetch` JSON-RPC against the MCP server plus ~130 lines of hand-written
  tool schemas duplicating what the server already exposes.
- `stream.ts` — custom SSE `StreamChunk` protocol (kept) plus the producer logic in the loop.
- `history.ts` — persistence/reload of conversation turns as `ChatCompletionMessageParam`.

## Goals

1. Replace the hand-rolled loop with `Agent` + `Runner` from `@openai/agents`.
2. Replace the raw MCP `fetch` bridge with the SDK's native `MCPServerStreamableHttp` client,
   eliminating the duplicated tool schemas (single source of truth = the MCP server).
3. Adopt SDK-provided features: turn cap, parallel tool execution, structured run events.
4. Keep the frontend contract intact: the SSE `StreamChunk` protocol is byte-identical.

## Non-goals

- No move to the OpenAI Responses API. The provider is OpenRouter; the SDK runs in
  **chat-completions mode**. Responses mode (OpenRouter beta) is explicitly out of scope and may
  be revisited later as an isolated, reversible change.
- No multi-agent / handoff orchestration yet.
- No backward compatibility with already-persisted sessions (see History).

## Hard constraints (from AGENTS.md / CLAUDE.md)

- **Per-LLM-call usage logging** must survive: `model`, `inputTokens`, `outputTokens`,
  `cachedTokens`, `reasoningTokens`, `latencyMs`, `userId`, `generationId`. Aggregate-only logging
  is not acceptable.
- **Frontend SSE `StreamChunk` protocol stays byte-identical.** Only the producer changes.
- **No hardcoded model name** — model comes from `CONVERSATION_MODEL` env.
- **MCP tool IDs** keep the `mcp__openormus__<tool_name>` pattern (served by the MCP server).
- `userId` tenancy is derived from the JWT on the MCP server, never from tool arguments.
- Production and evaluation tracks share DB tables and shared types only — no runtime state.

## Architecture

```
route.ts ──> runAgent(items, mcpServer, onChunk, ctx, signal)
                │
                ├─ Agent (system prompt, model, mcpServers:[mcp])
                ├─ Runner.run(agent, items, { stream:true, signal, maxTurns })
                │     └─ stream events ──> mapRunEvent() ──> StreamChunk (unchanged SSE)
                └─ MCPServerStreamableHttp (JWT header) ──> http://localhost:3001/mcp
```

### Component 1 — Provider bootstrap (`lib/agent/sdk.ts`, new)

- `setDefaultOpenAIClient(new OpenAI({ baseURL: LLM_BASE_URL, apiKey: LLM_API_KEY }))`.
- `setOpenAIAPI("chat_completions")` — force chat-completions; never the Responses API.
- `setTracingDisabled(true)` — no OpenAI tracing backend; usage is logged via `logLlmUsage`.
- Model instance built from `process.env.CONVERSATION_MODEL ?? "default"`. No hardcoded name.
- This module performs the global SDK configuration exactly once (module-level side effect, imported
  by the route).

### Component 2 — Agent definition

- A single `Agent` configured with `AGENT_SYSTEM_PROMPT`, the model, and `mcpServers: [mcp]`.
- The agent is constructed per request because the attached MCP server carries a per-request JWT.

### Component 3 — MCP integration (replaces all of `mcp_bridge.ts`)

- `new MCPServerStreamableHttp({ url: MCP_URL, requestInit: { headers: { Authorization: \`Bearer ${jwt}\` } } })`.
- `await mcp.connect()` before the run; `await mcp.close()` in `finally`. The 5-minute JWT covers a
  single turn.
- **Tool schemas are auto-discovered from the server.** The hand-written `buildMcpTools` and the
  `callMcpTool` / `initMcpSession` fetch plumbing are deleted. The `AnthropicTool` type and
  `toOpenAITool` adapter are removed.
- **Risk R1 — tool naming:** the SDK may prefix/namespace discovered tool names. The implementation
  must confirm the names surfaced in `tool_start` events match what the frontend renders today
  (`mcp__openormus__*`) and map them if the SDK alters them.

### Component 4 — Streaming adapter (`stream.ts`)

- `StreamChunk` union and `encodeChunk` are unchanged.
- Add `mapRunEvent(event): StreamChunk | null`:
  - `raw_model_stream_event` carrying a text delta → `{ type: "text_delta", text }`.
  - `run_item_stream_event` with a `tool_call_item` → `{ type: "tool_start", tool, input }`.
  - `run_item_stream_event` with a `tool_call_output_item` → `{ type: "tool_result", tool,
    preview: JSON.stringify(output).slice(0, 300) }`.
  - anything else → `null` (skipped).
- `session_created`, `done`, and `error` chunks continue to be emitted by the route, exactly as now.

### Component 5 — Per-call usage logging (load-bearing)

`RunResult` usage is aggregate; the constraint requires per-call records across every tool round.

- **Primary approach:** wrap the model. Subclass `OpenAIChatCompletionsModel` and override
  `getStreamedResponse` (and `getResponse` if used): start a timer, delegate, read per-call usage
  (`prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens`,
  `completion_tokens_details.reasoning_tokens`), and call `logLlmUsage(ctx, …)` with the measured
  `latencyMs` and `generationId`. This intercepts each underlying LLM request regardless of how many
  tool rounds the Runner drives.
- **Fallback:** `AgentHooks` lifecycle hooks plus `result.rawResponses[]` if subclassing proves
  awkward. Per-call latency may then be approximate.
- **Risk R2:** verify the wrap yields one log entry per LLM call with accurate latency before
  declaring this done.

### Component 6 — History (greenfield, breaking changes accepted)

- Persist the new items from a completed run (`result.history` minus the prior input) as SDK
  `AgentInputItem` JSON, stored in the existing seq-ordered `AgentTurn` rows (item JSON in a column).
- `getSessionMessages` returns `AgentInputItem[]`, fed directly as `Runner.run` input.
- The `ChatCompletionMessageParam` mapping in `history.ts` is deleted. **No migration.** Pre-existing
  dev sessions may fail to load — accepted.
- The seq-ordering / row-lock logic that preserves message order within a turn is retained.

### Component 7 — Loop semantics preserved

- `AGENT_MAX_ITERATIONS` env → `maxTurns` option (`MaxTurnsExceededError` replaces the manual cap;
  caught and surfaced as the existing "reached maximum tool-call rounds" notice).
- Abort: pass `signal` to `Runner.run`. On abort, persist the accumulated items from the partial
  `result.history` so the user turn and completed tool rounds are not lost — matching current
  behavior.
- Parallel tool execution: provided by the SDK by default; the manual `Promise.allSettled` batch is
  removed.
- Persist-on-failure: wrap the run in try/catch, persist whatever history accumulated, then emit an
  `error` chunk — mirrors the current `loopError` path.
- **Risk R3:** confirm partial `result.history` is available when the stream is aborted or errors
  mid-round, so persistence still captures completed work.

## Data flow

1. `route.ts` authenticates the user, resolves/creates the session, loads prior items via
   `getSessionMessages`, and mints a JWT.
2. It opens the SSE stream, emits `session_created`, connects the MCP server, builds the agent, and
   calls `runAgent`.
3. `runAgent` runs the Runner in streaming mode, maps each event through `mapRunEvent`, and forwards
   non-null chunks via `onChunk` (the route's `safeEnqueue`).
4. The wrapped model logs usage per LLM call as the run proceeds.
5. On completion/abort/error, the route persists new items via `appendTurns`, auto-titles on the
   first turn, and emits `done` or `error`, then closes the MCP server and the controller.

## Error handling

- Failure to open the LLM stream or connect MCP → captured, partial history persisted, `error`
  chunk emitted, MCP closed in `finally`.
- Client abort (Stop button) → clean stop; partial history persisted; no error surfaced.
- Tool failure inside a round → the SDK returns a tool error item; the agent sees it and continues,
  as today.

## Testing / verification

- `bun run typecheck` and `bun run build` pass.
- Manual run through the chat UI: text streams, `tool_start` / `tool_result` render with correct
  tool names (R1), a multi-tool flow (e.g. research → create) completes.
- Confirm one `LlmUsage` row per LLM call with non-zero latency (R2).
- Stop mid-stream → session reloads with the user turn and any completed tool rounds (R3).
- Hit the turn cap with a deliberately looping prompt → the cap notice appears and the run stops.

## Affected files

- New: `frontend/lib/agent/sdk.ts`.
- Rewritten: `frontend/lib/agent/loop.ts` (thin `runAgent`), `frontend/lib/agent/mcp_bridge.ts`
  (MCP server factory only), `frontend/lib/agent/stream.ts` (+ `mapRunEvent`),
  `frontend/lib/agent/history.ts` (SDK item storage).
- Deleted: `frontend/lib/agent/types.ts` (`AnthropicTool`), hand-written tool schemas.
- Edited: `frontend/app/api/chat/stream/route.ts` (wire `runAgent` + MCP lifecycle).
- Dependency: add `@openai/agents` (requires approval per AGENTS.md §10).

## Open risks

- **R1** — discovered MCP tool naming vs frontend display.
- **R2** — per-call usage logging fidelity (tokens + latency) via the model wrap.
- **R3** — partial `result.history` availability on abort/error mid-stream.
