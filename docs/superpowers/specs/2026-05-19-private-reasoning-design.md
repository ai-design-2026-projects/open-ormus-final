# Private Reasoning — Design Spec

**Date:** 2026-05-19  
**Status:** Approved  
**Scope:** Conversation flow only (character roleplay messages)

---

## Overview

When the LLM generates a character's message, two sequential calls are made instead of one:

1. **Reasoning call** — the character reasons privately about what to say (non-streaming)
2. **Content call** — the character speaks, with the reasoning injected as additional context (streaming)

The reasoning is saved to the database and visible to the user via an expandable UI section on each message. It is never visible to other characters.

---

## Planned Extension (Phase B)

Phase B will add live streaming of the reasoning via a new `reasoning_delta` SSE chunk type. This is a separate worktree/PR after Phase A is validated.

---

## Schema

### `prisma/schema.prisma` — `Message` model

Add one nullable field:

```prisma
model Message {
  id             String   @id @default(uuid()) @db.Uuid
  conversationId String   @db.Uuid @map("conversation_id")
  characterId    String   @db.Uuid @map("character_id")
  content        String
  reasoning      String?
  createdAt      DateTime @default(now()) @map("created_at")

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  character    Character    @relation(fields: [characterId], references: [id], onDelete: Restrict)

  @@index([conversationId])
  @@map("messages")
}
```

Existing messages with no reasoning retain `reasoning = null` — fully backwards-compatible.

### `packages/shared/schema/conversation.ts` — `MessageRecord`

```typescript
export const MessageRecordSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  characterId: z.string().uuid(),
  characterName: z.string(),
  content: z.string(),
  reasoning: z.string().nullable(),
  createdAt: z.string(),
});
```

---

## Backend

### `frontend/lib/conversation/next.ts` — `generateNextTurnStream()`

The function gains two sequential LLM calls before persisting.

#### Call 1 — Reasoning (non-streaming)

- **System prompt:** `buildCharacterPrompt(character, sceneContext)` — identical to Call 2
- **User message:**
  ```
  Conversation so far:
  [history]

  Before responding, write your private inner thoughts as [name].
  What are you feeling, noticing, planning to say?
  First person. Be brief. This is never shown to other characters.
  ```
- **Request:** `POST /v1/messages`, `stream: false`, `max_tokens: 256`
- **Output:** extracted text string → `reasoningText`

If Call 1 fails: emit `{ type: "error" }` SSE chunk, abort — no message saved.

#### Call 2 — Content (streaming, largely unchanged)

- **System prompt:** same as before
- **User message:**
  ```
  Your private thoughts:
  [reasoningText]

  Conversation so far:
  [history]

  Now continue as [name]. Write only their next line.
  ```
- **Request:** `POST /v1/messages`, `stream: true`, `max_tokens: 512`
- **Output:** streamed text → `content`

If Call 2 fails: emit `{ type: "error" }` SSE chunk, abort — no message saved.

#### SSE — new chunk types (minimal)

Two lightweight informational chunks emitted around Call 1 (client ignores unknown types gracefully today; these are consumed explicitly after this PR):

```typescript
{ type: "thinking" }       // emitted before Call 1 starts
{ type: "thinking_done" }  // emitted after Call 1 completes
```

#### Persistence

`prisma.message.create()` at end of stream (unchanged timing):

```typescript
{ conversationId, characterId, content, reasoning: reasoningText }
```

---

## Frontend

### Message component

When `reasoning` is non-null, render a collapsible block above the message text:

```
┌─────────────────────────────────────────┐
│ 💭 Pensieri di Aria          [▼ espandi] │
├─────────────────────────────────────────┤  ← visible only when expanded
│ "Devo stare attenta a come rispondo...  │
│  non voglio rivelare troppo."           │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│ "Certo, posso aiutarti con questo."     │
└─────────────────────────────────────────┘
```

- Collapsed by default
- State: `useState<boolean>` local to the component — no global store
- Styling: muted/italic text to visually distinguish from the spoken message

### Streaming indicator

On receiving `{ type: "thinking" }`, replace the typing cursor with:

```
💭 Aria sta pensando…
```

On `{ type: "thinking_done" }`, remove it and resume normal stream display.

---

## Error Handling

| Failure point | Outcome |
|---|---|
| Call 1 (reasoning) fails | Emit `error` SSE chunk, abort, no message saved |
| Call 2 (content) fails | Emit `error` SSE chunk, abort, no message saved |

No automatic retries — consistent with current behaviour.

---

## Files Changed

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `reasoning String?` to `Message` |
| `prisma/migrations/...` | New migration |
| `packages/shared/schema/conversation.ts` | Add `reasoning` to `MessageRecordSchema` |
| `frontend/lib/conversation/next.ts` | Two-call flow, new SSE chunk types |
| `frontend/app/api/conversations/[id]/next/route.ts` | Forward `thinking`/`thinking_done` chunks |
| `frontend/app/api/conversations/[id]/jobs/[jobId]/stream/route.ts` | Same forwarding |
| Message UI component | Collapsible reasoning block + thinking indicator |
