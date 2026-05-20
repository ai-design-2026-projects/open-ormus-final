# Emotion Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured emotion output (emotion, intensity, subtext) to every character message in roleplay conversations, rendered in the UI and fed back into subsequent prompts.

**Architecture:** The LLM outputs `<emotion>...</emotion><dialogue>...</dialogue>` XML blocks; a two-phase stream parser buffers the emotion block silently then streams the dialogue live; emotion is saved to `Message` and injected into the next character's conversation history.

**Tech Stack:** Prisma 7, Zod 4, Next.js App Router, Bun test, SSE via ReadableStream, `@open-ormus/shared` for shared schemas.

**Spec:** `docs/superpowers/specs/2026-05-19-emotion-output-design.md`

---

## File Map

| File | Action | What it does |
|---|---|---|
| `prisma/schema.prisma` | Modify | Add `emotion`, `intensity`, `subtext` to `Message` |
| `packages/shared/schema/emotion.ts` | Create | `EmotionSchema`, `Emotion` type, `parseEmotionBlock()` |
| `packages/shared/schema/emotion.test.ts` | Create | Schema + parser tests |
| `packages/shared/schema/conversation.ts` | Modify | Add emotion fields to `MessageRecordSchema` |
| `packages/shared/schema/conversation.test.ts` | Modify | Update `MessageRecordSchema` test to include emotion fields |
| `packages/shared/index.ts` | Modify | Export `EmotionSchema`, `Emotion`, `parseEmotionBlock` |
| `frontend/lib/prompts/character-roleplay.hbs` | Modify | Add XML format instruction block |
| `frontend/lib/conversation/parse-turn.ts` | Create | `buildHistoryLine()` pure utility |
| `frontend/lib/conversation/next.ts` | Modify | Two-phase stream parser, history formatting, save emotion |
| `frontend/lib/jobs/runner.ts` | Modify | Pass `onEmotion` callback, emit `emotion` events |
| `frontend/app/api/conversations/[id]/jobs/[jobId]/stream/route.ts` | Modify | Emit `emotion` SSE event |
| `frontend/app/api/conversations/[id]/route.ts` | Modify | Include emotion fields in message response |
| `frontend/components/ui/emotion-dot.tsx` | Create | Reusable dot + tooltip component |
| `frontend/app/conversations/[id]/page.tsx` | Modify | Render emotion dots, cast state, streaming emotion |

---

## Task 1: Prisma schema — add emotion fields to Message

**Files:**
- Modify: `prisma/schema.prisma:74-86`

- [ ] **Step 1: Edit schema.prisma**

Replace the `Message` model:

```prisma
model Message {
  id             String   @id @default(uuid()) @db.Uuid
  conversationId String   @db.Uuid @map("conversation_id")
  characterId    String   @db.Uuid @map("character_id")
  content        String
  emotion        String   @default("Joy")
  intensity      String   @default("low")
  subtext        String   @default("")
  createdAt      DateTime @default(now()) @map("created_at")

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  character    Character    @relation(fields: [characterId], references: [id], onDelete: Restrict)

  @@index([conversationId])
  @@map("messages")
}
```

- [ ] **Step 2: Run migration**

```bash
bun run prisma:migrate:dev -- --name add_message_emotion
```

Expected: new migration file created in `prisma/migrations/`, `✔ Your database is now in sync`.

- [ ] **Step 3: Regenerate Prisma client**

```bash
bun run prisma:generate
```

Expected: `Generated Prisma Client`.

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add emotion fields to Message schema"
```

---

## Task 2: EmotionSchema in packages/shared

**Files:**
- Create: `packages/shared/schema/emotion.ts`
- Create: `packages/shared/schema/emotion.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/shared/schema/emotion.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { EmotionSchema, parseEmotionBlock } from "./emotion";

