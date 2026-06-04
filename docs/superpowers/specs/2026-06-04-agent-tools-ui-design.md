# Agent Tool Call UI — Design Spec

**Date:** 2026-06-04  
**Branch:** worktree-agent-tools-ui  
**Scope:** Replace the raw JSON accordion in `ToolCallBlock` with rich, type-specific renderer components for all 9 MCP tools.

---

## Problem

`ToolCallBlock` currently renders every tool call as a collapsible accordion showing raw JSON input and a truncated 300-char result string. This is unreadable for complex results (full character sheets, conversation turns) and provides no progressive loading state.

---

## Goals

- Each tool call shows a purpose-built card with structured, human-readable data.
- Skeleton state during `tool_start` → replaced progressively as `tool_result` arrives.
- Character cards are collapsible (default collapsed, expand to full sheet).
- Multi-result tools show a summary card with inline expandable list.
- Conversation start/status shows a live turn feed that polls until job completes.

---

## Architecture

`tool-call-block.tsx` becomes a thin dispatcher. It holds a registry mapping tool name → renderer component, looks up the renderer for the active tool, and renders it. Falls back to the existing accordion for any unmapped tool.

```
ToolCallBlock (dispatcher)
  └─ toolRenderers: Record<string, ComponentType<ToolRendererProps>>
       ├─ mcp__openormus__character_create     → CharacterCard
       ├─ mcp__openormus__character_update     → CharacterCard
       ├─ mcp__openormus__character_delete     → CharacterDeleteCard
       ├─ mcp__openormus__character_list       → ResultSummaryCard (CharacterCard items)
       ├─ mcp__openormus__character_find       → ResultSummaryCard (CharacterCard items)
       ├─ mcp__openormus__character_research   → ResultSummaryCard (CharacterCard items)
       ├─ mcp__openormus__show_research        → ResultSummaryCard (ShowCard items)
       ├─ mcp__openormus__conversation_start   → ConversationPanel
       └─ mcp__openormus__conversation_job_status → ConversationPanel
```

### Shared renderer interface

```ts
interface ToolRendererProps {
  input: unknown;      // parsed tool input
  result: unknown;     // parsed tool output; null when loading
  isLoading: boolean;
}
```

Skeleton = same component shell with `isLoading === true`, shimmer placeholders where data would appear.

---

## Components

### `CharacterCard`
Used by: `character_create`, `character_update`, `character_research` (per item), `character_find` (per item), `character_list` (per item)

- **Header:** `Monogram` (name initials) + character name + `firstAppearanceDate` badge
- **Collapsed (default):** short description + first 3 personality trait chips
- **Expanded:** full `CharacterPersonality` — backstory, all traits, relationships table, speech patterns, values, fears, goals, notable quotes, abilities, coping style, knowledge scope
- **Toggle:** collapse/expand button at card bottom
- **Skeleton:** shimmer monogram circle + 2 text line shimmers + 3 chip shimmers

### `CharacterDeleteCard`
Used by: `character_delete`

- Compact destructive-styled card
- Shows character ID from input; name from result if available
- "Archived" status badge
- No expand affordance
- **Skeleton:** shimmer name line

### `ResultSummaryCard`
Used by: `character_list`, `character_find`, `character_research`, `show_research`

- **Header:** result count ("N results") + query string from input
- **Collapsed (default):** count only
- **Expanded:** inline list of item cards (compact `CharacterCard` or `ShowCard`)
- **Skeleton:** count placeholder + 2 shimmer item rows

### `ShowCard`
Used by: `ResultSummaryCard` for `show_research` items

- Title + year + network + short description
- No expand affordance

### `ConversationPanel`
Used by: `conversation_start`, `conversation_job_status`

- **Header:** conversation title + participant names (monogram row)
- **Body:** scrollable turn feed — each turn: character monogram + name + content + emotion badge
- **Streaming:** on mount with a `jobId`, opens SSE connection to `GET /api/conversations/jobs/:jobId/stream`; turns append as server pushes them; stream closes when job reaches terminal state (`completed`, `failed`, `cancelled`) or component unmounts
- `conversation_job_status` result carries existing turns + `jobId`; panel renders existing turns immediately then opens SSE stream to receive any remaining turns
- **Skeleton:** header shimmer + 2 turn placeholder rows; turns fill in progressively as SSE events arrive
- **Stream error:** shows inline error badge, closes connection; last known turns remain visible

---

## Data Flow Changes

### `stream.ts` — `tool_result` chunk type

```ts
// Before
{ type: "tool_result"; tool: string; preview: string }

// After
{ type: "tool_result"; tool: string; result: unknown }
```

`mapRunEvent` parses `item.output` fully (already JSON string from MCP protocol) instead of slicing to 300 chars.

### `message-thread.tsx` — `MessageBlock` type

```ts
// Before
{ type: "tool_call"; tool: string; input: unknown; result?: string }

// After
{ type: "tool_call"; tool: string; input: unknown; result?: unknown }
```

### `chat-view.tsx` — `TOOL_RESULT` dispatch unchanged in structure; `result` field carries `unknown` instead of `string`.

---

## Type Safety at Render Boundary

Each renderer calls `SomeSchema.safeParse(result)` before rendering. On parse failure → falls back to existing raw JSON accordion. No crashes, no silent bad renders.

---

## File Layout

```
frontend/app/chat/_components/
  tool-call-block.tsx              ← dispatcher + registry (replaces current file)
  tool-renderers/
    character-card.tsx
    character-delete-card.tsx
    result-summary-card.tsx
    show-card.tsx
    conversation-panel.tsx
```

One new API route: `GET /api/conversations/jobs/:jobId/stream` (see New API Route section). `/api/internal/conversation-jobs/:jobId` is server-to-server only and not usable from the browser client.

---

## New API Route

`GET /api/conversations/jobs/:jobId/stream`

- **Auth:** Supabase cookie (`supabase.auth.getUser()`) — called from browser client
- **Response:** `text/event-stream` SSE
- **Events:**
  - `turn` — `MessageRecord` JSON, one per new message as it is written to DB
  - `status` — `{ status, doneTurns, totalTurns }` on each DB poll
  - `done` — emitted when job reaches terminal state; stream closes
  - `error` — on DB/job error; stream closes
- **Behaviour:** polls DB every 1s, tracks `lastSeenMessageCount`, pushes only new messages; closes when `status ∈ { completed, failed, cancelled }`
- **Scope guard:** validates `conversationJob.userId === user.id` before streaming

---

## Out of Scope

- No changes to `mcp_server` tool handlers.
- No changes to `packages/shared` schemas.
- No new dependencies.
- No refactor of `chat-view.tsx` beyond the `result` type change.
