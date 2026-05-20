# Private Reasoning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-call LLM flow to the conversation turn generator so each character message is preceded by a private reasoning step, saved to the DB and shown as a collapsible block in the UI.

**Architecture:** `generateNextTurnStream` changes its yield type from `string` to a tagged `TurnEvent` union. A non-streaming reasoning call is inserted before the streaming content call. The runner, stream route, and UI handle the new `thinking`/`thinking_done` events.

**Tech Stack:** TypeScript, Prisma 7, Next.js 16 App Router, Zod, LiteLLM (Anthropic SSE format), Tailwind CSS, React `useState`

---

## File Map

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `reasoning String?` to `Message` |
| `packages/shared/schema/conversation.ts` | Add `reasoning: z.string().nullable()` to `MessageRecordSchema` |
| `frontend/lib/conversation/next.ts` | Two-call flow; yield `TurnEvent` instead of `string` |
| `frontend/lib/jobs/runner.ts` | Handle `TurnEvent` union; emit `thinking`/`thinking_done` events; update `JobHandlers` |
| `frontend/app/api/conversations/[id]/jobs/[jobId]/stream/route.ts` | Forward `thinking`/`thinking_done` to SSE |
| `frontend/app/api/conversations/[id]/route.ts` | Include `reasoning` in `messages` response |
| `frontend/app/api/conversations/[id]/next/route.ts` | Include `reasoning` in single-turn response |
| `frontend/app/conversations/[id]/page.tsx` | Thinking indicator + collapsible reasoning block |

---

## Task 1: Prisma schema — add `reasoning` to `Message`

**Files:**
- Modify: `prisma/schema.prisma:74-86`

- [ ] **Step 1.1: Add the `reasoning` field**

In `prisma/schema.prisma`, replace the `Message` model with:

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

- [ ] **Step 1.2: Run migration**

```bash
bun run --cwd frontend prisma migrate dev --name add_message_reasoning
```

Expected: `✔ Your database is now in sync with your schema.`

- [ ] **Step 1.3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add reasoning column to messages table"
```

---

## Task 2: Shared types — add `reasoning` to `MessageRecordSchema`

**Files:**
- Modify: `packages/shared/schema/conversation.ts:21-29`

- [ ] **Step 2.1: Update the schema**

In `packages/shared/schema/conversation.ts`, replace `MessageRecordSchema`:

```typescript
export const MessageRecordSchema = z.object({
  id: uuidSchema,
  conversationId: uuidSchema,
  characterId: uuidSchema,
  characterName: z.string(),
  content: z.string(),
  reasoning: z.string().nullable(),
  createdAt: z.string(),
});
export type MessageRecord = z.infer<typeof MessageRecordSchema>;
```

- [ ] **Step 2.2: Type-check**

```bash
bun run typecheck
```

Expected: no errors. If errors appear about `reasoning` being missing, they point to the routes that need updating in Task 4 — note them and proceed; they will be fixed there.

- [ ] **Step 2.3: Commit**

```bash
git add packages/shared/schema/conversation.ts
git commit -m "feat: add reasoning field to MessageRecord schema"
```

---

## Task 3: Backend — two-call flow in `generateNextTurnStream`

**Files:**
- Modify: `frontend/lib/conversation/next.ts` (full rewrite of the function body)
- Modify: `frontend/lib/jobs/runner.ts:13-37,88-91`

- [ ] **Step 3.1: Replace `generateNextTurnStream` with the two-call version**

Replace the entire contents of `frontend/lib/conversation/next.ts` with:

```typescript
// frontend/lib/conversation/next.ts
import { prisma } from "@/lib/prisma";
import { selectNextSpeakerWithOrchestrator } from "@/lib/orchestrator";
import { buildCharacterPrompt } from "@/lib/prompts";
import { CharacterSearchResultSchema } from "@open-ormus/shared";

export class ConversationError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "NO_PARTICIPANTS" | "ENV_MISSING" | "LITELLM_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "ConversationError";
  }
}

export type TurnEvent =
  | { type: "token"; text: string }
  | { type: "thinking" }
  | { type: "thinking_done" };

type LiteLLMDelta = { type?: string; text?: string };
type LiteLLMEvent = { type: string; delta?: LiteLLMDelta };

