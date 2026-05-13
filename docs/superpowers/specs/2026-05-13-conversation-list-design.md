# Conversation List — Design Spec

**Date:** 2026-05-13
**Status:** Approved

---

## Overview

Users can create, browse, and continue multi-character conversations. A conversation is a simulated
dialogue between fictional Characters (1-to-1 or multi-character). The user acts as director: sets
up the scene, picks participants, then advances the simulation one turn at a time by clicking a
button. Claude (via LiteLLM) generates each character's response in round-robin order.

---

## Data Model

Three new Prisma models added to `prisma/schema.prisma`.

```prisma
model Conversation {
  id           String                   @id @default(uuid())
  userId       String
  title        String
  context      String                   // scene setup, free text
  createdAt    DateTime                 @default(now())
  updatedAt    DateTime                 @updatedAt
  user         User                     @relation(fields: [userId], references: [id], onDelete: Cascade)
  participants ConversationParticipant[]
  messages     Message[]
}

model ConversationParticipant {
  id             String       @id @default(uuid())
  conversationId String
  characterId    String
  turnOrder      Int          // 0-based index; determines round-robin order
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  character      Character    @relation(fields: [characterId], references: [id], onDelete: Cascade)

  @@unique([conversationId, turnOrder])
}

model Message {
  id             String       @id @default(uuid())
  conversationId String
  characterId    String
  content        String
  createdAt      DateTime     @default(now())
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  character      Character    @relation(fields: [characterId], references: [id])
}
```

`Character` model gains two new reverse relations: `ConversationParticipant[]` and `Message[]`.

**Round-robin calculation (stateless):**
```ts
const nextSpeaker = participants.sort((a, b) => a.turnOrder - b.turnOrder)[
  messages.length % participants.length
];
```

No `nextTurnIndex` stored — derived from message count at query time.

---

## API Routes

All routes live under `frontend/app/api/conversations/`. Every handler starts with
`supabase.auth.getUser()` and scopes all Prisma queries by `userId`.

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/conversations` | List user's conversations with last message + participants |
| `POST` | `/api/conversations` | Create new conversation |
| `GET` | `/api/conversations/[id]` | Full conversation: messages + participants |
| `POST` | `/api/conversations/[id]/next` | Generate next message (round-robin → LiteLLM → save) |
| `DELETE` | `/api/conversations/[id]` | Delete conversation and all messages (cascade) |

### POST /api/conversations — body
```ts
{
  title: string;
  context: string;
  characterIds: string[]; // ordered array; index = turnOrder
}
```

### POST /api/conversations/[id]/next — logic
1. Load participants (sorted by `turnOrder`) + all messages for the conversation
2. Compute `nextSpeaker = participants[messages.length % participants.length]`
3. Load `nextSpeaker.character.sheet` (JSON) for persona context
4. Build prompt:
   - System: character sheet JSON as persona description + scene context
   - Messages: conversation history formatted as `[CharacterName]: text`
5. Call LiteLLM via `ANTHROPIC_BASE_URL=http://localhost:4000`, model read from `process.env.CONVERSATION_MODEL` (never hardcoded, never from client)
6. Save new `Message` to DB (`conversationId`, `characterId`, `content`)
7. Return saved message

### GET /api/conversations — response shape
```ts
{
  id: string;
  title: string;
  createdAt: string;
  participants: { characterId: string; name: string }[];
  lastMessage: { characterName: string; content: string; createdAt: string } | null;
}[]
```

---

## Shared Schemas (packages/shared/schema/)

New file: `conversation.ts`

```ts
// Input schemas (Zod)
CreateConversationInput  // title, context, characterIds[]
// GenerateNext has no client input — model comes from process.env.CONVERSATION_MODEL server-side

// Record types (inferred from Zod)
ConversationRecord       // full conversation with messages + participants
ConversationListItem     // summary for list view
MessageRecord            // single message with characterName
```

---

## UI Pages

### `/conversations` — Conversation list (post-login)

- Simple list/table: **Title** | **Last message** (`CharacterName: text truncated`) | **Date**
- "New conversation" button → opens modal
- "Delete" button per row (with confirmation)
- Empty state: "No conversations yet. Start one."
- Link accessible from home page `/`

### Modal — Create conversation

Triggered by "New conversation" button on `/conversations`. No separate route.

Fields:
- **Title** — text input
- **Scene context** — textarea (the initial scene description)
- **Participants** — checkbox list of user's existing Characters from DB, displayed in alphabetical order; list display order determines `turnOrder` (no drag-and-drop in MVP)
- Submit: "Create" button → POST `/api/conversations` → close modal → refresh list

### `/conversations/[id]` — Chat view

- Header: conversation title + participant names
- Message list: `[CharacterName]: content` + timestamp, oldest first
- "Generate next" button at bottom → POST `/api/conversations/[id]/next` → append new message
- "← Back to conversations" link
- Loading state on button while request is in flight

---

## Navigation

- Home (`/`) gets a link to `/conversations`
- No automatic redirect from `/` to `/conversations` (YAGNI for MVP)
- After creating a conversation via modal, user stays on `/conversations` (list refreshes)
- After clicking a conversation, navigates to `/conversations/[id]`

---

## Constraints & Non-Goals (MVP)

- Character personality wiring (how `sheet` JSON maps to persona prompt) is a separate task — for now pass the raw JSON
- No real-time streaming (SSE) — generate next is request/response only
- No pagination on conversation list or message history
- No conversation status (active/archived) — all conversations are always resumable
- User cannot participate as a character (future feature)
- No per-conversation settings (temperature, model) — model comes from env var

---

## Files Touched

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add Conversation, ConversationParticipant, Message models |
| `packages/shared/schema/conversation.ts` | New Zod schemas + inferred types |
| `frontend/app/api/conversations/route.ts` | GET list + POST create |
| `frontend/app/api/conversations/[id]/route.ts` | GET detail + DELETE |
| `frontend/app/api/conversations/[id]/next/route.ts` | POST generate next |
| `frontend/app/conversations/page.tsx` | List page + modal |
| `frontend/app/conversations/[id]/page.tsx` | Chat view page |
