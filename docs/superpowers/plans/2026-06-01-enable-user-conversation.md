# Enable User Participation in Conversations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to opt into a conversation at creation time, be included in the turn rotation, and submit messages when it is their turn — with all AI components (orchestrator, characters, story improver) aware of them by display name.

**Architecture:** Approach B (unified participant model) — `ConversationParticipant.characterId` is made nullable and a new `isUserParticipant` flag added, so the existing turn-order array works for both character and user slots. The job runner catches a new `USER_TURN` error from the turn generator, pauses the job, and waits for the user to submit or skip via a new endpoint. A `displayName` collected at registration is the user's identity in all prompts.

**Tech Stack:** Next.js 16 App Router, Prisma 7, PostgreSQL, Bun test, Zod v4 (packages/shared), React state hooks.

---

## File Map

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `User.displayName`; nullable `ConversationParticipant.characterId` + `isUserParticipant`; nullable `Message.characterId` + `authorUserId` |
| `packages/shared/schema/conversation.ts` | Update `CreateConversationInputSchema`, `MessageRecordSchema`, `ConversationRecordSchema`, `ImproveContextInputSchema` |
| `frontend/app/(auth)/actions.ts` | Add `displayName` to register schema + prisma upsert |
| `frontend/app/(auth)/register/page.tsx` | Add display name input |
| `frontend/lib/conversation/next.ts` | Add `USER_TURN` error code; check `isUserParticipant`; guard nullable `character`; fetch `userDisplayName` |
| `frontend/lib/conversation/build-messages.ts` | Make `ConversationMessage.characterId` nullable; handle user messages in history |
| `frontend/lib/conversation/build-orchestrator-messages.ts` | Update `OrchestratorParticipant` type; handle user in system prompt and history |
| `frontend/lib/conversation/__tests__/build-orchestrator-messages.test.ts` | New — tests for user participant in orchestrator prompt |
| `frontend/lib/orchestrator.ts` | Update fallback + validation for `"user"` sentinel |
| `frontend/lib/jobs/runner.ts` | Add `resumeUserTurn`; pause on `USER_TURN`; new `onUserTurn`/`onUserTurnDone` events |
| `frontend/app/api/conversations/[id]/jobs/[jobId]/stream/route.ts` | Wire `onUserTurn`/`onUserTurnDone` SSE |
| `frontend/app/api/conversations/[id]/user-message/route.ts` | New — POST user message or skip |
| `frontend/app/api/conversations/route.ts` | Accept `userParticipates`/`userTurnOrder`; create user participant; fix nullable character in GET |
| `frontend/app/api/conversations/[id]/route.ts` | Handle nullable character in participants + messages; add `isUserParticipant`; user message display |
| `frontend/app/api/conversations/improve-context/route.ts` | Append user to scene cast when `userParticipates` |
| `frontend/app/conversations/page.tsx` | Add participate checkbox + "go first?" toggle |
| `frontend/app/conversations/[id]/page.tsx` | `awaitingUserTurn` state; render user messages; textarea + Send/Skip footer |

---

### Task 1: Prisma schema changes + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Run: `bun run prisma:migrate:dev`
- Run: `bun run prisma:generate`

- [ ] **Step 1: Edit prisma/schema.prisma**

Apply these changes:

```prisma
model User {
  id          String      @id @db.Uuid
  email       String      @unique
  displayName String      @default("") @map("display_name")
  createdAt   DateTime    @default(now()) @map("created_at")
  updatedAt   DateTime    @updatedAt @map("updated_at")
  characters       Character[]
  conversations    Conversation[]
  agentSessions    AgentSession[]
  conversationJobs ConversationJob[]
  llmUsages        LlmUsage[]
  authoredMessages Message[]        @relation("MessageAuthor")

  @@map("users")
}
```

```prisma
model ConversationParticipant {
  id                String   @id @default(uuid()) @db.Uuid
  conversationId    String   @db.Uuid @map("conversation_id")
  characterId       String?  @db.Uuid @map("character_id")
  isUserParticipant Boolean  @default(false) @map("is_user_participant")
  turnOrder         Int      @map("turn_order")

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  character    Character?   @relation(fields: [characterId], references: [id], onDelete: Cascade)

  @@unique([conversationId, turnOrder])
  @@map("conversation_participants")
}
```

```prisma
model Message {
  id             String   @id @default(uuid()) @db.Uuid
  conversationId String   @db.Uuid @map("conversation_id")
  characterId    String?  @db.Uuid @map("character_id")
  authorUserId   String?  @db.Uuid @map("author_user_id")
  content        String
  reasoning      String?
  emotion        String   @default("Joy")
  intensity      String   @default("low")
  subtext        String   @default("")
  createdAt      DateTime @default(now()) @map("created_at")

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  character    Character?   @relation(fields: [characterId], references: [id], onDelete: Restrict)
  authorUser   User?        @relation("MessageAuthor", fields: [authorUserId], references: [id], onDelete: SetNull)

  @@index([conversationId])
  @@map("messages")
}
```

Note: remove the old `@@unique([conversationId, characterId])` line from `ConversationParticipant` entirely (it was previously there).

- [ ] **Step 2: Run migration**

```bash
bun run prisma:migrate:dev
```

When prompted for a migration name, enter: `user_participation`

Expected: migration file created, no errors.

- [ ] **Step 3: Generate Prisma client**

```bash
bun run prisma:generate
```

Expected output includes: `✔ Generated Prisma Client`

- [ ] **Step 4: Typecheck passes**

```bash
bun run typecheck
```

