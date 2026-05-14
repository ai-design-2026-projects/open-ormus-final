# Agent Loop Design

**Date:** 2026-05-14  
**Status:** Approved  
**Scope:** Main agent loop, inner agents (Exa + Wizard), chat history persistence, frontend chat page

---

## 1. Overview

Standalone `/chat` page backed by a Claude Agent SDK loop at `POST /api/chat/stream`. The agent orchestrates character management (CRUD), online research (Exa), custom character creation (wizard), and scene simulation — all via MCP tools and two inline inner agents.

---

## 2. Architecture

```
Browser (/chat page)
    │  SSE stream (text_delta, tool_start, tool_result, error, done)
    ▼
POST /api/chat/stream  (Next.js route handler, Node runtime)
    │  1. supabase.auth.getUser() — 401 if missing
    │  2. issue JWT via /api/auth/tool-token
    │  3. load/create AgentSession; rehydrate AgentTurn history
    │  4. run Claude Agent SDK loop
    │  5. stream chunks to client
    │  6. persist AgentTurn records on completion
    ▼
Main Agent Loop (Claude Agent SDK)
    ├── MCP tools (POST http://localhost:3001/mcp + JWT)
    │     mcp__openormus__character_list
    │     mcp__openormus__character_save
    │     mcp__openormus__character_update
    │     mcp__openormus__character_delete
    │     mcp__openormus__character_db_search
    │     mcp__openormus__scene_simulate
    │
    ├── research_character_online(query: string)   ← inline tool
    │     Inner Claude Agent SDK loop
    │     Tools: character_search + show_search (Exa services, no MCP)
    │     Flow: show_search if query looks like title → extract names
    │           parallel character_search for each name (max 5)
    │           filter confidence === 0
    │     Returns: CharacterSearchResult[]
    │     Main agent calls character_save for each result
    │
    └── start_character_wizard()                   ← inline tool
          Inner turn-by-turn loop (wizard state in-memory only)
          Q&A sequence:
            1. Character name
            2. Source (fictional universe / original)
            3. Core personality traits (3–5)
            4. Backstory summary
            5. Speech patterns / notable quotes
            6. Goals + fears
            7. Relationships (optional)
          Assembles CharacterSearchResult { confidence: 1 }
          Calls mcp__openormus__character_save
          Returns: SavedCharacterRecord
```

---

## 3. Main Agent — System Prompt (abbreviated)

> You are an assistant for managing fictional characters. You can list, search, add, edit, and delete characters in the user's collection.
>
> - When a user mentions a specific fictional character by name, autonomously call `research_character_online` — do not ask for confirmation first.
> - For bulk imports (e.g. "add all characters from Breaking Bad"), announce a brief plan before firing multiple lookups.
> - To create a custom character from scratch, call `start_character_wizard`.
> - To start a scene simulation, call `scene_simulate` with the relevant character IDs and setting.

---

## 4. Streaming Protocol

`ReadableStream` SSE from `/api/chat/stream`. Chunk envelope:

```ts
type StreamChunk =
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; tool: string; input: unknown }
  | { type: "tool_result"; tool: string; preview: string }
  | { type: "error"; message: string }
  | { type: "done"; sessionId: string }
```

Frontend accumulates `text_delta` chunks into prose. `tool_start` + `tool_result` pairs render as collapsible blocks.

**Inner agent visibility:** tool calls made inside `research_character_online` or `start_character_wizard` inner loops are NOT forwarded to the client stream. Only the outer tool block (e.g. `tool_start: research_character_online`) is visible. Inner loop details are opaque to the user.

---

## 5. Chat History Persistence

Two separate persistence concerns:

**Scene simulation** → existing `Conversation` + `ConversationParticipant` + `Message` models (unchanged). `scene_simulate` writes dialogue there.

**Agent chat history** → new models (add to `prisma/schema.prisma`):