describe("EmotionSchema", () => {
  test("accepts valid emotion", () => {
    const result = EmotionSchema.safeParse({
      emotion: "Fear",
      intensity: "high",
      subtext: "Trying not to show weakness",
    });
    expect(result.success).toBe(true);
  });

  test("rejects unknown emotion value", () => {
    const result = EmotionSchema.safeParse({
      emotion: "Neutral",
      intensity: "low",
      subtext: "",
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid intensity", () => {
    const result = EmotionSchema.safeParse({
      emotion: "Joy",
      intensity: "rising",
      subtext: "",
    });
    expect(result.success).toBe(false);
  });

  test("rejects subtext longer than 120 chars", () => {
    const result = EmotionSchema.safeParse({
      emotion: "Joy",
      intensity: "low",
      subtext: "x".repeat(121),
    });
    expect(result.success).toBe(false);
  });
});

describe("parseEmotionBlock", () => {
  test("extracts emotion from valid XML block", () => {
    const text = `<emotion>{"emotion":"Fear","intensity":"high","subtext":"Hiding something"}</emotion>`;
    const result = parseEmotionBlock(text);
    expect(result).toEqual({ emotion: "Fear", intensity: "high", subtext: "Hiding something" });
  });

  test("returns null for missing emotion block", () => {
    expect(parseEmotionBlock("Just some text.")).toBeNull();
  });

  test("returns null for malformed JSON inside block", () => {
    expect(parseEmotionBlock("<emotion>{bad json}</emotion>")).toBeNull();
  });

  test("returns null if emotion value is invalid", () => {
    const text = `<emotion>{"emotion":"Neutral","intensity":"low","subtext":""}</emotion>`;
    expect(parseEmotionBlock(text)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
bun test --cwd packages/shared schema/emotion.test.ts
```

Expected: FAIL — `emotion.ts` does not exist yet.

- [ ] **Step 3: Create packages/shared/schema/emotion.ts**

```typescript
import { z } from "zod";

export const EmotionSchema = z.object({
  emotion: z.enum([
    "Joy", "Trust", "Fear", "Surprise",
    "Sadness", "Disgust", "Anger", "Anticipation",
  ]),
  intensity: z.enum(["low", "medium", "high"]),
  subtext: z.string().max(120),
});
export type Emotion = z.infer<typeof EmotionSchema>;

export function parseEmotionBlock(text: string): Emotion | null {
  const match = text.match(/<emotion>([\s\S]*?)<\/emotion>/);
  if (!match?.[1]) return null;
  try {
    return EmotionSchema.parse(JSON.parse(match[1]));
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
bun test --cwd packages/shared schema/emotion.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/schema/emotion.ts packages/shared/schema/emotion.test.ts
git commit -m "feat: add EmotionSchema and parseEmotionBlock to shared"
```

---

## Task 3: Export EmotionSchema from packages/shared + update MessageRecordSchema

**Files:**
- Modify: `packages/shared/index.ts`
- Modify: `packages/shared/schema/conversation.ts:21-29`
- Modify: `packages/shared/schema/conversation.test.ts:59-71`

- [ ] **Step 1: Add export to packages/shared/index.ts**

Add after the conversation export block at the bottom of `packages/shared/index.ts`:

```typescript
export {
  EmotionSchema,
  type Emotion,
  parseEmotionBlock,
} from "./schema/emotion";
```

- [ ] **Step 2: Update MessageRecordSchema in conversation.ts**

Replace `MessageRecordSchema`:

```typescript
export const MessageRecordSchema = z.object({
  id: uuidSchema,
  conversationId: uuidSchema,
  characterId: uuidSchema,
  characterName: z.string(),
  content: z.string(),
  emotion: z.string(),
  intensity: z.string(),
  subtext: z.string(),
  createdAt: z.string(),
});
export type MessageRecord = z.infer<typeof MessageRecordSchema>;
```

> Note: `emotion`, `intensity`, `subtext` are `z.string()` here (not the enum) because `MessageRecord` is used to parse API responses — loose is fine, validation happens at the LLM boundary.

- [ ] **Step 3: Update the existing MessageRecordSchema test in conversation.test.ts**

Replace the `MessageRecordSchema` describe block:

```typescript
describe("MessageRecordSchema", () => {
  test("accepts valid message record with emotion fields", () => {
    const result = MessageRecordSchema.safeParse({
      id: "11111111-1111-1111-1111-111111111111",
      conversationId: "22222222-2222-2222-2222-222222222222",
      characterId: "33333333-3333-3333-3333-333333333333",
      characterName: "Alice",
      content: "Hello there.",
      emotion: "Fear",
      intensity: "high",
      subtext: "Hiding something",
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 4: Run all shared tests**

```bash
bun test --cwd packages/shared
```

Expected: all tests pass.

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/index.ts packages/shared/schema/conversation.ts packages/shared/schema/conversation.test.ts
git commit -m "feat: export EmotionSchema, add emotion fields to MessageRecordSchema"
```

---

## Task 4: Update character prompt template

**Files:**
- Modify: `frontend/lib/prompts/character-roleplay.hbs:43-50`

- [ ] **Step 1: Replace the Instructions section**

In `character-roleplay.hbs`, replace the entire `## Instructions` section and `## Scene` section with:

```handlebars
## Output Format

Always respond in this exact structure — no exceptions, no preamble:

<emotion>{"emotion":"[EMOTION]","intensity":"[INTENSITY]","subtext":"[SUBTEXT]"}</emotion>
<dialogue>Your next line of dialogue or action</dialogue>

Where:
- [EMOTION]: one of Joy | Trust | Fear | Surprise | Sadness | Disgust | Anger | Anticipation
- [INTENSITY]: low | medium | high
- [SUBTEXT]: one sentence — what {{name}} truly feels beneath the surface, in their internal voice

Feel first, then speak. The emotion block grounds the dialogue.

Example:
<emotion>{"emotion":"Fear","intensity":"high","subtext":"Trying not to show weakness in front of the others"}</emotion>
<dialogue>I don't think we should go in there.</dialogue>

## Instructions
- No name prefix. No narrator voice. No meta-commentary.
- You may include brief physical action descriptions in *italics* inside `<dialogue>` (e.g. *crosses arms slowly*). Actions must be consistent with {{name}}'s physical build and abilities.
- Let psychology drive subtext: what {{name}} says and what {{name}} means may differ.
- Maintain continuity with the conversation history above.

## Scene
{{sceneContext}}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/lib/prompts/character-roleplay.hbs
git commit -m "feat: add XML emotion format instruction to character prompt"
```

---

## Task 5: Create buildHistoryLine utility

**Files:**
- Create: `frontend/lib/conversation/parse-turn.ts`

- [ ] **Step 1: Create parse-turn.ts**

```typescript
// Pure utility for formatting conversation history lines with emotion context.
export function buildHistoryLine(
  name: string,
  content: string,
  emotion: string,
  intensity: string,
  subtext: string,
): string {
  const emotionTag = subtext
    ? `${emotion}: ${intensity} | ${subtext}`
    : `${emotion}: ${intensity}`;
  return `[${name} — ${emotionTag}] "${content}"`;
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/conversation/parse-turn.ts
git commit -m "feat: add buildHistoryLine utility for emotion-annotated history"
```

---

## Task 6: Update generateNextTurnStream — two-phase parser

**Files:**
- Modify: `frontend/lib/conversation/next.ts`

This is the core task. The generator gains an `onEmotion` callback, formats history with emotion annotations, and implements the two-phase stream parser.

- [ ] **Step 1: Update imports at the top of next.ts**

```typescript
import { prisma } from "@/lib/prisma";
import { selectNextSpeakerWithOrchestrator } from "@/lib/orchestrator";
import { buildCharacterPrompt } from "@/lib/prompts";
import { CharacterSearchResultSchema, parseEmotionBlock, type Emotion } from "@open-ormus/shared";
import { buildHistoryLine } from "./parse-turn";
```

- [ ] **Step 2: Update the function signature**

```typescript
export async function* generateNextTurnStream(
  conversationId: string,
  userId: string,
  signal?: AbortSignal,
  onEmotion?: (emotion: Emotion) => void,
): AsyncGenerator<string> {
```

- [ ] **Step 3: Update historyText to use emotion-annotated format**

Replace the `historyText` declaration (currently around line 77):

```typescript
const historyText =
  conversation.messages.length > 0
    ? conversation.messages
        .map((m) =>
          buildHistoryLine(
            m.character.name,
            m.content,
            m.emotion,
            m.intensity,
            m.subtext,
          ),
        )
        .join("\n")
    : "(The scene has just begun — no lines have been spoken yet.)";
```

> Note: The Prisma query already includes `messages` with `character: { select: { name: true } }`. The new fields `emotion`, `intensity`, `subtext` are now on `Message` directly — Prisma returns them automatically.

- [ ] **Step 4: Add the fallback emotion constant after the function signature opening**

Add after the `ConversationError` class definition at the top of the file:

```typescript
const FALLBACK_EMOTION: Emotion = { emotion: "Joy", intensity: "low", subtext: "" };
```

- [ ] **Step 5: Replace the non-streaming JSON path**

Replace the non-streaming block (currently around lines 117-122):

```typescript
if (!contentType.includes("text/event-stream")) {
  console.log("[generateNextTurnStream] path: JSON (no streaming from LiteLLM)");
  const completion = (await response.json()) as {
    content?: { type: string; text: string }[];
  };
  const rawContent = completion.content?.find((b) => b.type === "text")?.text ?? "";
  const parsedEmotion = parseEmotionBlock(rawContent);
  onEmotion?.(parsedEmotion ?? FALLBACK_EMOTION);
  const dialogueMatch = rawContent.match(/<dialogue>([\s\S]*?)<\/dialogue>/);
  content = dialogueMatch?.[1]?.trim() ?? rawContent;
  if (content) yield content;
}
```

- [ ] **Step 6: Replace the SSE streaming path with the two-phase parser**

Replace the entire `else { ... }` streaming block (currently lines 122-170):

```typescript
} else {
  console.log("[generateNextTurnStream] path: SSE streaming");
  if (!response.body) throw new ConversationError("LITELLM_ERROR", "LiteLLM response body is null");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // Two-phase parser state
  let rawBuffer = "";
  let parserState: "buffering" | "awaiting_open" | "dialogue" = "buffering";
  let parsedEmotion: Emotion | null = null;

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
      try { parsed = JSON.parse(data); } catch { continue; }
      if (typeof parsed !== "object" || parsed === null) continue;

      const obj = parsed as Record<string, unknown>;
      let token: string | undefined;

      if (obj["type"] === "content_block_delta") {
        const event = parsed as LiteLLMEvent;
        if (event.delta?.type === "text_delta" && typeof event.delta.text === "string") {
          token = event.delta.text;
        }
      } else {
        const choices = obj["choices"] as Array<{ delta?: { content?: string } }> | undefined;
        const t = choices?.[0]?.delta?.content;
        if (typeof t === "string" && t) token = t;
      }

      if (!token) continue;
      rawBuffer += token;

      if (parserState === "buffering") {
        const emotionEndIdx = rawBuffer.indexOf("</emotion>");
        if (emotionEndIdx !== -1) {
          parsedEmotion = parseEmotionBlock(rawBuffer.slice(0, emotionEndIdx + 10));
          onEmotion?.(parsedEmotion ?? FALLBACK_EMOTION);
          // Check if <dialogue> already arrived in the same chunk
          const rest = rawBuffer.slice(emotionEndIdx + 10);
          const dialogueOpenIdx = rest.indexOf("<dialogue>");
          if (dialogueOpenIdx !== -1) {
            parserState = "dialogue";
            const initial = rest.slice(dialogueOpenIdx + 10);
            if (initial) { content += initial; yield initial; }
          } else {
            parserState = "awaiting_open";
          }
        } else if (rawBuffer.length > 200) {
          // Fallback: emotion block never appeared
          onEmotion?.(FALLBACK_EMOTION);
          parserState = "dialogue";
          content += rawBuffer;
          yield rawBuffer;
        }
      } else if (parserState === "awaiting_open") {
        const dialogueOpenIdx = rawBuffer.indexOf("<dialogue>");
        if (dialogueOpenIdx !== -1) {
          parserState = "dialogue";
          const initial = rawBuffer.slice(dialogueOpenIdx + 10);
          if (initial) { content += initial; yield initial; }
        }
      } else if (parserState === "dialogue") {
        content += token;
        yield token;
      }
    }
  }

  if (parsedEmotion === null) onEmotion?.(FALLBACK_EMOTION);
}
```

- [ ] **Step 7: Declare parsedEmotion at outer scope, strip tag, save to DB**

The non-streaming path (Step 5) and streaming path (Step 6) both resolve `parsedEmotion`. Declare it **once**, before the `if (!contentType.includes("text/event-stream"))` branch so both paths write to the same variable.

Add this line just before the `if (!contentType.includes("text/event-stream"))` check:

```typescript
let parsedEmotion: Emotion | null = null;
```

Then in the non-streaming path (Step 5), change `const parsedEmotion =` to `parsedEmotion =` (assignment, not declaration).

In the streaming path (Step 6), the `let parsedEmotion` is already inside the `else` block — remove that inner declaration too (it now uses the outer one).

After both branches complete, add the final save:

```typescript
// Strip </dialogue> closing tag that may have been streamed into content
content = content.replace(/<\/dialogue>[\s\S]*$/, "").trim();

if (!content) {
  console.error(`[generateNextTurnStream] empty content from LiteLLM (content-type: ${contentType})`);
}

const emotionToSave = parsedEmotion ?? FALLBACK_EMOTION;

await prisma.message.create({
  data: {
    conversationId,
    characterId: nextParticipant.characterId,
    content,
    emotion: emotionToSave.emotion,
    intensity: emotionToSave.intensity,
    subtext: emotionToSave.subtext,
  },
});
```

- [ ] **Step 8: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add frontend/lib/conversation/next.ts
git commit -m "feat: add two-phase emotion parser to generateNextTurnStream"
```

---

## Task 7: Update runner + stream route to emit emotion events

**Files:**
- Modify: `frontend/lib/jobs/runner.ts`
- Modify: `frontend/app/api/conversations/[id]/jobs/[jobId]/stream/route.ts`

- [ ] **Step 1: Add onEmotion to JobHandlers in runner.ts**

Replace the `JobHandlers` interface:

```typescript
export interface JobHandlers {
  onToken: (text: string) => void;
  onEmotion: (emotion: { emotion: string; intensity: string; subtext: string }) => void;
  onTurnDone: (doneTurns: number, totalTurns: number) => void;
  onDone: () => void;
  onError: (message: string) => void;
}
```

- [ ] **Step 2: Add emotion listener in subscribeToJob**

In `subscribeToJob`, add after the `onToken` line:

```typescript
const onEmotion = (e: { emotion: string; intensity: string; subtext: string }) =>
  handlers.onEmotion(e);
emitter.on(`${jobId}:emotion`, onEmotion);
```

And in the returned unsubscribe function, add:

```typescript
emitter.off(`${jobId}:emotion`, onEmotion);
```

- [ ] **Step 3: Pass onEmotion callback in runTurns**

Replace the `for await` loop in `runTurns`:

```typescript
for await (const token of generateNextTurnStream(
  conversationId,
  userId,
  ac.signal,
  (emotion) => emitter.emit(`${jobId}:emotion`, emotion),
)) {
  emitter.emit(`${jobId}:token`, token);
  await new Promise<void>((r) => setTimeout(r, 0));
}
```

- [ ] **Step 4: Update stream route to handle emotion event**

In `frontend/app/api/conversations/[id]/jobs/[jobId]/stream/route.ts`, update the `subscribeToJob` call:

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
});
```

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/jobs/runner.ts frontend/app/api/conversations/[id]/jobs/[jobId]/stream/route.ts
git commit -m "feat: emit emotion SSE event from job stream"
```

---

## Task 8: Update conversation GET route to include emotion fields

**Files:**
- Modify: `frontend/app/api/conversations/[id]/route.ts:45-55`

- [ ] **Step 1: Add emotion fields to message mapping**

In the `GET` handler, replace the messages map:

```typescript
messages: conversation.messages.map((m) => ({
  id: m.id,
  conversationId: m.conversationId,
  characterId: m.characterId,
  characterName: m.character.name,
  content: m.content,
  emotion: m.emotion,
  intensity: m.intensity,
  subtext: m.subtext,
  createdAt: m.createdAt.toISOString(),
})),
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/api/conversations/[id]/route.ts
git commit -m "feat: include emotion fields in conversation GET response"
```

---

## Task 9: Create EmotionDot component

**Files:**
- Create: `frontend/components/ui/emotion-dot.tsx`

- [ ] **Step 1: Create the component**

```typescript
const EMOTION_COLOR: Record<string, string> = {
  Joy: "var(--signal-warn)",
  Trust: "var(--signal-ok)",
  Fear: "var(--ink-dim)",
  Surprise: "var(--accent-bright)",
  Sadness: "var(--accent-deep)",
  Disgust: "var(--signal-flag)",
  Anger: "var(--signal-flag)",
  Anticipation: "var(--accent-oo)",
};

interface EmotionDotProps {
  emotion: string;
  intensity: "low" | "medium" | "high";
  subtext?: string;
}

export function EmotionDot({ emotion, intensity, subtext }: EmotionDotProps) {
  const color = EMOTION_COLOR[emotion] ?? "var(--ink-mute)";
  const sizeClass = intensity === "low" ? "size-2 opacity-60" : "size-3";
  const ringClass = intensity === "high" ? "shadow-glow animate-pulse" : "";

  return (
    <span
      title={subtext}
      className={`rounded-full inline-block shrink-0 ${sizeClass} ${ringClass}`}
      style={{ background: color }}
    />
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/ui/emotion-dot.tsx
git commit -m "feat: add EmotionDot UI component"
```

---

## Task 10: Wire conversation page — emotion dots, streaming emotion, cast state

**Files:**
- Modify: `frontend/app/conversations/[id]/page.tsx`

- [ ] **Step 1: Update Message type and add streaming emotion state**

At the top of the file, update the `Message` type and add `streamingEmotion` state:

```typescript
type Message = {
  id: string;
  characterId: string;
  characterName: string;
  content: string;
  emotion: string;
  intensity: string;
  subtext: string;
  createdAt: string;
};

type StreamingEmotion = { emotion: string; intensity: string; subtext: string };
```

Inside `ConversationPage`, add after `streamingBuffer` state:

```typescript
const [streamingEmotion, setStreamingEmotion] = useState<StreamingEmotion | null>(null);
```

- [ ] **Step 2: Handle emotion SSE event in connectToJob**

In the `es.onmessage` handler, add before the `if (data.type === "token")` check:

```typescript
if (data.type === "emotion") {
  setStreamingEmotion({
    emotion: data.emotion as string,
    intensity: data.intensity as string,
    subtext: data.subtext as string,
  });
}
```

Also reset `streamingEmotion` to `null` wherever `streamingBuffer` is reset to `""`:
- In the `turn_done` handler: `setStreamingEmotion(null);`
- In the `done` handler: `setStreamingEmotion(null);`
- In the `error` handler: `setStreamingEmotion(null);`
- In `es.onerror`: `setStreamingEmotion(null);`
- In `handleStop`: `setStreamingEmotion(null);`

- [ ] **Step 3: Add EmotionDot import**

```typescript
import { EmotionDot } from "@/components/ui/emotion-dot";
```

- [ ] **Step 4: Render emotion dot on each message**

Replace the message rendering block:

```tsx
conversation.messages.map((m) => (
  <div key={m.id} className="text-sm">
    <div className="flex items-center gap-2">
      <span className="font-medium">{m.characterName}</span>
      <EmotionDot
        emotion={m.emotion}
        intensity={m.intensity as "low" | "medium" | "high"}
        subtext={m.subtext}
      />
      <span className="text-xs text-zinc-400">
        {new Date(m.createdAt).toLocaleTimeString()}
      </span>
    </div>
    <span className="text-zinc-700">{m.content}</span>
  </div>
))
```

- [ ] **Step 5: Show streaming emotion dot during generation**

Replace the `streamingBuffer` render block:

```tsx
{streamingBuffer && (
  <div className="text-sm">
    <div className="flex items-center gap-2">
      <span className="font-medium text-zinc-400">{nextSpeaker?.name ?? "..."}</span>
      {streamingEmotion && (
        <EmotionDot
          emotion={streamingEmotion.emotion}
          intensity={streamingEmotion.intensity as "low" | "medium" | "high"}
          subtext={streamingEmotion.subtext}
        />
      )}
    </div>
    <span className="text-zinc-500">{streamingBuffer}</span>
    <span className="animate-pulse">▋</span>
  </div>
)}
```

- [ ] **Step 6: Add cast state panel**

Below the messages block and above the controls, add:

```tsx
{conversation.participants.length > 0 && (
  <div className="mb-6 border border-zinc-200 rounded-lg p-3 max-w-xs">
    <p className="text-xs font-medium text-zinc-400 mb-2">CAST STATE</p>
    {conversation.participants.map((p) => {
      const lastMsg = [...conversation.messages]
        .reverse()
        .find((m) => m.characterId === p.characterId);
      return (
        <div key={p.characterId} className="flex items-center gap-2 py-1">
          <span className="text-sm font-medium w-32 truncate">{p.name}</span>
          {lastMsg ? (
            <>
              <EmotionDot
                emotion={lastMsg.emotion}
                intensity={lastMsg.intensity as "low" | "medium" | "high"}
                subtext={lastMsg.subtext}
              />
              <span className="text-xs text-zinc-500 uppercase">{lastMsg.emotion}</span>
              <span className="text-xs text-zinc-400">{lastMsg.intensity}</span>
            </>
          ) : (
            <span className="text-xs text-zinc-300">—</span>
          )}
        </div>
      );
    })}
  </div>
)}
```

- [ ] **Step 7: Update ConversationDetail type to include characterId in messages**

The `ConversationDetail` type already matches what the API returns, but `Message` now includes `characterId` — the API route was updated in Task 8 to return it. Verify the types align.

- [ ] **Step 8: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add frontend/app/conversations/[id]/page.tsx
git commit -m "feat: render emotion dots and cast state in conversation page"
```

---

## Task 11: Final verification

- [ ] **Step 1: Run all shared tests**

```bash
bun test --cwd packages/shared
```

Expected: all tests pass.

- [ ] **Step 2: Run full typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Build**

```bash
bun run build
```

Expected: build succeeds with no errors.

- [ ] **Step 4: Manual smoke test**
  1. Start `bun run dev:frontend` and `bun run dev:llm`
  2. Open a conversation with 2+ characters
  3. Click Run (1 turn)
  4. Verify: emotion dot appears before dialogue starts streaming
  5. Verify: completed message shows colored dot with correct intensity style
  6. Verify: hovering dot shows subtext
  7. Verify: cast state panel updates after each turn
  8. Run 3+ turns and verify history format in LiteLLM logs: `[Name — Emotion: intensity | subtext] "..."`