Expected: 0 errors (some may appear in files we haven't updated yet — note them, fix in subsequent tasks).

---

### Task 2: Update shared schemas

**Files:**
- Modify: `packages/shared/schema/conversation.ts`

- [ ] **Step 1: Update CreateConversationInputSchema**

In `packages/shared/schema/conversation.ts`, change `CreateConversationInputSchema` to:

```typescript
export const CreateConversationInputSchema = z.object({
  title: z.string().min(1),
  context: z.string().min(1),
  characterIds: z.array(uuidSchema).min(1),
  turnStrategy: TurnStrategySchema.optional().default('ORCHESTRATOR'),
  userParticipates: z.boolean().optional().default(false),
  userTurnOrder: z.number().int().min(0).optional(),
});
export type CreateConversationInput = z.infer<typeof CreateConversationInputSchema>;
```

- [ ] **Step 2: Update MessageRecordSchema**

Replace `MessageRecordSchema` with:

```typescript
export const MessageRecordSchema = z.object({
  id: uuidSchema,
  conversationId: uuidSchema,
  characterId: uuidSchema.nullable(),
  authorUserId: uuidSchema.nullable().optional(),
  characterName: z.string(),
  content: z.string(),
  reasoning: z.string().nullable(),
  emotion: z.string(),
  intensity: z.string(),
  subtext: z.string(),
  createdAt: z.string(),
});
export type MessageRecord = z.infer<typeof MessageRecordSchema>;
```

- [ ] **Step 3: Update ConversationRecordSchema participants**

Replace the `participants` array shape inside `ConversationRecordSchema`:

```typescript
export const ConversationRecordSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  context: z.string(),
  turnStrategy: TurnStrategySchema,
  createdAt: z.string(),
  participants: z.array(
    z.object({
      characterId: uuidSchema.nullable(),
      name: z.string(),
      turnOrder: z.number().int().min(0),
      isUserParticipant: z.boolean(),
    })
  ),
  messages: z.array(MessageRecordSchema),
});
export type ConversationRecord = z.infer<typeof ConversationRecordSchema>;
```

- [ ] **Step 4: Update ImproveContextInputSchema**

```typescript
export const ImproveContextInputSchema = z.object({
  draft: z.string().min(1),
  characterIds: z.array(uuidSchema).min(1),
  userParticipates: z.boolean().optional().default(false),
});
export type ImproveContextInput = z.infer<typeof ImproveContextInputSchema>;
```

- [ ] **Step 5: Run shared tests**

```bash
bun test --cwd packages/shared
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/schema/conversation.ts
git commit -m "feat: update shared schemas for user conversation participation"
```

---

### Task 3: Registration — collect displayName

**Files:**
- Modify: `frontend/app/(auth)/actions.ts`
- Modify: `frontend/app/(auth)/register/page.tsx`

- [ ] **Step 1: Update registerSchema and register action**

In `frontend/app/(auth)/actions.ts`, change `registerSchema` and the `register` function:

```typescript
const registerSchema = z
  .object({
    displayName: z.string().min(1, "Display name is required"),
    email: z.string().email(),
    password: z.string().min(8),
    confirmPassword: z.string().min(8),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
```

In the `register` function, update the `safeParse` call:

```typescript
const parsed = registerSchema.safeParse({
  displayName: formData.get("displayName"),
  email: formData.get("email"),
  password: formData.get("password"),
  confirmPassword: formData.get("confirmPassword"),
})
```

And update the prisma upsert:

```typescript
await prisma.user.upsert({
  where: { id: data.user.id },
  update: { email: parsed.data.email, displayName: parsed.data.displayName },
  create: { id: data.user.id, email: parsed.data.email, displayName: parsed.data.displayName },
})
```

- [ ] **Step 2: Add displayName input to register form**

In `frontend/app/(auth)/register/page.tsx`, add the input as the first field inside the `<form>`:

```tsx
<input
  name="displayName"
  type="text"
  placeholder="Display name"
  required
  autoComplete="nickname"
  className={inputClass}
/>
```

Place it before the email input.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/(auth)/actions.ts frontend/app/(auth)/register/page.tsx
git commit -m "feat: collect displayName at registration"
```

---

### Task 4: USER_TURN error code + turn selection

**Files:**
- Modify: `frontend/lib/conversation/next.ts`
- Modify: `frontend/lib/conversation/build-messages.ts`

- [ ] **Step 1: Add USER_TURN to ConversationError and guard nullable character**

In `frontend/lib/conversation/next.ts`:

1. Update `ConversationError` code type:

```typescript
export class ConversationError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "NO_PARTICIPANTS" | "ENV_MISSING" | "LITELLM_ERROR" | "USER_TURN",
    message: string,
  ) {
    super(message);
    this.name = "ConversationError";
  }
}
```

2. After the `nextParticipant` is resolved (both ORCHESTRATOR and ROUND_ROBIN branches), add the user-turn check. Place it right after the closing `}` of the ORCHESTRATOR/else block, before `const sheet = ...`:

```typescript
  if (nextParticipant.isUserParticipant) {
    throw new ConversationError("USER_TURN", "User turn — waiting for user input");
  }
```

3. Fetch `userDisplayName` for use in otherNames. Add after the `if (!conversation)` check and before the `if (conversation.participants.length === 0)` check:

```typescript
  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { displayName: true },
  });
  const userDisplayName = dbUser?.displayName ?? "Player";
```

4. Update `otherNames` to handle user participant (null character):

```typescript
  const otherNames = conversation.participants
    .filter((p) => p.characterId !== nextParticipant.characterId || p.isUserParticipant)
    .filter((p) => p !== nextParticipant)
    .map((p) => (p.isUserParticipant ? userDisplayName : p.character!.name));
```

Actually, simpler — just filter out the current speaker and map:

```typescript
  const otherNames = conversation.participants
    .filter((p) => p.id !== nextParticipant.id)
    .map((p) => (p.isUserParticipant ? userDisplayName : p.character!.name));
```

5. Fix `lastSpeakerName` (nullable character):

```typescript
  const lastMsg = conversation.messages.at(-1);
  const lastSpeakerName = lastMsg
    ? (lastMsg.character?.name ?? userDisplayName)
    : null;