// Yields TurnEvent items: thinking/thinking_done bracket the reasoning call,
// then token events stream the character's spoken message.
// Saves the completed message (content + reasoning) to DB before returning.
// Throws ConversationError on any failure — no message is saved on error.
export async function* generateNextTurnStream(
  conversationId: string,
  userId: string,
  signal?: AbortSignal,
): AsyncGenerator<TurnEvent> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    include: {
      participants: {
        include: { character: true },
        orderBy: { turnOrder: "asc" },
      },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { character: { select: { name: true } } },
      },
    },
  });

  if (!conversation) throw new ConversationError("NOT_FOUND", "Conversation not found");
  if (conversation.participants.length === 0) throw new ConversationError("NO_PARTICIPANTS", "No participants");

  const model = process.env["CONVERSATION_MODEL"];
  if (!model) throw new ConversationError("ENV_MISSING", "CONVERSATION_MODEL env var not set");

  let nextParticipant: (typeof conversation.participants)[number];

  if (conversation.participants.length >= 3) {
    const characterId = await selectNextSpeakerWithOrchestrator(
      conversation.participants,
      conversation.messages,
    );
    const found = conversation.participants.find((p) => p.characterId === characterId);
    if (!found) {
      console.error(
        `[generateNextTurnStream] orchestrator returned unknown characterId "${characterId}" — falling back to round-robin`,
      );
    }
    nextParticipant =
      found ??
      conversation.participants[
        conversation.messages.length % conversation.participants.length
      ]!;
  } else {
    nextParticipant =
      conversation.participants[
        conversation.messages.length % conversation.participants.length
      ]!;
  }

  const sheet = CharacterSearchResultSchema.parse(nextParticipant.character.sheet);
  const systemPrompt = buildCharacterPrompt(sheet, conversation.context);

  const historyText =
    conversation.messages.length > 0
      ? conversation.messages.map((m) => `[${m.character.name}]: ${m.content}`).join("\n")
      : "(The scene has just begun — no lines have been spoken yet.)";

  const baseUrl = process.env["ANTHROPIC_BASE_URL"] ?? "http://localhost:4000";
  const apiKey = process.env["ANTHROPIC_API_KEY"] ?? "";

  // ── Call 1: reasoning (non-streaming) ──────────────────────────────────────
  yield { type: "thinking" };

  const reasoningResponse = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    signal: signal ?? null,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 256,
      stream: false,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Conversation so far:\n${historyText}\n\nBefore responding, write your private inner thoughts as ${nextParticipant.character.name}. What are you feeling, noticing, planning to say? First person. Be brief. This is never shown to other characters.`,
        },
      ],
    }),
  });

  if (!reasoningResponse.ok) {
    const text = await reasoningResponse.text();
    throw new ConversationError("LITELLM_ERROR", `LiteLLM reasoning error: ${text}`);
  }

  const reasoningCompletion = (await reasoningResponse.json()) as {
    content?: { type: string; text: string }[];
  };
  const reasoning = reasoningCompletion.content?.find((b) => b.type === "text")?.text ?? "";

  yield { type: "thinking_done" };

  // ── Call 2: content (streaming) ─────────────────────────────────────────────
  const contentUserMessage = reasoning
    ? `Your private thoughts:\n${reasoning}\n\nConversation so far:\n${historyText}\n\nNow continue as ${nextParticipant.character.name}. Write only their next line.`
    : `Conversation so far:\n${historyText}\n\nNow continue as ${nextParticipant.character.name}. Write only their next line.`;

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    signal: signal ?? null,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Accept": "text/event-stream",
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      stream: true,
      system: systemPrompt,
      messages: [{ role: "user", content: contentUserMessage }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ConversationError("LITELLM_ERROR", `LiteLLM error: ${text}`);
  }

  let content = "";
  const contentType = response.headers.get("content-type") ?? "";
  console.log(`[generateNextTurnStream] content-type: "${contentType}"`);

  if (!contentType.includes("text/event-stream")) {
    console.log("[generateNextTurnStream] path: JSON (no streaming from LiteLLM)");
    const completion = (await response.json()) as {
      content?: { type: string; text: string }[];
    };
    content = completion.content?.find((b) => b.type === "text")?.text ?? "";
    if (content) yield { type: "token", text: content };
  } else {
    console.log("[generateNextTurnStream] path: SSE streaming");
    if (!response.body) throw new ConversationError("LITELLM_ERROR", "LiteLLM response body is null");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        if (typeof parsed !== "object" || parsed === null) continue;

        const obj = parsed as Record<string, unknown>;

        if (obj["type"] === "content_block_delta") {
          const event = parsed as LiteLLMEvent;
          if (event.delta?.type === "text_delta" && typeof event.delta.text === "string") {
            content += event.delta.text;
            yield { type: "token", text: event.delta.text };
          }
        } else {
          const choices = obj["choices"] as Array<{ delta?: { content?: string } }> | undefined;
          const token = choices?.[0]?.delta?.content;
          if (typeof token === "string" && token) {
            content += token;
            yield { type: "token", text: token };
          }
        }
      }
    }
  }

  if (!content) {
    console.error(`[generateNextTurnStream] empty content from LiteLLM (content-type: ${contentType})`);
  }

  await prisma.message.create({
    data: {
      conversationId,
      characterId: nextParticipant.characterId,
      content,
      reasoning: reasoning || null,
    },
  });
}
```

