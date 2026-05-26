# Conversation Problems Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix six bugs in the conversation turn generation: wrong turn strategy selection, characters unaware of other cast members, unfocused reasoning, `</dialogue>` streaming leak, double-reasoning on native-reasoning models, and invisible emotion subtext in the UI.

**Architecture:** Replace the 2-call architecture (separate reasoning + content calls) with a single streaming call whose response uses a `<|reasoning|>…<|reasoning|><|emotion|>…<|emotion|>dialogue` inline format. Fix the turn strategy guard (1 line), add cast names to the system prompt, and show emotion name + subtext inline in the conversation UI.

**Tech Stack:** TypeScript, Bun test runner, Next.js 15 App Router, Handlebars templates, OpenAI SDK (pointing at LiteLLM proxy), Zod, Prisma

**Spec:** `docs/superpowers/specs/2026-05-26-conversation-problems-fix-design.md`

---

## File Map

| File | What changes |
|------|-------------|
| `packages/shared/schema/emotion.ts` | Update `parseEmotionBlock` regex for `<\|emotion\|>` tags |
| `packages/shared/schema/emotion.test.ts` | Update + add tests for new tag format |
| `frontend/lib/conversation/build-messages.ts` | Add `reasoning` field to message type; remove `reasoning` param; new historical assistant format using `<\|reasoning\|>`/`<\|emotion\|>` |
| `frontend/lib/__tests__/build-messages.test.ts` | Update all tests to match new format and signature |
| `frontend/lib/prompts/character-roleplay.hbs` | Add `## Scene Cast` section; rewrite `## Output Format`; update `## Instructions` |
| `frontend/lib/prompts/index.ts` | Add `otherParticipantNames` param; remove `buildReasoningSystemPrompt` + `buildReasoningUserMessage` |
| `frontend/lib/prompts/__tests__/index.test.ts` | Add cast + new-format tests; remove stale format assertions |
| `frontend/lib/conversation/next.ts` | Fix turn strategy; remove call 1; new streaming parser; `reasoning: {effort:"none"}` in body; pass cast names |
| `frontend/components/ui/emotion-dot.tsx` | Add `showLabel?: boolean` prop |
| `frontend/app/conversations/[id]/page.tsx` | Pass `showLabel` on message list and streaming rows |

---

## Task 1 — Update `parseEmotionBlock` for `<|emotion|>` format

**Files:**
- Modify: `packages/shared/schema/emotion.ts`
- Test: `packages/shared/schema/emotion.test.ts`

- [ ] **Step 1: Add failing tests for the new tag format**

Replace the entire `describe("parseEmotionBlock", ...)` block in `packages/shared/schema/emotion.test.ts` with:

```ts
describe("parseEmotionBlock", () => {
  test("extracts emotion from <|emotion|> block", () => {
    const text = `<|emotion|>{"emotion":"Fear","intensity":"high","subtext":"Hiding something"}<|emotion|>`;
    const result = parseEmotionBlock(text);
    expect(result).toEqual({ emotion: "Fear", intensity: "high", subtext: "Hiding something" });
  });

  test("extracts emotion when surrounded by other text", () => {
    const text = `<|reasoning|>some thoughts<|reasoning|>\n<|emotion|>{"emotion":"Joy","intensity":"low","subtext":""}<|emotion|>Hello there.`;
    const result = parseEmotionBlock(text);
    expect(result).toEqual({ emotion: "Joy", intensity: "low", subtext: "" });
  });

  test("returns null when no <|emotion|> block present", () => {
    expect(parseEmotionBlock("Just some text.")).toBeNull();
  });

  test("returns null for old <emotion> XML format", () => {
    const text = `<emotion>{"emotion":"Fear","intensity":"high","subtext":"Hiding something"}</emotion>`;
    expect(parseEmotionBlock(text)).toBeNull();
  });

  test("returns null for malformed JSON inside block", () => {
    expect(parseEmotionBlock("<|emotion|>{bad json}<|emotion|>")).toBeNull();
  });

  test("returns null if emotion value is invalid", () => {
    const text = `<|emotion|>{"emotion":"Neutral","intensity":"low","subtext":""}<|emotion|>`;
    expect(parseEmotionBlock(text)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun test --cwd packages/shared packages/shared/schema/emotion.test.ts
```