```

6. Fix `CharacterSearchResultSchema.parse` — `nextParticipant.character` is now `Character | null` but we already threw `USER_TURN` above for user participants, so here it is guaranteed non-null. Add a runtime guard anyway:

```typescript
  if (!nextParticipant.character) {
    throw new ConversationError("USER_TURN", "User turn — waiting for user input");
  }
  const sheet = CharacterSearchResultSchema.parse(nextParticipant.character.sheet);
```

7. In `prisma.message.create` at the bottom, `characterId` is now nullable in Prisma — the existing code passes `characterId: nextParticipant.characterId` which is `string | null`. For character turns it is always a string, so no change needed here.

- [ ] **Step 2: Update build-messages.ts for user messages**

In `frontend/lib/conversation/build-messages.ts`, update the `ConversationMessage` type and the else-branch to handle user messages (null `character`):

```typescript
type ConversationMessage = {
  characterId: string | null;
  authorUserId?: string | null;
  character: { name: string } | null;
  authorName?: string | null;
  content: string;
  emotion: string;
  intensity: string;
  subtext: string;
  reasoning: string | null;
};
```

In the `for` loop, update the else-branch to guard null character:

```typescript
    } else {
      const speakerName = msg.character?.name ?? msg.authorName ?? "Unknown";
      pendingOthers.push(
        buildHistoryLine(
          speakerName,
          msg.content,
          msg.emotion,
          msg.intensity,
          msg.subtext,
        ),
      );
    }
```

- [ ] **Step 3: Update next.ts message mapping to pass authorName**

In `frontend/lib/conversation/next.ts`, when calling `buildCharacterMessages`, pass messages with `authorName` for user messages. The `conversation.messages` include result now returns `character: Character | null`. Map them:

```typescript
  const historyMessages = conversation.messages.map((m) => ({
    characterId: m.characterId,
    authorUserId: m.authorUserId,
    character: m.character ? { name: m.character.name } : null,
    authorName: m.authorUserId ? userDisplayName : null,
    content: m.content,
    emotion: m.emotion,
    intensity: m.intensity,
    subtext: m.subtext,
    reasoning: m.reasoning,
  }));
```

Then replace the `conversation.messages` argument in the `buildCharacterMessages` call with `historyMessages`.

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck
```

Expected: no new errors in these files.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/conversation/next.ts frontend/lib/conversation/build-messages.ts
git commit -m "feat: add USER_TURN error code and user-aware turn selection"
```

---

### Task 5: Orchestrator — user participant support

**Files:**
- Modify: `frontend/lib/conversation/build-orchestrator-messages.ts`
- Modify: `frontend/lib/orchestrator.ts`
- Create: `frontend/lib/conversation/__tests__/build-orchestrator-messages.test.ts`

- [ ] **Step 1: Write failing tests**

Create `frontend/lib/conversation/__tests__/build-orchestrator-messages.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import {
  buildOrchestratorSystemPrompt,
  buildOrchestratorMessages,
  type OrchestratorParticipant,
  type OrchestratorMessage,
} from "../build-orchestrator-messages";

const charParticipants: OrchestratorParticipant[] = [
  { characterId: "char-1", isUserParticipant: false, character: { name: "Alice" } },
  { characterId: "char-2", isUserParticipant: false, character: { name: "Bob" } },
];

const withUser: OrchestratorParticipant[] = [
  { characterId: "char-1", isUserParticipant: false, character: { name: "Alice" } },
  { characterId: null, isUserParticipant: true, userDisplayName: "Dave", character: null },
];

describe("buildOrchestratorSystemPrompt", () => {
  test("lists character participants by id and name", () => {
    const prompt = buildOrchestratorSystemPrompt(charParticipants);
    expect(prompt).toContain("id: char-1 | Name: Alice");
    expect(prompt).toContain("id: char-2 | Name: Bob");
  });

  test("lists user participant with sentinel id 'user' and displayName", () => {
    const prompt = buildOrchestratorSystemPrompt(withUser);
    expect(prompt).toContain("id: user | Name: Dave");
  });

  test("omits user participant characterId from character list", () => {
    const prompt = buildOrchestratorSystemPrompt(withUser);
    expect(prompt).not.toContain("id: null");
    expect(prompt).not.toContain("id:  |");
  });
});