- [ ] **Step 3.2: Update `JobHandlers` and `subscribeToJob` in `runner.ts`**

In `frontend/lib/jobs/runner.ts`, replace the `JobHandlers` interface and `subscribeToJob` function:

```typescript
export interface JobHandlers {
  onToken: (text: string) => void;
  onTurnDone: (doneTurns: number, totalTurns: number) => void;
  onDone: () => void;
  onError: (message: string) => void;
  onThinking?: () => void;
  onThinkingDone?: () => void;
}

export function subscribeToJob(jobId: string, handlers: JobHandlers): () => void {
  const onToken = (text: string) => handlers.onToken(text);
  const onTurnDone = (done: number, total: number) => handlers.onTurnDone(done, total);
  const onDone = () => handlers.onDone();
  const onError = (msg: string) => handlers.onError(msg);
  const onThinking = () => handlers.onThinking?.();
  const onThinkingDone = () => handlers.onThinkingDone?.();

  emitter.on(`${jobId}:token`, onToken);
  emitter.on(`${jobId}:turn_done`, onTurnDone);
  emitter.once(`${jobId}:done`, onDone);
  emitter.once(`${jobId}:error`, onError);
  emitter.on(`${jobId}:thinking`, onThinking);
  emitter.on(`${jobId}:thinking_done`, onThinkingDone);

  return () => {
    emitter.off(`${jobId}:token`, onToken);
    emitter.off(`${jobId}:turn_done`, onTurnDone);
    emitter.off(`${jobId}:thinking`, onThinking);
    emitter.off(`${jobId}:thinking_done`, onThinkingDone);
  };
}
```

- [ ] **Step 3.3: Update `runTurns` to handle `TurnEvent` in `runner.ts`**

In `frontend/lib/jobs/runner.ts`, replace the inner `for await` loop in `runTurns` (lines 88-91) with:

```typescript
      try {
        for await (const event of generateNextTurnStream(conversationId, userId, ac.signal)) {
          if (event.type === "token") {
            emitter.emit(`${jobId}:token`, event.text);
          } else if (event.type === "thinking") {
            emitter.emit(`${jobId}:thinking`);
          } else if (event.type === "thinking_done") {
            emitter.emit(`${jobId}:thinking_done`);
          }
          await new Promise<void>((r) => setTimeout(r, 0));
        }
      } catch (err) {
```

- [ ] **Step 3.4: Type-check**

```bash
bun run typecheck
```

Expected: no errors (aside from the routes not yet returning `reasoning` — those are in Task 4).

- [ ] **Step 3.5: Commit**

```bash
git add frontend/lib/conversation/next.ts frontend/lib/jobs/runner.ts
git commit -m "feat: add two-call reasoning flow to generateNextTurnStream"
```

---

## Task 4: API routes — forward thinking chunks + include `reasoning` in responses

**Files:**
- Modify: `frontend/app/api/conversations/[id]/jobs/[jobId]/stream/route.ts:51-68`
- Modify: `frontend/app/api/conversations/[id]/route.ts` (messages map)
- Modify: `frontend/app/api/conversations/[id]/next/route.ts` (response JSON)

- [ ] **Step 4.1: Add `onThinking`/`onThinkingDone` to the job stream subscriber**

In `frontend/app/api/conversations/[id]/jobs/[jobId]/stream/route.ts`, replace the `subscribeToJob` call:

```typescript
      const unsub = subscribeToJob(jobId, {
        onToken: (text) => {
          if (!closed) controller.enqueue(encode({ type: "token", text }));
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
      });
```

- [ ] **Step 4.2: Include `reasoning` in the conversation detail response**

In `frontend/app/api/conversations/[id]/route.ts`, replace the messages mapping in the GET handler:

```typescript
    messages: conversation.messages.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      characterId: m.characterId,
      characterName: m.character.name,
      content: m.content,
      reasoning: m.reasoning ?? null,
      createdAt: m.createdAt.toISOString(),
    })),
```