Expected: `parseEmotionBlock` tests fail (old regex doesn't match `<|emotion|>`). `EmotionSchema` tests still pass.

- [ ] **Step 3: Update `parseEmotionBlock` in `packages/shared/schema/emotion.ts`**

Change only the regex in `parseEmotionBlock`:

```ts
export function parseEmotionBlock(text: string): Emotion | null {
  const match = text.match(/<\|emotion\|>([\s\S]*?)<\|emotion\|>/);
  if (!match?.[1]) return null;
  try {
    return EmotionSchema.parse(JSON.parse(match[1]));
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test --cwd packages/shared packages/shared/schema/emotion.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/schema/emotion.ts packages/shared/schema/emotion.test.ts
git commit -m "fix: update parseEmotionBlock to use <|emotion|> tag format"
```

---

## Task 2 — Update `buildCharacterMessages` for new format

**Files:**
- Modify: `frontend/lib/conversation/build-messages.ts`
- Test: `frontend/lib/__tests__/build-messages.test.ts`

- [ ] **Step 1: Write failing tests**

Replace the entire contents of `frontend/lib/__tests__/build-messages.test.ts` with:

```ts
import { describe, test, expect } from "bun:test";
import { buildCharacterMessages } from "../conversation/build-messages";

type Msg = {
  characterId: string;
  character: { name: string };
  content: string;
  emotion: string;
  intensity: string;
  subtext: string;
  reasoning: string | null;
};

const msg = (
  characterId: string,
  name: string,
  content: string,
  reasoning: string | null = null,
): Msg => ({
  characterId,
  character: { name },
  content,
  emotion: "Joy",
  intensity: "low",
  subtext: "",
  reasoning,
});

describe("buildCharacterMessages", () => {
  test("single user message when character has never spoken and no history", () => {
    const result = buildCharacterMessages([], "a", "Alice");
    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe("user");
    expect(result[0]!.content).toContain("Continue as Alice");
  });

  test("single user message when character has never spoken and others have", () => {
    const history = [msg("b", "Bob", "Hello"), msg("c", "Carol", "Hi")];
    const result = buildCharacterMessages(history, "a", "Alice");
    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe("user");
    const content = result[0]!.content as string;
    expect(content).toContain("Bob");
    expect(content).toContain("Carol");
    expect(content).toContain("Continue as Alice");
  });

  test("user+assistant+user when character spoke once and others replied", () => {
    const history = [
      msg("b", "Bob", "Question?"),
      msg("a", "Alice", "My answer."),
      msg("b", "Bob", "Follow-up?"),
    ];
    const result = buildCharacterMessages(history, "a", "Alice");
    expect(result).toHaveLength(3);
    expect(result[0]!.role).toBe("user");
    expect(result[1]!.role).toBe("assistant");
    expect(result[1]!.content as string).toContain("My answer.");
    expect(result[1]!.content as string).toContain("<|emotion|>");
    expect(result[2]!.role).toBe("user");
    expect(result[2]!.content as string).toContain("Follow-up");
  });

  test("historical assistant message includes <|reasoning|> prefix when reasoning is present", () => {
    const history = [
      msg("a", "Alice", "My answer.", "I was nervous about this."),
      msg("b", "Bob", "Follow-up?"),
    ];
    const result = buildCharacterMessages(history, "a", "Alice");
    const assistantTurn = result.find((m) => m.role === "assistant");
    expect(assistantTurn?.content as string).toContain(
      "<|reasoning|>I was nervous about this.<|reasoning|>",
    );
    expect(assistantTurn?.content as string).toContain("<|emotion|>");
    expect(assistantTurn?.content as string).toContain("My answer.");
  });

  test("historical assistant message omits <|reasoning|> prefix when reasoning is null", () => {
    const history = [
      msg("a", "Alice", "My answer.", null),
      msg("b", "Bob", "Follow-up?"),
    ];
    const result = buildCharacterMessages(history, "a", "Alice");
    const assistantTurn = result.find((m) => m.role === "assistant");
    expect(assistantTurn?.content as string).not.toContain("<|reasoning|>");
    expect(assistantTurn?.content as string).toContain("<|emotion|>");
  });

  test("reasoning is not exposed to other characters", () => {
    // Carol's messages (user turns when building for Alice) must never contain reasoning
    const history = [
      msg("b", "Bob", "Hey"),
      msg("c", "Carol", "Hello.", "Carol's private thought"),
      msg("a", "Alice", "Hi there."),
    ];
    const result = buildCharacterMessages(history, "a", "Alice");
    // user turns should not contain Carol's reasoning
    const userTurns = result.filter((m) => m.role === "user");
    for (const turn of userTurns) {
      expect(turn.content as string).not.toContain("Carol's private thought");
    }
  });

  test("character spoke first — synthetic scene-start user turn is inserted", () => {
    const history = [
      msg("a", "Alice", "I begin."),
      msg("b", "Bob", "Reply."),
    ];
    const result = buildCharacterMessages(history, "a", "Alice");
    expect(result[0]!.role).toBe("user");
    expect(result[1]!.role).toBe("assistant");
    expect(result[1]!.content as string).toContain("I begin.");
    expect(result[1]!.content as string).toContain("<|emotion|>");
  });

  test("three-character conversation groups others correctly", () => {
    const history = [
      msg("b", "Bob", "B line 1"),
      msg("a", "Alice", "A line 1"),
      msg("b", "Bob", "B line 2"),
      msg("c", "Carol", "C line 1"),
    ];
    const result = buildCharacterMessages(history, "a", "Alice");
    expect(result).toHaveLength(4);
    expect(result[2]!.role).toBe("user");
    const bundled = result[2]!.content as string;
    expect(bundled).toContain("Bob");
    expect(bundled).toContain("Carol");
  });

  test("always ends with a user turn", () => {
    const history = [msg("b", "Bob", "Hey"), msg("a", "Alice", "Hello")];
    const result = buildCharacterMessages(history, "a", "Alice");
    expect(result[result.length - 1]!.role).toBe("user");
  });

  test("first message is always user role", () => {
    const cases = [
      [],
      [msg("b", "Bob", "Hi")],
      [msg("a", "Alice", "First")],
    ];
    for (const history of cases) {
      const result = buildCharacterMessages(history, "a", "Alice");
      expect(result[0]!.role).toBe("user");
    }
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun test --cwd frontend frontend/lib/__tests__/build-messages.test.ts
```

Expected: multiple failures — old signature takes 4 args, format checks expect `<|emotion|>` and `<|reasoning|>`.

- [ ] **Step 3: Rewrite `frontend/lib/conversation/build-messages.ts`**

Replace the entire file with:

```ts
import { buildHistoryLine } from "./parse-turn";

export type ConversationTurn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

type ConversationMessage = {
  characterId: string;
  character: { name: string };
  content: string;
  emotion: string;
  intensity: string;
  subtext: string;
  reasoning: string | null;
};

const SCENE_START = "(The scene has just begun — no lines have been spoken yet.)";

/**
 * Builds a per-character alternating MessageParam array for use as the
 * `messages` field in an Anthropic API call.
 *
 * The speaking character's own prior lines become `assistant` turns.
 * All other characters' lines between them are bundled into `user` turns.
 * Each character's reasoning is visible only in their own assistant turns —
 * it is never included in user turns, so other characters cannot see it.
 */
export function buildCharacterMessages(
  messages: ConversationMessage[],
  speakingCharacterId: string,
  speakingCharacterName: string,
): ConversationTurn[] {
  const result: ConversationTurn[] = [];
  let pendingOthers: string[] = [];

  for (const msg of messages) {
    if (msg.characterId === speakingCharacterId) {
      const userContent =
        pendingOthers.length > 0 ? pendingOthers.join("\n") : SCENE_START;
      result.push({ role: "user", content: userContent });

      const emotionJson = JSON.stringify({
        emotion: msg.emotion,
        intensity: msg.intensity,
        subtext: msg.subtext,
      });
      const emotionBlock = `<|emotion|>${emotionJson}<|emotion|>`;
      const reasoningPrefix = msg.reasoning
        ? `<|reasoning|>${msg.reasoning}<|reasoning|>\n`
        : "";

      result.push({
        role: "assistant",
        content: `${reasoningPrefix}${emotionBlock}${msg.content}`,
      });
      pendingOthers = [];
    } else {
      pendingOthers.push(
        buildHistoryLine(
          msg.character.name,
          msg.content,
          msg.emotion,
          msg.intensity,
          msg.subtext,
        ),
      );
    }
  }

  const hasPriorAssistantTurn = result.some((m) => m.role === "assistant");

  if (hasPriorAssistantTurn && pendingOthers.length >= 2) {
    result.push({ role: "user", content: pendingOthers.join("\n") });
    pendingOthers = [];
  }

  const contextLines =
    pendingOthers.length > 0 ? pendingOthers.join("\n") : SCENE_START;

  const continuePrompt = `Continue as ${speakingCharacterName}. Write only their next line.`;
  result.push({ role: "user", content: `${contextLines}\n\n${continuePrompt}` });

  return result;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test --cwd frontend frontend/lib/__tests__/build-messages.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/conversation/build-messages.ts frontend/lib/__tests__/build-messages.test.ts
git commit -m "fix: update buildCharacterMessages to use <|reasoning|>/<|emotion|> format, remove reasoning param"
```

---

## Task 3 — Update prompt template and builder

**Files:**
- Modify: `frontend/lib/prompts/character-roleplay.hbs`
- Modify: `frontend/lib/prompts/index.ts`
- Test: `frontend/lib/prompts/__tests__/index.test.ts`

- [ ] **Step 1: Add failing tests for new prompt behavior**

Append these tests to `frontend/lib/prompts/__tests__/index.test.ts` (after the existing `describe` block, still in the same file):

```ts
describe("buildCharacterPrompt — cast and format", () => {
  test("includes Scene Cast section when other participants provided", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.", ["Jesse Pinkman", "Hank Schrader"]);
    expect(result).toContain("## Scene Cast");
    expect(result).toContain("Jesse Pinkman");
    expect(result).toContain("Hank Schrader");
  });

  test("omits Scene Cast section when no other participants", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.", []);
    expect(result).not.toContain("## Scene Cast");
  });

  test("omits Scene Cast section when param is omitted (default)", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.");
    expect(result).not.toContain("## Scene Cast");
  });

  test("output format uses <|reasoning|> tags", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.");
    expect(result).toContain("<|reasoning|>");
  });

  test("output format uses <|emotion|> tags", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.");
    expect(result).toContain("<|emotion|>");
  });

  test("output format does not reference <dialogue> or </dialogue>", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.");
    expect(result).not.toContain("<dialogue>");
    expect(result).not.toContain("</dialogue>");
  });

  test("reasoning block instruction emphasises privacy", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.");
    expect(result).toContain("private");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun test --cwd frontend frontend/lib/prompts/__tests__/index.test.ts
```

Expected: cast and format tests fail; existing `buildCharacterPrompt` tests still pass.

- [ ] **Step 3: Update `frontend/lib/prompts/character-roleplay.hbs`**

Replace the entire file with:

```handlebars
You are {{name}}. Stay in character at all times — never break the fourth wall, never acknowledge being an AI or a fictional character.

## Identity
{{shortDescription}}

{{#if backstory}}
### Backstory
{{backstory}}
{{/if}}

## Personality
{{#each personalityTraits}}- {{this}}
{{/each}}

## Psychology
**What you value:** {{#each values}}"{{this}}"{{#unless @last}}, {{/unless}}{{/each}}
**What you fear:** {{#each fears}}"{{this}}"{{#unless @last}}, {{/unless}}{{/each}}
**What you want:** {{#each goals}}"{{this}}"{{#unless @last}}, {{/unless}}{{/each}}
**How you cope:** {{#each copingStyle}}{{this}}{{#unless @last}}; {{/unless}}{{/each}}

Every response must reflect this psychology. Your fears influence your reactions, your goals drive your choices, your values set your limits.

## How You Speak
{{#each speechPatterns}}- {{this}}
{{/each}}
**Your words, verbatim:**
{{#each notableQuotes}}- "{{this}}"
{{/each}}
Match this voice exactly. Do not adopt a generic or neutral tone.

## What You Know
{{formatRecord knowledgeScope}}
Speak only from within this knowledge. If asked about something outside it, respond as your character would — with ignorance, deflection, or your characteristic reaction — never with omniscience.

## Your Relationships
{{formatRecord relationships}}

## Your Abilities
{{#each abilities}}- {{this}}
{{/each}}

## Output Format

Always respond in this exact structure — no exceptions, no preamble:

<|reasoning|>
[Think about what you just read. What did the other characters say? What do you want to say next, and why? Keep it short — 1 to 3 sentences of private internal reasoning.]
<|reasoning|>
<|emotion|>{"emotion":"[EMOTION]","intensity":"[INTENSITY]","subtext":"[SUBTEXT]"}<|emotion|>
Your next line of dialogue or action here.

Where:
- [EMOTION]: one of Joy | Trust | Fear | Surprise | Sadness | Disgust | Anger | Anticipation
- [INTENSITY]: low | medium | high
- [SUBTEXT]: one sentence — what {{name}} truly feels beneath the surface, in their internal voice

Example:
<|reasoning|>
She just pushed back hard. I want to stay calm but I'm scared. I'll deflect.
<|reasoning|>
<|emotion|>{"emotion":"Fear","intensity":"high","subtext":"Trying not to show weakness in front of the others"}<|emotion|>
I don't think we should go in there.

## Instructions
- No name prefix. No narrator voice. No meta-commentary.
- You may include brief physical action descriptions in *italics* in your dialogue (e.g. *crosses arms slowly*). Actions must be consistent with {{name}}'s physical build and abilities.
- The `*italics*` convention is only for action descriptions in dialogue. Never use asterisks in the `<|reasoning|>` block.
- The `<|reasoning|>` block is strictly private — never reference, repeat, or hint at it in your dialogue.
- Always include all three sections in every response: `<|reasoning|>` block, `<|emotion|>` block, and dialogue text. Never omit any.
- Let psychology drive subtext: what {{name}} says and what {{name}} means may differ.
- Maintain continuity with the conversation history.

{{#if otherParticipants}}
## Scene Cast
You are sharing this scene with: {{otherParticipants}}.
{{/if}}

## Scene
{{sceneContext}}
```

- [ ] **Step 4: Update `frontend/lib/prompts/index.ts`**

Replace the entire file with:

```ts
import Handlebars from "handlebars";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import "./helpers";
import type { CharacterSearchResult } from "@open-ormus/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const templateSource = readFileSync(
  join(__dirname, "character-roleplay.hbs"),
  "utf-8"
);
const template = Handlebars.compile(templateSource);

export function buildCharacterPrompt(
  sheet: CharacterSearchResult,
  sceneContext: string,
  otherParticipantNames: string[] = [],
): string {
  return template({
    name: sheet.name,
    shortDescription: sheet.shortDescription,
    ...sheet.personality,
    sceneContext,
    otherParticipants: otherParticipantNames.length > 0
      ? otherParticipantNames.join(", ")
      : null,
  });
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
bun test --cwd frontend frontend/lib/prompts/__tests__/index.test.ts
```

Expected: all tests pass, including the new cast + format tests.

- [ ] **Step 6: Run typecheck to catch any callers broken by the removed exports**

```bash
bun run typecheck
```

If any file still imports `buildReasoningSystemPrompt` or `buildReasoningUserMessage`, the typecheck will fail with "Module has no exported member". Fix those imports (they should only exist in `next.ts` which we update in Task 4).

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/prompts/character-roleplay.hbs frontend/lib/prompts/index.ts frontend/lib/prompts/__tests__/index.test.ts
git commit -m "feat: add cast section and unified <|reasoning|>/<|emotion|> output format to character prompt"
```

---

## Task 4 — Rewrite `generateNextTurnStream`

**Files:**
- Modify: `frontend/lib/conversation/next.ts`

No new test file for `next.ts` itself — it requires a live LiteLLM connection. Manual smoke test instructions at the end of this task.

- [ ] **Step 1: Replace `frontend/lib/conversation/next.ts` entirely**

```ts
// frontend/lib/conversation/next.ts
import OpenAI from "openai";
import type { ChatCompletionCreateParamsStreaming } from "openai/resources/chat/completions";
import { prisma } from "@/lib/prisma";
import { selectNextSpeakerWithOrchestrator } from "@/lib/orchestrator";
import { buildCharacterPrompt } from "@/lib/prompts";
import { CharacterSearchResultSchema, parseEmotionBlock, type Emotion } from "@open-ormus/shared";
import { buildCharacterMessages } from "./build-messages";

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

const FALLBACK_EMOTION: Emotion = { emotion: "Joy", intensity: "low", subtext: "" };
const REASONING_TAG = "<|reasoning|>";
const EMOTION_TAG = "<|emotion|>";

// Yields TurnEvent items: thinking/thinking_done bracket the reasoning+emotion
// parsing phase, then token events stream the character's dialogue.
// Saves the completed message (content + extracted reasoning + emotion) to DB.
// Throws ConversationError on any failure — no message is saved on error.
export async function* generateNextTurnStream(
  conversationId: string,
  userId: string,
  signal?: AbortSignal,
  onEmotion?: (emotion: Emotion) => void,
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

  if (conversation.turnStrategy === "ORCHESTRATOR") {
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

  const otherNames = conversation.participants
    .filter((p) => p.characterId !== nextParticipant.characterId)
    .map((p) => p.character.name);

  const systemPrompt = buildCharacterPrompt(sheet, conversation.context, otherNames);

  const client = new OpenAI({
    baseURL: `${process.env["ANTHROPIC_BASE_URL"] ?? "http://localhost:4000"}/v1`,
    apiKey: process.env["ANTHROPIC_API_KEY"] ?? "",
  });

  const openrouterHeaders = {
    "HTTP-Referer": "https://openormus.app",
    "X-Title": "OpenOrmus",
    "x-session-id": conversationId,
  };

  const contentMessages = buildCharacterMessages(
    conversation.messages,
    nextParticipant.characterId,
    nextParticipant.character.name,
  );

  let content = "";
  let reasoningText = "";
  let parsedEmotion: Emotion | null = null;

  yield { type: "thinking" };

  try {
    const stream = await client.chat.completions.create(
      {
        model,
        max_tokens: 768,
        stream: true,
        messages: [
          { role: "system" as const, content: systemPrompt },
          ...contentMessages,
        ],
        extra_headers: openrouterHeaders,
        extra_body: { reasoning: { effort: "none" } },
      } as ChatCompletionCreateParamsStreaming,
      { signal },
    );

    let rawBuffer = "";
    let parserState:
      | "pre_reasoning"
      | "in_reasoning"
      | "pre_emotion"
      | "in_emotion"
      | "dialogue" = "pre_reasoning";

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta.content;
      if (!token) continue;

      // Dialogue tokens stream directly — no buffering needed.
      if (parserState === "dialogue") {
        content += token;
        yield { type: "token", text: token };
        continue;
      }

      rawBuffer += token;

      if (parserState === "pre_reasoning") {
        const idx = rawBuffer.indexOf(REASONING_TAG);
        if (idx !== -1) {
          rawBuffer = rawBuffer.slice(idx + REASONING_TAG.length);
          parserState = "in_reasoning";
        } else if (rawBuffer.length > 300) {
          // Model skipped reasoning block — look for emotion directly.
          const emoIdx = rawBuffer.indexOf(EMOTION_TAG);
          if (emoIdx !== -1) {
            rawBuffer = rawBuffer.slice(emoIdx + EMOTION_TAG.length);
            parserState = "in_emotion";
          }
        }
      }

      if (parserState === "in_reasoning") {
        const idx = rawBuffer.indexOf(REASONING_TAG);
        if (idx !== -1) {
          reasoningText = rawBuffer.slice(0, idx).trim();
          rawBuffer = rawBuffer.slice(idx + REASONING_TAG.length);
          parserState = "pre_emotion";
        }
      }

      if (parserState === "pre_emotion") {
        const idx = rawBuffer.indexOf(EMOTION_TAG);
        if (idx !== -1) {
          rawBuffer = rawBuffer.slice(idx + EMOTION_TAG.length);
          parserState = "in_emotion";
        }
      }

      if (parserState === "in_emotion") {
        const idx = rawBuffer.indexOf(EMOTION_TAG);
        if (idx !== -1) {
          const emotionJson = rawBuffer.slice(0, idx);
          const rest = rawBuffer.slice(idx + EMOTION_TAG.length);
          rawBuffer = "";
          parsedEmotion = parseEmotionBlock(`${EMOTION_TAG}${emotionJson}${EMOTION_TAG}`);
          onEmotion?.(parsedEmotion ?? FALLBACK_EMOTION);
          parserState = "dialogue";
          yield { type: "thinking_done" };
          if (rest) {
            content += rest;
            yield { type: "token", text: rest };
          }
        }
      }
    }

    if (parsedEmotion === null) {
      onEmotion?.(FALLBACK_EMOTION);
      yield { type: "thinking_done" };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ConversationError("LITELLM_ERROR", `Content stream error: ${msg}`);
  }

  if (!content) {
    console.error(`[generateNextTurnStream] empty content from LLM`);
  }

  const emotionToSave = parsedEmotion ?? FALLBACK_EMOTION;

  await prisma.message.create({
    data: {
      conversationId,
      characterId: nextParticipant.characterId,
      content,
      reasoning: reasoningText || null,
      emotion: emotionToSave.emotion,
      intensity: emotionToSave.intensity,
      subtext: emotionToSave.subtext,
    },
  });
}
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: no errors. If `buildReasoningSystemPrompt` or `buildReasoningUserMessage` imports are flagged, remove those import lines.

- [ ] **Step 3: Smoke test the change**

With `bun run dev:frontend` and `bun run dev:mcp` running:
1. Open a conversation with 2 participants using Round-Robin strategy.
2. Run 1 turn. Verify no `</dialogue>` tag appears in the streaming text.
3. Verify the reasoning collapsible section shows the character's thoughts (not empty).
4. Open a conversation with 3+ participants using Round-Robin strategy.
5. Run 3 turns. Verify turns alternate between characters (not all one character), confirming the orchestrator is no longer called for Round-Robin.
6. Open a conversation with 3+ participants using Orchestrator strategy.
7. Run 3 turns. Verify the orchestrator is still called (may see varied speaker selection).

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/conversation/next.ts
git commit -m "fix: rewrite generateNextTurnStream — unified format, fix turn strategy, add cast to prompt"
```

---

## Task 5 — Emotion UI: `showLabel` prop and conversation page

**Files:**
- Modify: `frontend/components/ui/emotion-dot.tsx`
- Modify: `frontend/app/conversations/[id]/page.tsx`

No automated test for visual component — smoke test instructions below.

- [ ] **Step 1: Add `showLabel` prop to `EmotionDot`**

Replace the entire contents of `frontend/components/ui/emotion-dot.tsx` with:

```tsx
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
  showLabel?: boolean;
}

export function EmotionDot({ emotion, intensity, subtext, showLabel = false }: EmotionDotProps) {
  const color = EMOTION_COLOR[emotion] ?? "var(--ink-mute)";
  const sizeClass = intensity === "low" ? "size-2 opacity-60" : "size-3";
  const ringClass = intensity === "high" ? "shadow-glow animate-pulse" : "";

  const dot = (
    <span
      className={`rounded-full inline-block shrink-0 ${sizeClass} ${ringClass}`}
      style={{ background: color }}
    />
  );

  if (!showLabel) {
    return <span title={subtext}>{dot}</span>;
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {dot}
      <span className="text-xs" style={{ color: "var(--ink-mute)" }}>
        {emotion}{subtext ? ` · "${subtext}"` : ""}
      </span>
    </span>
  );
}
```

- [ ] **Step 2: Update `EmotionDot` usages in the conversation page**

In `frontend/app/conversations/[id]/page.tsx`, add `showLabel` to the two usages in the message feed. Leave the cast sidebar usage unchanged.

Find the `EmotionDot` at the message list (around line 324 — the one inside `conversation.messages.map`):

```tsx
// Before (message list row, inside conversation.messages.map):
<EmotionDot
  emotion={m.emotion}
  intensity={m.intensity as "low" | "medium" | "high"}
  subtext={m.subtext}
/>

// After:
<EmotionDot
  emotion={m.emotion}
  intensity={m.intensity as "low" | "medium" | "high"}
  subtext={m.subtext}
  showLabel
/>
```

Find the `EmotionDot` in the streaming buffer section (around line 349 — inside the `streamingBuffer &&` block):

```tsx
// Before (streaming row):
<EmotionDot
  emotion={streamingEmotion.emotion}
  intensity={streamingEmotion.intensity as "low" | "medium" | "high"}
  subtext={streamingEmotion.subtext}
/>

// After:
<EmotionDot
  emotion={streamingEmotion.emotion}
  intensity={streamingEmotion.intensity as "low" | "medium" | "high"}
  subtext={streamingEmotion.subtext}
  showLabel
/>
```

The cast sidebar usage (around line 270, inside `conversation.participants.map`) keeps its existing `EmotionDot` call unchanged — no `showLabel`.

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 4: Smoke test the UI**

With `bun run dev:frontend` running, open a conversation with existing messages:
1. Each historical message should show `● Fear · "Hiding something"` (dot + emotion name + subtext) inline on the name/time row.
2. The cast sidebar should show dots only — no label text.
3. Run 1 turn and watch the streaming message — the emotion label should appear as soon as the `<|emotion|>` block is parsed, while dialogue text is still streaming.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ui/emotion-dot.tsx frontend/app/conversations/[id]/page.tsx
git commit -m "feat: show emotion name and subtext inline in conversation message list"
```

---

## Task 6 — Final verification

- [ ] **Step 1: Run all tests**

```bash
bun test --cwd packages/shared && bun test --cwd frontend
```

Expected: all tests pass.

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Full smoke test**

With LiteLLM proxy running (`bun run dev:llm`), frontend (`bun run dev:frontend`), and MCP server (`bun run dev:mcp`) all running:

1. **Round-Robin 2-char**: create a 2-character conversation, Run 4 turns. Characters should alternate A→B→A→B.
2. **Round-Robin 3-char**: create a 3-character conversation with Round-Robin strategy, Run 6 turns. Characters should cycle A→B→C→A→B→C, not selected by the orchestrator.
3. **Orchestrator 3-char**: same setup with Orchestrator strategy. Turns may vary — that's expected.
4. **Cast awareness**: run 1 turn. Expand the reasoning collapsible — it should mention what the other character said (not random fragments). The reasoning should be coherent and response-focused.
5. **Emotion label**: each message should show `● Joy · "subtext text"` inline on the name row.
6. **No tag leak**: watch the streaming text carefully — no `</dialogue>` or `<|reasoning|>` or `<|emotion|>` should appear in the rendered dialogue.
7. **Streaming emotion**: the emotion label should appear while dialogue is still streaming (not only after the turn is saved).

- [ ] **Step 4: Squash merge into develop** (do this from the main worktree)

```bash
# from the develop branch (not in the worktree)
git merge --squash worktree-conversation-problems-fix
git commit -m "fix: conversation problems — unified format, turn strategy, cast awareness, emotion UI"
git worktree remove .claude/worktrees/conversation-problems-fix
git branch -d worktree-conversation-problems-fix
```
