# Enable User Participation in Conversations

**Date:** 2026-06-01
**Branch:** worktree-enable-user-conversation

## Overview

Users can opt into participating directly in a conversation during creation. When participating, the user is included in the turn rotation (round-robin or orchestrator). When it is their turn, the job pauses and waits for the user to type a message or skip. All AI components (characters, orchestrator, story improver) are aware of the user as a named participant.

## Schema Changes

### `User` — add `displayName`

```prisma
model User {
  displayName String @map("display_name")
  // ... existing fields
}
```

- Required field. Migration sets `DEFAULT ''` for existing rows.
- Collected at registration (new form field, min 1 char).

### `ConversationParticipant` — nullable `characterId`, add `isUserParticipant`

```prisma
model ConversationParticipant {
  characterId       String?  @db.Uuid @map("character_id")          // nullable
  isUserParticipant Boolean  @default(false) @map("is_user_participant")
  // turnOrder unchanged
  
  // Remove @@unique([conversationId, characterId]) — null-unsafe with Postgres
  // @@unique([conversationId, turnOrder]) remains — enforces ordering uniqueness
}
```

- At most one row with `isUserParticipant = true` per conversation — enforced in app layer at creation time.
- `character` relation becomes optional (`character Character?`).

### `Message` — nullable `characterId`, add `authorUserId`

```prisma
model Message {
  characterId  String?  @db.Uuid @map("character_id")    // nullable
  authorUserId String?  @db.Uuid @map("author_user_id")  // set for user messages

  character    Character? @relation(...)
  authorUser   User?      @relation(...)
}
```

- Invariant: exactly one of `characterId` / `authorUserId` is non-null per row.
- Existing messages unaffected (`characterId` stays set, `authorUserId` stays null).

## Registration Flow

**File:** `frontend/app/(auth)/actions.ts`, `frontend/app/(auth)/register/page.tsx`

- Add `displayName: z.string().min(1)` to `registerSchema`.
- Add "Display name" input to registration form (above email field).
- `prisma.user.upsert` saves `displayName`.

## Conversation Creation Wizard

**File:** `frontend/app/conversations/page.tsx`

New fields added after character selection step:

1. **"Join this conversation" checkbox** (`userParticipates: boolean`)
2. If checked: **"Go first?" toggle** (yes/no)
   - Yes → `userTurnOrder = 0`; character `turnOrder` values shift up by 1
   - No → `userTurnOrder = participants.length` (last slot)

**`POST /api/conversations` body additions:**
```ts
{ userParticipates: boolean; userTurnOrder?: number }
```

Server creates one `ConversationParticipant` row with `{ isUserParticipant: true, characterId: null, turnOrder: userTurnOrder }` when `userParticipates` is true.

## Turn Selection Logic

**File:** `frontend/lib/conversation/next.ts`

After the modulo/orchestrator lookup resolves `nextParticipant`:

```ts
if (nextParticipant.isUserParticipant) {
  throw new ConversationError("USER_TURN", "User turn");
}
```

`USER_TURN` is a new `ConversationError` code. The job runner catches it specifically — it is not treated as a failure.

## Job Pause Mechanism

**Files:** `frontend/app/api/conversations/[id]/jobs/[jobId]/stream/route.ts` (job runner loop)

When `USER_TURN` is caught mid-loop:

1. Set `ConversationJob.status = "awaiting_user"` in DB.
2. Emit SSE: `{ type: "user_turn" }`.
3. Poll DB: wait until a `Message` with `authorUserId = userId` appears after the job's last known message count, **or** until a skip signal is detected (job status reset to `"running"` with no new message).
4. Emit SSE: `{ type: "user_turn_done" }`.
5. Set job status back to `"running"`. Continue turn loop.

### New endpoint: `POST /api/conversations/[id]/user-message`

**Auth:** `supabase.auth.getUser()` → must own conversation.

**Request body:**
```ts
{ jobId: string; content: string | null }  // null = skip
```

**Behaviour:**
- If `content` non-null: `prisma.message.create({ characterId: null, authorUserId, content, conversationId })`
- Set `ConversationJob.status = "running"` (unblocks job poll)
- Return `200 {}`

## Prompt Injection

### Orchestrator (`lib/conversation/build-orchestrator-messages.ts`)

`OrchestratorParticipant` type:
```ts
type OrchestratorParticipant = {
  characterId: string | null;
  isUserParticipant: boolean;
  userDisplayName?: string;
  character: { name: string } | null;
};
```

`buildOrchestratorSystemPrompt` maps participants:
- Character row → `- id: {characterId} | Name: {character.name}`
- User row → `- id: user | Name: {userDisplayName}`

`selectNextSpeakerWithOrchestrator` returns `string` — either a `characterId` or the sentinel `"user"`. Caller in `next.ts` checks `result === "user"` → throws `USER_TURN`.

User messages in orchestrator history are formatted identically to character messages:
```
[{displayName}]: {content}
```

### Character prompt (`lib/prompts/index.ts`)

`buildCharacterPrompt` receives `otherNames: string[]`. When the conversation has a user participant, add `userDisplayName` to `otherNames` before calling. No Handlebars template change needed.

### Story improver (`app/api/conversations/improve-context/route.ts`)

When `userParticipates`, append `- {displayName} (you)` to the characters list in the user message sent to the story improver LLM.

### `userDisplayName` resolution

In every route handler that needs it:
```ts
const { data: { user } } = await supabase.auth.getUser();
const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { displayName: true } });
```

## Chat UI

**File:** `frontend/app/conversations/[id]/page.tsx`

### New state
```ts
const [awaitingUserTurn, setAwaitingUserTurn] = useState(false);
const [userInput, setUserInput] = useState("");
```

### SSE handler additions
| Event | Action |
|-------|--------|
| `user_turn` | `setAwaitingUserTurn(true)`, `setIsThinking(false)` |
| `user_turn_done` | `setAwaitingUserTurn(false)`, `setStreamingBuffer("")` |

### User message display

Messages with `authorUserId` set (no `characterId`) render as:
```
[You]   {content}   {timestamp}
```
No emotion dot. No reasoning toggle.

### Footer when `awaitingUserTurn`

- Hide "Run N turns" controls.
- Show: textarea (auto-focused) + **Send** button + **Skip** button.
- **Send**: POST `/api/conversations/{id}/user-message` `{ jobId, content: userInput }` → clear input, `setAwaitingUserTurn(false)` optimistically.
- **Skip**: same endpoint with `{ jobId, content: null }`.

### Sidebar cast state

User participant (`isUserParticipant: true`) shown as `"You"` with no emotion dot.

`ConversationDetail.participants` (API response type) gains `isUserParticipant: boolean`.

## Data Flow Summary

```
Wizard (userParticipates=true, userTurnOrder=N)
  → POST /api/conversations
  → ConversationParticipant {isUserParticipant:true, turnOrder:N}

Job loop: turn index hits userTurnOrder
  → generateNextTurnStream throws USER_TURN
  → job status = "awaiting_user"
  → SSE: user_turn
  → UI shows textarea + Skip

User types + sends
  → POST /api/conversations/[id]/user-message
  → Message {authorUserId, content, characterId:null}
  → job status = "running"
  → SSE: user_turn_done
  → Job loop continues

Character prompt: otherNames includes userDisplayName
Orchestrator prompt: participants list includes "id: user | Name: {displayName}"
Story improver: scene cast includes "{displayName} (you)"
```

## Out of Scope

- Profile page for editing `displayName` post-registration (mentioned as future work; existing users get empty string default).
- Timeout / auto-skip after N seconds (option C was not selected).
- User emotion tracking.