```prisma
model AgentSession {
  id        String      @id @default(uuid()) @db.Uuid
  userId    String      @db.Uuid @map("user_id")
  title     String?
  createdAt DateTime    @default(now()) @map("created_at")
  updatedAt DateTime    @updatedAt @map("updated_at")
  user      User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  turns     AgentTurn[]

  @@map("agent_sessions")
}

model AgentTurn {
  id        String       @id @default(uuid()) @db.Uuid
  sessionId String       @db.Uuid @map("session_id")
  role      String       // "user" | "assistant"
  content   String
  toolCalls Json?        // serialized tool_use + tool_result blocks
  createdAt DateTime     @default(now()) @map("created_at")
  session   AgentSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId])
  @@map("agent_turns")
}
```

`User` model gets `agentSessions AgentSession[]` relation.

**Session resume:** client sends `sessionId` on subsequent requests. Route handler loads `AgentTurn` rows ordered by `createdAt`, reconstructs Claude `messages[]` array (tool calls rehydrated from `toolCalls` JSONB).

**Title generation:** after first assistant reply, fire-and-forget single LLM call (haiku model) to generate a short title. Non-blocking.

---

## 6. Frontend — Chat Page

**Route:** `frontend/app/chat/page.tsx`

**Layout:**
```
┌──────────────────────────────────────────┐
│  [← Back]   OpenOrmus Assistant   [New]  │
│  ┌──────────────────────────────────── ┐  │
│  │ [Session 1: Breaking Bad chars]     │  │  ← session history sidebar
│  │ [Session 2: Custom wizard]          │  │
│  └─────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐ │
│  │                                      │ │
│  │  assistant: I found Walter White     │ │
│  │  ▼ 🔍 research_character_online      │ │  ← collapsible tool block
│  │    Query: "Walter White"             │ │
│  │    Result: confidence 3, saved ✓     │ │
│  │                                      │ │
│  └──────────────────────────────────────┘ │
│  ┌──────────────────────────────────────┐ │
│  │ Type a message...            [Send]  │ │
│  └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

**Client state:** `useReducer` accumulating stream chunks. No external state library.

**New session:** "New" button clears `sessionId`, new `AgentSession` created on first send.

**Session list:** `GET /api/agent-sessions` returns user's sessions for sidebar.

---

## 7. New API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/chat/stream` | Main agent SSE stream |
| GET | `/api/agent-sessions` | List user's agent sessions |
| POST | `/api/auth/tool-token` | Issue short-lived JWT for MCP auth |

---

## 8. Error Handling

| Failure | Behaviour |
|---------|-----------|
| LiteLLM unavailable | Fail fast → stream `error` chunk. No silent retry. |
| MCP tool returns `{ error }` | Agent receives as tool result, explains to user in prose. |
| Exa inner agent fails | Returns `{ error }` to main agent. Main agent informs user. No exception propagation. |
| Wizard abandonment (user changes topic) | Agent detects intent shift, discards in-memory wizard state gracefully. |
| JWT expiry mid-session | Re-issue token, retry tool call once. Second failure → stream `error`. |
| `supabase.auth.getUser()` fails | 401 before stream opens. |
| DB write failure (AgentTurn) | Log to `stderr`, do not fail stream. History may be incomplete — acceptable degradation. |

---

## 9. Key Constraints (from AGENTS.md)

- No cross-imports between `mcp_server/` and `frontend/`
- Exa inner agent calls services from `packages/shared/services/` directly — no MCP, no JWT needed (no DB writes)
- All Prisma queries scoped by `userId`
- Never hardcode model names — accept as argument, LiteLLM routes
- Every LLM call must log: `model`, `prompt_hash`, `temperature_ms`, `latency_ms`, `userId`
- Tool IDs follow `mcp__openormus__<tool_name>` pattern — derive from shared registry

---

## 10. Out of Scope

- Evaluation track (offline batch judge) — separate system, not covered here
- `scene_simulate` real LLM dialogue (currently stub) — separate milestone
- Zod v3/v4 mismatch resolution — tracked in AGENTS.md §11, must resolve before M3-05