describe("buildOrchestratorMessages — user messages in history", () => {
  const userMessage: OrchestratorMessage = {
    characterId: null,
    authorUserId: "user-uuid",
    character: null,
    authorName: "Dave",
    content: "Hello there.",
    reasoning: null,
  };
  const charMessage: OrchestratorMessage = {
    characterId: "char-1",
    authorUserId: null,
    character: { name: "Alice" },
    authorName: null,
    content: "Hi Dave.",
    reasoning: null,
  };

  test("formats user message with authorName in history", () => {
    const msgs = buildOrchestratorMessages([userMessage, charMessage]);
    const userTurnContent = msgs.find(
      (m) => m.role === "user" && (m.content as string).includes("[Dave]:")
    );
    expect(userTurnContent).toBeDefined();
  });

  test("formats character message with character.name in history", () => {
    const msgs = buildOrchestratorMessages([userMessage, charMessage]);
    const charTurnContent = msgs.find(
      (m) => m.role === "user" && (m.content as string).includes("[Alice]:")
    );
    expect(charTurnContent).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test --cwd frontend frontend/lib/conversation/__tests__/build-orchestrator-messages.test.ts
```

Expected: FAIL (type errors or missing properties).

- [ ] **Step 3: Update OrchestratorParticipant and OrchestratorMessage types**

In `frontend/lib/conversation/build-orchestrator-messages.ts`, replace the type definitions:

```typescript
export type OrchestratorParticipant = {
  characterId: string | null;
  isUserParticipant: boolean;
  userDisplayName?: string;
  character: { name: string } | null;
};

export type OrchestratorMessage = {
  characterId: string | null;
  authorUserId?: string | null;
  character: { name: string } | null;
  authorName?: string | null;
  content: string;
  reasoning: string | null;
};
```

- [ ] **Step 4: Update buildOrchestratorSystemPrompt**

```typescript
export function buildOrchestratorSystemPrompt(
  participants: OrchestratorParticipant[],
): string {
  const charactersList = participants
    .map((p) => {
      if (p.isUserParticipant) {
        return `- id: user | Name: ${p.userDisplayName ?? "Player"}`;
      }
      return `- id: ${p.characterId} | Name: ${p.character!.name}`;
    })
    .join("\n");

  return [
    "You are a conversation director for a multi-character roleplay scene.",
    "Given the conversation history in the messages, decide which character should speak",
    "next to make the conversation feel natural and engaging.",
    "Reply with only the characterId of the chosen character, nothing else.",
    "If it is the human player's turn, reply with the word: user",
    "",
    "Characters:",
    charactersList,
  ].join("\n");
}
```

- [ ] **Step 5: Update buildUserTurn to handle null character**

In `buildUserTurn`, use `authorName` fallback:

```typescript
function buildUserTurn(message: OrchestratorMessage): string {
  const speakerName = message.character?.name ?? message.authorName ?? "Unknown";
  const lines: string[] = [`[${speakerName}]: ${message.content}`];
  if (message.reasoning) {
    lines.push(`Private thoughts: ${message.reasoning}`);
  }
  lines.push(WHO_NEXT);
  return lines.join("\n");
}
```

- [ ] **Step 6: Update orchestrator.ts fallback and validation**

In `frontend/lib/orchestrator.ts`:

1. Update the `fallback` function to handle user participant (no characterId):

```typescript
function fallback(
  participants: OrchestratorParticipant[],
  messages: OrchestratorMessage[],
): string {
  if (participants.length === 0)
    throw new Error("[orchestrator] fallback called with empty participants");
  const p = participants[messages.length % participants.length];
  if (p === undefined)
    throw new Error("[orchestrator] fallback index out of range");
  return p.isUserParticipant ? "user" : p.characterId!;
}
```

2. Update validation after LLM response — accept `"user"` sentinel:

```typescript
  const chosen = (response.choices[0]?.message.content ?? "").trim();

  if (chosen === "user" && participants.some((p) => p.isUserParticipant)) {
    return "user";
  }

  if (participants.some((p) => p.characterId === chosen)) {
    return chosen;
  }

  console.error(`[orchestrator] Invalid characterId returned: "${chosen}"`);
  return fallback(participants, messages);
```

- [ ] **Step 7: Update next.ts orchestrator call to pass userDisplayName**

In `frontend/lib/conversation/next.ts`, the `selectNextSpeakerWithOrchestrator` call currently passes `conversation.participants`. These now include user participants. Update the mapping:

The `conversation.participants` from prisma already have `isUserParticipant` and nullable `characterId` and nullable `character`. The `OrchestratorParticipant` type now matches. Pass them directly — but we need to add `userDisplayName` for user participants:

```typescript
  const orchestratorParticipants = conversation.participants.map((p) => ({
    characterId: p.characterId,
    isUserParticipant: p.isUserParticipant,
    userDisplayName: p.isUserParticipant ? userDisplayName : undefined,
    character: p.character ? { name: p.character.name } : null,
  }));
```

Similarly update `orchestratorMessages` mapping in the call:

```typescript
  const orchestratorMessages = conversation.messages.map((m) => ({
    characterId: m.characterId,
    authorUserId: m.authorUserId,
    character: m.character ? { name: m.character.name } : null,
    authorName: m.authorUserId ? userDisplayName : null,
    content: m.content,
    reasoning: m.reasoning,
  }));
```

Then call:

```typescript
  const characterId = await selectNextSpeakerWithOrchestrator(
    orchestratorParticipants,
    orchestratorMessages,
    conversationId,
    userId,
  );
  if (characterId === "user") {
    throw new ConversationError("USER_TURN", "User turn — waiting for user input");
  }
  const found = conversation.participants.find((p) => p.characterId === characterId);
```

- [ ] **Step 8: Run tests**

```bash
bun test --cwd frontend frontend/lib/conversation/__tests__/build-orchestrator-messages.test.ts
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add \
  frontend/lib/conversation/build-orchestrator-messages.ts \
  frontend/lib/orchestrator.ts \
  frontend/lib/conversation/__tests__/build-orchestrator-messages.test.ts \
  frontend/lib/conversation/next.ts
git commit -m "feat: orchestrator and character prompt aware of user participant"
```

---

### Task 6: Job runner — pause on USER_TURN

**Files:**
- Modify: `frontend/lib/jobs/runner.ts`
- Modify: `frontend/app/api/conversations/[id]/jobs/[jobId]/stream/route.ts`

- [ ] **Step 1: Add resumeUserTurn export and new events to JobHandlers**

In `frontend/lib/jobs/runner.ts`:

1. Add `userTurnResolvers` map after `abortControllers`:

```typescript
const userTurnResolvers = new Map<string, (() => void)[]>();
```

2. Export `resumeUserTurn`:

```typescript
export function resumeUserTurn(jobId: string): void {
  const resolvers = userTurnResolvers.get(jobId) ?? [];
  userTurnResolvers.delete(jobId);
  for (const resolve of resolvers) resolve();
}
```

3. Add to `JobHandlers` interface:

```typescript
export interface JobHandlers {
  onToken: (text: string) => void;
  onEmotion: (emotion: { emotion: string; intensity: string; subtext: string }) => void;
  onTurnDone: (doneTurns: number, totalTurns: number) => void;
  onDone: () => void;
  onError: (message: string) => void;
  onThinking?: () => void;
  onThinkingDone?: () => void;
  onUserTurn?: () => void;
  onUserTurnDone?: () => void;
}
```

4. In `subscribeToJob`, add wiring for new events:

```typescript
export function subscribeToJob(jobId: string, handlers: JobHandlers): () => void {
  const onToken = (text: string) => handlers.onToken(text);
  const onTurnDone = (done: number, total: number) => handlers.onTurnDone(done, total);
  const onDone = () => handlers.onDone();
  const onError = (msg: string) => handlers.onError(msg);
  const onThinking = () => handlers.onThinking?.();
  const onThinkingDone = () => handlers.onThinkingDone?.();
  const onUserTurn = () => handlers.onUserTurn?.();
  const onUserTurnDone = () => handlers.onUserTurnDone?.();
  const onEmotion = (e: { emotion: string; intensity: string; subtext: string }) =>
    handlers.onEmotion(e);

  emitter.on(`${jobId}:token`, onToken);
  emitter.on(`${jobId}:emotion`, onEmotion);
  emitter.on(`${jobId}:turn_done`, onTurnDone);
  emitter.once(`${jobId}:done`, onDone);
  emitter.once(`${jobId}:error`, onError);
  emitter.on(`${jobId}:thinking`, onThinking);
  emitter.on(`${jobId}:thinking_done`, onThinkingDone);
  emitter.on(`${jobId}:user_turn`, onUserTurn);
  emitter.on(`${jobId}:user_turn_done`, onUserTurnDone);

  return () => {
    emitter.off(`${jobId}:token`, onToken);
    emitter.off(`${jobId}:emotion`, onEmotion);
    emitter.off(`${jobId}:turn_done`, onTurnDone);
    emitter.off(`${jobId}:thinking`, onThinking);
    emitter.off(`${jobId}:thinking_done`, onThinkingDone);
    emitter.off(`${jobId}:user_turn`, onUserTurn);
    emitter.off(`${jobId}:user_turn_done`, onUserTurnDone);
  };
}
```

- [ ] **Step 2: Add USER_TURN pause logic to runTurns**

Import `ConversationError` at the top of `runner.ts`:

```typescript
import { generateNextTurnStream, ConversationError } from "@/lib/conversation/next";
```

In `runTurns`, inside the try/catch block around `generateNextTurnStream`, add handling for `USER_TURN` after the `isAbortError` check:

```typescript
      } catch (err) {
        if (isAbortError(err)) {
          cancelledJobs.delete(jobId);
          await prisma.conversationJob.update({
            where: { id: jobId },
            data: { status: "cancelled" },
          });
          emitter.emit(`${jobId}:done`);
          return;
        }

        if (err instanceof ConversationError && err.code === "USER_TURN") {
          await prisma.conversationJob.update({
            where: { id: jobId },
            data: { status: "awaiting_user" },
          });
          emitter.emit(`${jobId}:user_turn`);

          // Wait until resumeUserTurn is called (user submits or skips)
          await new Promise<void>((resolve) => {
            const existing = userTurnResolvers.get(jobId) ?? [];
            userTurnResolvers.set(jobId, [...existing, resolve]);

            // Also resolve if the job is cancelled mid-wait
            const checkCancel = setInterval(() => {
              if (cancelledJobs.has(jobId)) {
                clearInterval(checkCancel);
                resolve();
              }
            }, 500);

            // Clean up interval once resolved by resumeUserTurn
            const origResolvers = userTurnResolvers.get(jobId) ?? [];
            const wrappedResolve = () => {
              clearInterval(checkCancel);
              resolve();
            };
            userTurnResolvers.set(jobId, origResolvers.map((r) => (r === resolve ? wrappedResolve : r)));
          });

          if (cancelledJobs.has(jobId)) {
            cancelledJobs.delete(jobId);
            await prisma.conversationJob.update({
              where: { id: jobId },
              data: { status: "cancelled" },
            });
            emitter.emit(`${jobId}:done`);
            return;
          }

          await prisma.conversationJob.update({
            where: { id: jobId },
            data: { status: "running" },
          });
          emitter.emit(`${jobId}:user_turn_done`);

          // Count the user turn as a completed turn
          await prisma.conversationJob.update({
            where: { id: jobId },
            data: { doneTurns: i + 1 },
          });
          emitter.emit(`${jobId}:turn_done`, i + 1, totalTurns);
          continue;
        }

        throw err;
      }
```

Note: the `continue` at the end skips the `doneTurns` update and `turn_done` emit that happen after the try/catch — those are handled inside the USER_TURN block above.

- [ ] **Step 3: Wire user_turn events in stream route**

In `frontend/app/api/conversations/[id]/jobs/[jobId]/stream/route.ts`, add `onUserTurn` and `onUserTurnDone` to the `subscribeToJob` call:

```typescript
      const unsub = subscribeToJob(jobId, {
        onToken: (text) => {
          if (!closed) controller.enqueue(encode({ type: "token", text }));
        },
        onEmotion: (emotion) => {
          if (!closed) controller.enqueue(encode({ type: "emotion", ...emotion }));
        },
        onTurnDone: (doneTurns, totalTurns) => {
          if (!closed) controller.enqueue(encode({ type: "turn_done", doneTurns, totalTurns }));
        },
        onDone: () => {
          if (!closed) controller.enqueue(encode({ type: "done" }));
          unsub();
          close();
        },
        onError: (message) => {
          if (!closed) controller.enqueue(encode({ type: "error", message }));
          unsub();
          close();
        },
        onThinking: () => {
          if (!closed) controller.enqueue(encode({ type: "thinking" }));
        },
        onThinkingDone: () => {
          if (!closed) controller.enqueue(encode({ type: "thinking_done" }));
        },
        onUserTurn: () => {
          if (!closed) controller.enqueue(encode({ type: "user_turn" }));
        },
        onUserTurnDone: () => {
          if (!closed) controller.enqueue(encode({ type: "user_turn_done" }));
        },
      });
```

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add \
  frontend/lib/jobs/runner.ts \
  frontend/app/api/conversations/[id]/jobs/[jobId]/stream/route.ts
git commit -m "feat: job runner pauses on USER_TURN and waits for user input"
```

---

### Task 7: User message endpoint

**Files:**
- Create: `frontend/app/api/conversations/[id]/user-message/route.ts`

- [ ] **Step 1: Create the route**

```typescript
// frontend/app/api/conversations/[id]/user-message/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { resumeUserTurn } from "@/lib/jobs/runner";
import { z } from "zod";

const UserMessageInputSchema = z.object({
  jobId: z.string().uuid(),
  content: z.string().min(1).nullable(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (!user || error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UserMessageInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { jobId, content } = parsed.data;

  const job = await prisma.conversationJob.findFirst({
    where: { id: jobId, conversationId: id, userId: user.id, status: "awaiting_user" },
  });
  if (!job) {
    return NextResponse.json({ error: "Job not found or not awaiting user" }, { status: 404 });
  }

  if (content !== null) {
    await prisma.message.create({
      data: {
        conversationId: id,
        characterId: null,
        authorUserId: user.id,
        content,
        emotion: "Joy",
        intensity: "low",
        subtext: "",
      },
    });
  }

  // Unblock the job runner
  resumeUserTurn(jobId);

  return NextResponse.json({});
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: no errors in this file.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/api/conversations/[id]/user-message/route.ts
git commit -m "feat: POST /api/conversations/[id]/user-message endpoint"
```

---

### Task 8: Conversation creation API — user participant

**Files:**
- Modify: `frontend/app/api/conversations/route.ts`

- [ ] **Step 1: Update POST handler**

In `frontend/app/api/conversations/route.ts`, update the POST handler to extract `userParticipates` and `userTurnOrder`, and create the user participant:

Replace the destructuring line:

```typescript
  const { title, context, characterIds, turnStrategy, userParticipates, userTurnOrder } = parsed.data;
```

Replace the `prisma.conversation.create` call:

```typescript
  // Build participant list. If user participates and goes first (userTurnOrder=0),
  // shift character indices up by 1.
  const userGoesFirst = userParticipates && userTurnOrder === 0;
  const characterParticipants = characterIds.map((characterId, index) => ({
    characterId,
    isUserParticipant: false as const,
    turnOrder: userGoesFirst ? index + 1 : index,
  }));

  const userParticipant = userParticipates
    ? [{
        characterId: null,
        isUserParticipant: true as const,
        turnOrder: userTurnOrder ?? characterIds.length,
      }]
    : [];

  const conversation = await prisma.conversation.create({
    data: {
      userId: user.id,
      title,
      context,
      turnStrategy,
      participants: {
        create: [...characterParticipants, ...userParticipant],
      },
    },
    include: {
      participants: {
        include: { character: { select: { id: true, name: true } } },
        orderBy: { turnOrder: "asc" },
      },
    },
  });
```

Update the response to handle nullable character:

```typescript
  return NextResponse.json(
    {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt.toISOString(),
      participants: conversation.participants.map((p) => ({
        characterId: p.character?.id ?? null,
        name: p.character?.name ?? "You",
        isUserParticipant: p.isUserParticipant,
      })),
      lastMessage: null,
    },
    { status: 201 }
  );
```

- [ ] **Step 2: Fix GET handler nullable character**

In the same file, update the GET handler's response mapping to guard null character:

```typescript
  const items = conversations
    .map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt.toISOString(),
      participants: c.participants
        .filter((p) => !p.isUserParticipant)
        .map((p) => ({
          characterId: p.character!.id,
          name: p.character!.name,
        })),
      lastMessage:
        c.messages[0] != null
          ? {
              characterName: c.messages[0].character?.name ?? "You",
              content: c.messages[0].content,
              createdAt: c.messages[0].createdAt.toISOString(),
            }
          : null,
    }))
```

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add frontend/app/api/conversations/route.ts
git commit -m "feat: conversation creation API supports user participant"
```

---

### Task 9: Conversation detail API — user messages + isUserParticipant

**Files:**
- Modify: `frontend/app/api/conversations/[id]/route.ts`

- [ ] **Step 1: Include authorUserId in messages query + update response**

In `frontend/app/api/conversations/[id]/route.ts`, update the GET handler.

Update the prisma query to also include `authorUserId`:

```typescript
  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: user.id },
    include: {
      participants: {
        include: { character: { select: { id: true, name: true } } },
        orderBy: { turnOrder: "asc" },
      },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { character: { select: { id: true, name: true } } },
      },
    },
  });
