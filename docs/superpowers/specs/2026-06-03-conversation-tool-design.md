# Conversation Tool — MCP Design Spec

**Date:** 2026-06-03  
**Status:** Approved  
**Branch:** worktree-conversation-tool

---

## Goal

Add two MCP tools that let an AI agent start a multi-character conversation and poll its results — without any UI involvement.

---

## Tools

### `mcp__openormus__conversation_start`

Creates a conversation and starts a background job running M turns.

**Input:**
```ts
{
  characterIds: string[]   // ≥ 2 UUIDs, must belong to userId
  context: string          // scene/conversation context (min 1 char)
  turnStrategy: 'ORCHESTRATOR' | 'ROUND_ROBIN'
  turns: number            // 1–500
  title?: string           // defaults to first 50 chars of context
}
```

**Output:**
```ts
{ conversationId: string, jobId: string }
```

Returns immediately (202). Job runs in background.

---

### `mcp__openormus__conversation_job_status`

Polls a job started by `conversation_start`.

**Input:**
```ts
{ jobId: string }
```

**Output:**
```ts
{
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  doneTurns: number
  totalTurns: number
  error?: string            // present when status = 'failed'
  messages?: MessageRecord[] // present when status = 'completed'
}
```

Agent polls this until `status` is terminal (`completed` / `failed` / `cancelled`).

---

## Architecture

```
Agent
  │
  ▼
MCP server  (mcp_server/)
  │  1. validate input (Zod)
  │  2. mint internal JWT { userId, exp, internal: true } via JWT_SECRET
  │  3. POST/GET http://$FRONTEND_INTERNAL_URL/api/internal/conversation-jobs[/jobId]
  │
  ▼
Frontend internal API  (frontend/app/api/internal/)
  │  1. validate Bearer JWT with JWT_SECRET (no Supabase needed)
  │  2. extract userId — only trusted tenancy source
  │  3. validate all characterIds scoped to userId
  │  4. prisma.conversation.create / prisma.conversationJob.create
  │  5. void startJob(...)   ← existing job runner
  │
  ▼
Existing job runner  (frontend/lib/jobs/runner.ts)
  └─ generateNextTurnStream  (frontend/lib/conversation/next.ts)
```

No engine duplication. MCP server is a thin HTTP client.

---

## New Files

| Path | Purpose |
|------|---------|
| `packages/shared/schema/conversation_start.ts` | `ConversationStartInputSchema`, `ConversationJobStatusSchema` |
| `mcp_server/src/registry/tools/conversation_start.ts` | MCP tool — mints JWT, calls internal endpoint |
| `mcp_server/src/registry/tools/conversation_job_status.ts` | MCP tool — polls internal endpoint |
| `frontend/app/api/internal/conversation-jobs/route.ts` | POST handler — create conversation + job |
| `frontend/app/api/internal/conversation-jobs/[jobId]/route.ts` | GET handler — job status + messages |
| `frontend/lib/internal-auth.ts` | JWT Bearer validation helper (no Supabase) |

---

## Auth Flow

The MCP server mints an outbound JWT using the same `JWT_SECRET` already in env:

```ts
// mcp_server mints:
sign({ userId, exp: now + 60, internal: true }, JWT_SECRET)

// frontend validates:
const { userId } = verify(bearerToken, JWT_SECRET)
// then scope all queries by userId
```

`JWT_SECRET` is already shared between both processes via `.env.local` symlink.

---

## Env Vars

| Var | Where | Value |
|-----|-------|-------|
| `FRONTEND_INTERNAL_URL` | `mcp_server/.env.local` | `http://localhost:3000` |
| `JWT_SECRET` | already exists in both | unchanged |

---

## Shared Schemas (packages/shared)

```ts
// ConversationStartInputSchema
z.object({
  characterIds: z.array(uuidSchema).min(2),
  context: z.string().min(1),
  turnStrategy: TurnStrategySchema,          // already exists
  turns: z.number().int().min(1).max(500),
  title: z.string().optional(),
})

// ConversationJobStatusSchema
z.object({
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']),
  doneTurns: z.number().int(),
  totalTurns: z.number().int(),
  error: z.string().optional(),
  messages: z.array(MessageRecordSchema).optional(), // already exists
})
```

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| characterId not found / not owned by userId | 404 → tool returns error text |
| `turns` out of range | Zod rejection before HTTP call |
| Job already running on conversation | 409 → tool returns error text |
| Frontend unreachable | tool returns descriptive error, no retry |
| Job fails mid-run | `status = 'failed'`, `error` field populated |
| jobId belongs to different userId | 404 (query scoped by userId) |

---

## Testing

- Unit: new Zod schemas
- Unit: internal JWT mint/validate helper
- Integration: `POST /api/internal/conversation-jobs` — valid + invalid inputs
- MCP tools: follow existing `registry.test.ts` pattern, mock HTTP calls

---

## Out of Scope

- Full conversation CRUD MCP tools (`conversation_list`, `conversation_get`, `conversation_delete`) — separate initiative
- Extracting conversation engine to `packages/shared` — future refactor
- Streaming tool responses — MCP protocol returns once; polling is the model here