- [ ] **Step 4.3: Include `reasoning` in the single-turn response**

In `frontend/app/api/conversations/[id]/next/route.ts`, replace the `return NextResponse.json(...)` at the end:

```typescript
  return NextResponse.json(
    {
      id: message.id,
      conversationId: message.conversationId,
      characterId: message.characterId,
      characterName: message.character.name,
      content: message.content,
      reasoning: message.reasoning ?? null,
      createdAt: message.createdAt.toISOString(),
    },
    { status: 201 },
  );
```

- [ ] **Step 4.4: Type-check**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 4.5: Commit**

```bash
git add frontend/app/api/conversations/[id]/jobs/[jobId]/stream/route.ts \
        frontend/app/api/conversations/[id]/route.ts \
        frontend/app/api/conversations/[id]/next/route.ts
git commit -m "feat: forward thinking chunks and reasoning field through API routes"
```

---

## Task 5: Frontend UI — thinking indicator + collapsible reasoning block

**Files:**
- Modify: `frontend/app/conversations/[id]/page.tsx`

- [ ] **Step 5.1: Update the `Message` type**

In `frontend/app/conversations/[id]/page.tsx`, replace the `Message` type (lines 9-14):

```typescript
type Message = {
  id: string;
  characterName: string;
  content: string;
  reasoning: string | null;
  createdAt: string;
};
```

- [ ] **Step 5.2: Add `isThinking` and `expandedReasonings` state**

After the existing `useState` declarations (after line 38), add:

```typescript
  const [isThinking, setIsThinking] = useState(false);
  const [expandedReasonings, setExpandedReasonings] = useState<Set<string>>(new Set());
```

Add the toggle helper just before `loadConversation`:

```typescript
  function toggleReasoning(id: string) {
    setExpandedReasonings((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
```

- [ ] **Step 5.3: Handle `thinking`/`thinking_done` in the SSE message handler**

In `es.onmessage` (inside `connectToJob`), add handling after the `"error"` branch:

```typescript
      } else if (data.type === "thinking") {
        setIsThinking(true);
      } else if (data.type === "thinking_done") {
        setIsThinking(false);
      }
```

Also clear `isThinking` in all terminal branches. In the `"done"` branch add `setIsThinking(false);`, in the `"error"` branch add `setIsThinking(false);`, and in `es.onerror` add `setIsThinking(false);`.

- [ ] **Step 5.4: Render the thinking indicator**

In the JSX, just before the `{streamingBuffer && ...}` block (line 201), add:

```tsx
        {isThinking && (
          <div className="text-sm text-zinc-400 italic">
            💭 {nextSpeaker?.name ?? "..."} sta pensando…
          </div>
        )}
```

- [ ] **Step 5.5: Render the collapsible reasoning block in each message**

Replace the `conversation.messages.map(...)` block (lines 191-199) with:

```tsx
          conversation.messages.map((m) => (
            <div key={m.id} className="text-sm">
              {m.reasoning !== null && (
                <div className="mb-1">
                  <button
                    onClick={() => toggleReasoning(m.id)}
                    className="text-xs text-zinc-400 hover:text-zinc-600 flex items-center gap-1"
                  >
                    💭 Pensieri di {m.characterName}
                    <span>{expandedReasonings.has(m.id) ? "▲" : "▼"}</span>
                  </button>
                  {expandedReasonings.has(m.id) && (
                    <p className="mt-1 px-3 py-2 bg-zinc-50 border border-zinc-200 rounded text-xs text-zinc-500 italic">
                      {m.reasoning}
                    </p>
                  )}
                </div>
              )}
              <span className="font-medium">{m.characterName}:</span>{" "}
              <span className="text-zinc-700">{m.content}</span>
              <span className="text-xs text-zinc-400 ml-2">
                {new Date(m.createdAt).toLocaleTimeString()}
              </span>
            </div>
          ))
```

- [ ] **Step 5.6: Type-check**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 5.7: Commit**

```bash
git add frontend/app/conversations/\[id\]/page.tsx
git commit -m "feat: add thinking indicator and collapsible reasoning block to conversation UI"
```

---

## Task 6: Final verification

- [ ] **Step 6.1: Full type-check**

```bash
bun run typecheck
```

Expected: exit 0, no errors.

- [ ] **Step 6.2: Build**

```bash
bun run build
```

Expected: build completes with no errors.

- [ ] **Step 6.3: Prisma client regenerate (confirm schema in sync)**

```bash
bun run prisma:generate
```

Expected: `✔ Generated Prisma Client` with no warnings.