```

Get the user's displayName for user messages:

```typescript
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { displayName: true },
  });
  const userDisplayName = dbUser?.displayName ?? "You";
```

Update the response:

```typescript
  return NextResponse.json({
    id: conversation.id,
    title: conversation.title,
    context: conversation.context,
    turnStrategy: conversation.turnStrategy,
    createdAt: conversation.createdAt.toISOString(),
    participants: conversation.participants.map((p) => ({
      characterId: p.character?.id ?? null,
      name: p.isUserParticipant ? userDisplayName : p.character!.name,
      turnOrder: p.turnOrder,
      isUserParticipant: p.isUserParticipant,
    })),
    messages: conversation.messages.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      characterId: m.characterId ?? null,
      authorUserId: m.authorUserId ?? null,
      characterName: m.authorUserId ? userDisplayName : (m.character?.name ?? ""),
      content: m.content,
      reasoning: m.reasoning ?? null,
      emotion: m.emotion,
      intensity: m.intensity,
      subtext: m.subtext,
      createdAt: m.createdAt.toISOString(),
    })),
  });
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add frontend/app/api/conversations/[id]/route.ts
git commit -m "feat: conversation detail API includes user participant and user messages"
```

---

### Task 10: Story improver — include user in scene cast

**Files:**
- Modify: `frontend/app/api/conversations/improve-context/route.ts`

- [ ] **Step 1: Update POST handler to include user when userParticipates**

The handler receives `characterIds` and now also `userParticipates` (from updated shared schema). Fetch displayName and append user to character lines:

After the `const { draft, characterIds, userParticipates } = parsed.data;` line, add:

```typescript
  let userDisplayName: string | null = null;
  if (userParticipates) {
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { displayName: true },
    });
    userDisplayName = dbUser?.displayName ?? "Player";
  }
