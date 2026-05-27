# Auto-turns — Design Spec

**Date:** 2026-05-18
**Status:** Approved

## Problem

Users must click "Generate next" for every turn in a Conversation. There is no way to run multiple turns hands-free, and any ongoing generation stops if the browser is closed.

## Goal

Allow users to specify N turns and have the conversation advance automatically in the background — even with the browser closed. When the user returns, completed messages are already visible. While watching, tokens stream in real time (typewriter effect).

## Approach

Background async job running inside the Next.js server process. A module-level `EventEmitter` singleton bridges the background task to the SSE endpoint. Job state is persisted in Postgres for recovery across server restarts.

No new infrastructure (no Redis, no separate worker process).

---

## Data Layer

New Prisma model in `prisma/schema.prisma`:

```prisma
model ConversationJob {
  id             String   @id @default(uuid()) @db.Uuid
  conversationId String   @db.Uuid @map("conversation_id")
  userId         String   @db.Uuid @map("user_id")
  totalTurns     Int      @map("total_turns")
  doneTurns      Int      @default(0) @map("done_turns")
  status         String   @default("pending")  // pending | running | done | failed | cancelled
  errorMessage   String?  @map("error_message")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

All queries scoped by `userId` (belt-and-braces alongside Supabase RLS).

---

## Backend

### `frontend/lib/jobs/conversation-runner.ts`

Module-level singleton. Owns a single `EventEmitter` and a `Set<string>` of active job IDs.

**`startJob(jobId, conversationId, userId, turns)`**
- Guards against duplicate execution via `activeJobs.has(jobId)`
- Marks job `running` in DB
- Calls `runTurns()` as fire-and-forget (`.catch` → `markFailed`)

**`runTurns()`**
- Iterates `turns` times
- Each iteration calls `generateNextTurnStream()` (extracted from the existing `/api/conversations/[id]/next` handler)
- Per token: `emitter.emit('job:{id}:token', token)`
- Per turn end: updates `doneTurns` in DB, emits `turn_done`
- On completion: marks `done`, emits `done`

**`subscribeToJob(jobId, handlers)`**
- Registers token/turn_done/done/error listeners
- Returns an `unsubscribe()` function for cleanup

### `frontend/lib/jobs/startup.ts`

Called once at server boot (module-level `let initialized = false` guard, triggered on first import from the jobs route handler):
- Resets all `running` jobs → `pending`
- Relaunches them via `startJob()` so in-progress jobs survive server restarts

### API routes

| Route | Method | Description |
|---|---|---|
| `/api/conversations/[id]/jobs` | POST | Create job `{ turns: number }` (1–500). Returns 409 if a `pending\|running` job already exists for this conversation. Otherwise fire-and-forget `startJob()`, respond 202 `{ jobId }` |
| `/api/conversations/[id]/jobs/[jobId]/stream` | GET | SSE endpoint — subscribes to EventEmitter, streams `token` / `turn_done` / `done` / `error` events, cleans up on disconnect |
| `/api/conversations/[id]/jobs/[jobId]` | DELETE | Cancel job — marks `cancelled` in DB, loop exits at next turn boundary |

**SSE event shapes:**
```ts
{ type: "token";      text: string }
{ type: "turn_done";  doneTurns: number; totalTurns: number }
{ type: "done" }
{ type: "error";      message: string }
```

---

## Frontend

`/app/conversations/[id]/page.tsx` becomes a client component.

### UI control (replaces "Generate next" button)

```
[ 10 ] turni   [▶ Run]
████████░░░░░░  6/10   [■ Stop]    ← visible only when job active
```

### State machine

1. **Idle**: input + Run button visible
2. **Running**: progress bar + Stop button visible; input disabled
3. **Done / Failed**: returns to idle; error shown if failed

### On page load

- Fetch conversation messages from DB (already there)
- Check for an active job for this conversation
- If `status: running` → reconnect SSE on the existing `jobId`, show progress bar at current `doneTurns`
- If `status: pending` → show progress bar at 0, wait for SSE (job will start momentarily)
- If `status: done | failed | cancelled` or no job → idle state

### Token rendering

- Incoming tokens are appended to a `currentTurnBuffer` string in React state
- On `turn_done`: buffer is committed as a finalised `Message` and cleared
- Effect: typewriter animation while generating, clean message on completion

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| LLM turn fails | Job marked `failed`, `errorMessage` saved, SSE sends `{ type: "error" }` |
| Server restarts during job | Startup hook resets `running` → `pending`, job resumes from last saved `doneTurns` |
| Browser disconnects during SSE | `unsubscribe()` cleans listeners; job continues in background |
| User presses Stop | `DELETE .../jobs/{jobId}` → `cancelled`; loop exits at next turn boundary |
| Duplicate start (double-click) | `activeJobs.has(jobId)` guard; API returns 409 Conflict |

---

## Testing

- **Unit** — `conversation-runner.ts`: mock `generateNextTurnStream`, assert `doneTurns` increments and events fire in correct order
- **Integration** — `POST /jobs`: assert job row created with `status: pending`
- **Manual** — start 5 turns, close tab, reopen: all messages present; start 10 turns, watch typewriter effect

---

## Files to create / modify

| File | Action |
|---|---|
| `prisma/schema.prisma` | Add `ConversationJob` model |
| `frontend/lib/jobs/conversation-runner.ts` | New |
| `frontend/lib/jobs/startup.ts` | New |
| `frontend/app/api/conversations/[id]/jobs/route.ts` | New |
| `frontend/app/api/conversations/[id]/jobs/[jobId]/stream/route.ts` | New |
| `frontend/app/api/conversations/[id]/jobs/[jobId]/route.ts` | New (DELETE only) |
| `frontend/app/conversations/[id]/page.tsx` | Modify — add job UI, SSE client |
| `frontend/app/api/conversations/[id]/next/route.ts` | Refactor — extract business logic to `lib/conversation/next.ts` |

---

## Out of scope

- Multiple concurrent jobs per conversation (one job at a time enforced)
- Job history / audit log
- Pause/resume (cancel + restart covers the use case)