```

Update `characterLines`:

```typescript
  const characterLines = [
    ...characters.map((ch) => `- ${ch.name}`),
    ...(userDisplayName ? [`- ${userDisplayName} (you)`] : []),
  ];
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add frontend/app/api/conversations/improve-context/route.ts
git commit -m "feat: story improver includes user in scene cast when participating"
```

---

### Task 11: Wizard UI — participate checkbox + go-first toggle

**Files:**
- Modify: `frontend/app/conversations/page.tsx`

- [ ] **Step 1: Add userParticipates and userGoesFirst state**

In `frontend/app/conversations/page.tsx`, add two new state variables alongside the existing form state:

```typescript
const [userParticipates, setUserParticipates] = useState(false);
const [userGoesFirst, setUserGoesFirst] = useState(false);
```

- [ ] **Step 2: Add UI fields after character selection**

After the character checkboxes section (before the turn strategy section or at the end of the form), add:

```tsx
{/* User participation */}
<div className="flex flex-col gap-3">
  <label className="flex items-center gap-2 cursor-pointer">
    <input
      type="checkbox"
      checked={userParticipates}
      onChange={(e) => {
        setUserParticipates(e.target.checked);
        if (!e.target.checked) setUserGoesFirst(false);
      }}
      className="size-4 rounded"
    />
    <span className="text-sm" style={{ color: "var(--ink)" }}>
      Join this conversation as a participant
    </span>
  </label>
  {userParticipates && (
    <label className="flex items-center gap-2 cursor-pointer ml-6">
      <input
        type="checkbox"
        checked={userGoesFirst}
        onChange={(e) => setUserGoesFirst(e.target.checked)}
        className="size-4 rounded"
      />
      <span className="text-sm" style={{ color: "var(--ink-mute)" }}>
        Go first
      </span>
    </label>
  )}
</div>
```

- [ ] **Step 3: Pass userParticipates and userTurnOrder to the creation API**

Find the `handleCreate` function (or POST fetch call for conversation creation). Update the body:

```typescript
body: JSON.stringify({
  title,
  context,
  characterIds: selectedIds,
  turnStrategy,
  userParticipates,
  userTurnOrder: userParticipates
    ? (userGoesFirst ? 0 : selectedIds.length)
    : undefined,
}),
```

- [ ] **Step 4: Pass userParticipates to improve-context call**

Find the improve-context fetch call in the wizard. Update its body to include `userParticipates`:

```typescript
body: JSON.stringify({
  draft: context,
  characterIds: selectedIds,
  userParticipates,
}),
```

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add frontend/app/conversations/page.tsx
git commit -m "feat: wizard UI — join conversation checkbox and go-first toggle"
```

---

### Task 12: Chat UI — user turn handling

**Files:**
- Modify: `frontend/app/conversations/[id]/page.tsx`

- [ ] **Step 1: Update types**

At the top of `frontend/app/conversations/[id]/page.tsx`, update `Participant` and `Message` types:

```typescript
type Participant = {
  characterId: string | null;
  name: string;
  turnOrder: number;
  isUserParticipant: boolean;
};

type Message = {
  id: string;
  characterId: string | null;
  authorUserId: string | null;
  characterName: string;
  content: string;
  reasoning: string | null;
  emotion: string;
  intensity: string;
  subtext: string;
  createdAt: string;
};
```

- [ ] **Step 2: Add awaitingUserTurn state + activeJobId**

Add state near the top of the component:

```typescript
const [awaitingUserTurn, setAwaitingUserTurn] = useState(false);
const [userInput, setUserInput] = useState("");
```

- [ ] **Step 3: Wire user_turn SSE events**

In the `es.onmessage` handler, add two new cases inside the `if/else if` chain:

```typescript
      } else if (data.type === "user_turn") {
        setAwaitingUserTurn(true);
        setIsThinking(false);
      } else if (data.type === "user_turn_done") {
        setAwaitingUserTurn(false);
        setStreamingBuffer("");
        void loadConversation();
```

- [ ] **Step 4: Add handleUserSend and handleUserSkip**

```typescript
  async function handleUserSend() {
    if (!activeJob || !userInput.trim()) return;
    const content = userInput.trim();
    setUserInput("");
    setAwaitingUserTurn(false);
    await fetch(`/api/conversations/${id}/user-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: activeJob.id, content }),
    });
  }

  async function handleUserSkip() {
    if (!activeJob) return;
    setAwaitingUserTurn(false);
    await fetch(`/api/conversations/${id}/user-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: activeJob.id, content: null }),
    });
  }
```

- [ ] **Step 5: Update message rendering for user messages**

In the messages map, update to distinguish user messages. Inside the `conversation.messages.map((m) => ...)` block, before the existing reasoning section, add a conditional:

```tsx
            {conversation.messages.map((m) => (
              <div key={m.id} className="text-sm">
                {m.authorUserId ? (
                  // User message
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-medium" style={{ color: "var(--accent-deep)" }}>
                        You
                      </span>
                      <span className="text-xs" style={{ color: "var(--ink-faint)" }}>
                        {new Date(m.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <span style={{ color: "var(--ink)" }}>{m.content}</span>
                  </div>
                ) : (
                  // Character message (existing render)
                  <>
                    {m.reasoning !== null && (
                      <div className="mb-1.5">
                        <button
                          onClick={() => toggleReasoning(m.id)}
                          className="flex items-center gap-1 text-xs"
                          style={{ color: "var(--ink-faint)" }}
                        >
                          💭 {m.characterName}&apos;s thoughts
                          <span>{expandedReasonings.has(m.id) ? "▲" : "▼"}</span>
                        </button>
                        {expandedReasonings.has(m.id) && (
                          <p
                            className="mt-1 px-3 py-2 rounded-lg text-xs italic"
                            style={{
                              background: "var(--surface-sunk)",
                              border: "1px solid var(--hair)",
                              color: "var(--ink-mute)",
                            }}
                          >
                            {m.reasoning}
                          </p>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-medium" style={{ color: "var(--ink)" }}>
                        {m.characterName}
                      </span>
                      <EmotionDot
                        emotion={m.emotion}
                        intensity={m.intensity as "low" | "medium" | "high"}
                        subtext={m.subtext}
                        showLabel
                      />
                      <span className="text-xs" style={{ color: "var(--ink-faint)" }}>
                        {new Date(m.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <span style={{ color: "var(--ink-dim)" }}>{m.content}</span>
                  </>
                )}
              </div>
            ))}
```

- [ ] **Step 6: Update sidebar cast state for user participant**

In the sidebar `conversation.participants.map`, add handling for user participant (no emotion dot):

```tsx
            {conversation.participants.map((p) => {
              if (p.isUserParticipant) {
                return (
                  <div
                    key="user"
                    className="flex items-center gap-2 py-2"
                    style={{ borderTop: "1px solid var(--hair)" }}
                  >
                    <span
                      className="text-xs font-medium flex-1 truncate"
                      style={{ color: "var(--accent-deep)" }}
                    >
                      You
                    </span>
                  </div>
                );
              }
              const lastMsg = [...conversation.messages]
                .reverse()
                .find((m) => m.characterId === p.characterId);
              return (
                <div
                  key={p.characterId}
                  className="flex items-center gap-2 py-2"
                  style={{ borderTop: "1px solid var(--hair)" }}
                >
                  <span
                    className="text-xs font-medium flex-1 truncate"
                    style={{ color: "var(--ink)" }}
                  >
                    {p.name}
                  </span>
                  {lastMsg ? (
                    <EmotionDot
                      emotion={lastMsg.emotion}
                      intensity={lastMsg.intensity as "low" | "medium" | "high"}
                      subtext={`${lastMsg.emotion} · ${lastMsg.intensity}${lastMsg.subtext ? " · " + lastMsg.subtext : ""}`}
                    />
                  ) : (
                    <span
                      className="size-2 rounded-full"
                      style={{ background: "var(--hair-strong)" }}
                    />
                  )}
                </div>
              );
            })}
```

- [ ] **Step 7: Update footer to show user input when awaitingUserTurn**

In the footer section, replace the existing `!isRunning` block with:

```tsx
      {/* Footer — fixed controls */}
      <footer
        className="flex-shrink-0 px-8 py-4 flex flex-col gap-2"
        style={{ borderTop: "1px solid var(--hair)" }}
      >
        {nextSpeaker !== undefined && !isRunning && !awaitingUserTurn && (
          <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
            Next: {nextSpeaker.name}
          </p>
        )}
        {error !== null && (
          <p className="text-sm" style={{ color: "var(--signal-flag)" }}>
            {error}
          </p>
        )}
        {awaitingUserTurn ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs" style={{ color: "var(--ink-faint)" }}>Your turn</p>
            <textarea
              autoFocus
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleUserSend();
                }
              }}
              rows={3}
              placeholder="Type your message… (Enter to send, Shift+Enter for newline)"
              className="w-full px-3 py-2 rounded-lg text-sm resize-none"
              style={{
                border: "1px solid var(--hair-strong)",
                background: "var(--surface-1)",
                color: "var(--ink)",
              }}
            />
            <div className="flex gap-2">
              <button
                onClick={() => void handleUserSend()}
                disabled={!userInput.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{
                  background: "var(--accent)",
                  color: "var(--ink-on-accent)",
                  opacity: userInput.trim() ? 1 : 0.4,
                  cursor: userInput.trim() ? "pointer" : "not-allowed",
                }}
              >
                Send
              </button>
              <button
                onClick={() => void handleUserSkip()}
                className="px-4 py-2 rounded-lg text-sm"
                style={{ color: "var(--ink-mute)", background: "var(--surface-sunk)" }}
              >
                Skip my turn
              </button>
            </div>
          </div>
        ) : !isRunning ? (
          <div className="flex items-center gap-2">
            {/* existing Run N turns controls unchanged */}
```

Keep the existing run/stop controls exactly as they are after the `!isRunning` branch.

- [ ] **Step 8: Update nextSpeaker calculation for user participant**

The current `nextSpeaker` calc uses `sortedParticipants[conversation.messages.length % sortedParticipants.length]`. User participant has `isUserParticipant: true`. The `name` field is already `"You"` from the API, so no change needed here — the display already works.

- [ ] **Step 9: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 10: Commit**

```bash
git add frontend/app/conversations/[id]/page.tsx
git commit -m "feat: chat UI handles user turns — textarea, send, skip"
```

---

### Task 13: Final verification

- [ ] **Step 1: Run all tests**

```bash
bun test --cwd mcp_server
bun test --cwd packages/shared
bun test --cwd frontend
```

Expected: same pass rate as baseline (29/30 mcp_server — the 1 failure is pre-existing `DATABASE_URL` not set).

- [ ] **Step 2: Full typecheck**

```bash
bun run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Build**

```bash
bun run build
```

Expected: build succeeds, no type or lint errors.

- [ ] **Step 4: Final commit if any loose ends**

```bash
git status
```

If any modified files remain, commit them.
