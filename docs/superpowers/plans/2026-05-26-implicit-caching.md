# Implicit Caching — Character Conversations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure character conversation LLM calls to use per-character multi-turn message arrays, enabling Anthropic implicit caching on both system prompt and historical conversation prefix.

**Architecture:** Extract a pure `buildCharacterMessages()` helper that constructs a per-character alternating `user`/`assistant` messages array from conversation history. The speaking character's prior lines become `assistant` turns; all other characters' lines between them become `user` turns. Private reasoning is injected into the final (always-new) user message only. The system prompt is stabilised to `buildCharacterPrompt(sheet, context)` with no reasoning appended.

**Tech Stack:** TypeScript, Anthropic SDK (`MessageParam`), Bun test runner, existing `buildHistoryLine` utility.

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `frontend/lib/conversation/build-messages.ts` | Pure helper — builds per-character `MessageParam[]` |
| Create | `frontend/lib/__tests__/build-messages.test.ts` | Unit tests for `buildCharacterMessages` |
| Modify | `frontend/lib/conversation/next.ts` | Use helper; remove reasoning from system prompt |

---

### Task 1: Create `build-messages.ts` with failing tests

**Files:**
- Create: `frontend/lib/conversation/build-messages.ts`
- Create: `frontend/lib/__tests__/build-messages.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/lib/__tests__/build-messages.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { buildCharacterMessages } from "../conversation/build-messages";

// Minimal message shape matching what next.ts passes
type Msg = {
  characterId: string;
  character: { name: string };
  content: string;
  emotion: string;
  intensity: string;
  subtext: string;
};

const msg = (characterId: string, name: string, content: string): Msg => ({
  characterId,
  character: { name },
  content,
  emotion: "Joy",
  intensity: "low",
  subtext: "",
});

describe("buildCharacterMessages", () => {
  test("single user message when character has never spoken and no history", () => {
    const result = buildCharacterMessages([], "a", "Alice", "");
    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe("user");
    expect(result[0]!.content).toContain("Continue as Alice");
  });

  test("single user message when character has never spoken and others have", () => {
    const history = [msg("b", "Bob", "Hello"), msg("c", "Carol", "Hi")];
    const result = buildCharacterMessages(history, "a", "Alice", "");
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
    const result = buildCharacterMessages(history, "a", "Alice", "");
    expect(result).toHaveLength(3);
    expect(result[0]!.role).toBe("user");
    expect(result[1]!.role).toBe("assistant");
    expect(result[1]!.content).toBe("My answer.");
    expect(result[2]!.role).toBe("user");
    expect(result[2]!.content as string).toContain("Follow-up");
  });

  test("reasoning injected into last user message only", () => {
    const history = [msg("b", "Bob", "Hey")];
    const result = buildCharacterMessages(history, "a", "Alice", "I feel nervous.");
    const last = result[result.length - 1]!;
    expect(last.role).toBe("user");
    expect(last.content as string).toContain("I feel nervous.");
    // Earlier turns (if any) must NOT contain reasoning
    result.slice(0, -1).forEach((turn) => {
      expect(turn.content as string).not.toContain("I feel nervous.");
    });
  });

  test("no reasoning prefix when reasoning is empty string", () => {
    const history = [msg("b", "Bob", "Hey")];
    const result = buildCharacterMessages(history, "a", "Alice", "");
    const last = result[result.length - 1]!;
    expect(last.content as string).not.toContain("private thoughts");
  });

  test("character spoke first — synthetic scene-start user turn is inserted", () => {
    const history = [
      msg("a", "Alice", "I begin."),
      msg("b", "Bob", "Reply."),
    ];
    const result = buildCharacterMessages(history, "a", "Alice", "");
    // Must start with user turn (scene start), then assistant (Alice's first line)
    expect(result[0]!.role).toBe("user");
    expect(result[1]!.role).toBe("assistant");
    expect(result[1]!.content).toBe("I begin.");
  });

  test("three-character conversation groups others correctly", () => {
    // A, B, C take turns: B then C speak before A's second turn
    const history = [
      msg("b", "Bob", "B line 1"),
      msg("a", "Alice", "A line 1"),
      msg("b", "Bob", "B line 2"),
      msg("c", "Carol", "C line 1"),
    ];
    const result = buildCharacterMessages(history, "a", "Alice", "");
    // [user(B line 1), assistant(A line 1), user(B line 2 + C line 1), ...trigger]
    expect(result).toHaveLength(4); // user, assistant, user(bundle), user(trigger)
    expect(result[2]!.role).toBe("user");
    const bundled = result[2]!.content as string;
    expect(bundled).toContain("Bob");
    expect(bundled).toContain("Carol");
  });

  test("always ends with a user turn", () => {
    const history = [msg("b", "Bob", "Hey"), msg("a", "Alice", "Hello")];
    const result = buildCharacterMessages(history, "a", "Alice", "");
    expect(result[result.length - 1]!.role).toBe("user");
  });

  test("first message is always user role", () => {
    const cases = [
      [],
      [msg("b", "Bob", "Hi")],
      [msg("a", "Alice", "First")],
    ];
    for (const history of cases) {
      const result = buildCharacterMessages(history, "a", "Alice", "");
      expect(result[0]!.role).toBe("user");
    }
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun test frontend/lib/__tests__/build-messages.test.ts
```

Expected: multiple failures — `"Cannot find module '../conversation/build-messages'"`.

- [ ] **Step 3: Implement `build-messages.ts`**

Create `frontend/lib/conversation/build-messages.ts`:

```ts
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { buildHistoryLine } from "./parse-turn";

type ConversationMessage = {
  characterId: string;
  character: { name: string };
  content: string;
  emotion: string;
  intensity: string;
  subtext: string;
};

const SCENE_START = "(The scene has just begun — no lines have been spoken yet.)";

/**
 * Builds a per-character alternating MessageParam array for use as the
 * `messages` field in an Anthropic API call.
 *
 * The speaking character's own prior lines become `assistant` turns.
 * All other characters' lines between them are bundled into `user` turns.
 * Private reasoning is injected into the final (always-new) user message only —
 * it never appears in historical turns and is invisible to other characters.
 */
export function buildCharacterMessages(
  messages: ConversationMessage[],
  speakingCharacterId: string,
  speakingCharacterName: string,
  reasoning: string,
): MessageParam[] {
  const result: MessageParam[] = [];
  let pendingOthers: string[] = [];

  for (const msg of messages) {
    if (msg.characterId === speakingCharacterId) {
      const userContent =
        pendingOthers.length > 0 ? pendingOthers.join("\n") : SCENE_START;
      result.push({ role: "user", content: userContent });
      result.push({ role: "assistant", content: msg.content });
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

  const contextLines =
    pendingOthers.length > 0 ? pendingOthers.join("\n") : SCENE_START;

  const continuePrompt = `Now continue as ${speakingCharacterName}. Write only their next line.`;

  const triggerContent = reasoning
    ? `[Your private thoughts before this response — use as context, do not repeat or quote]\n${reasoning}\n\n${contextLines}\n\n${continuePrompt}`
    : `${contextLines}\n\n${continuePrompt}`;

  result.push({ role: "user", content: triggerContent });

  return result;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test frontend/lib/__tests__/build-messages.test.ts
```

Expected: all tests pass, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/conversation/build-messages.ts frontend/lib/__tests__/build-messages.test.ts
git commit -m "feat: add buildCharacterMessages helper for per-character multi-turn arrays"
```

---

### Task 2: Update `next.ts` to use `buildCharacterMessages`

**Files:**
- Modify: `frontend/lib/conversation/next.ts`

- [ ] **Step 1: Replace the system prompt and messages construction in Call 2**

In `frontend/lib/conversation/next.ts`, make the following changes:

**Add import** at the top (after the existing imports):
```ts
import { buildCharacterMessages } from "./build-messages";
```

**Replace** this block (lines ~141–164):
```ts
  // ── Call 2: content (streaming) ─────────────────────────────────────────────
  const contentSystemPrompt = reasoning
    ? `${systemPrompt}\n\n[Your private thoughts before this response — use as context, do not repeat or quote]\n${reasoning}`
    : systemPrompt;

  const contentUserMessage = `Conversation so far:\n${historyText}\n\nNow continue as ${nextParticipant.character.name}. Write only their next line.`;

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
      system: contentSystemPrompt,
      messages: [{ role: "user", content: contentUserMessage }],
    }),
  });
```

**With:**
```ts
  // ── Call 2: content (streaming) ─────────────────────────────────────────────
  const contentMessages = buildCharacterMessages(
    conversation.messages,
    nextParticipant.characterId,
    nextParticipant.character.name,
    reasoning,
  );

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
      messages: contentMessages,
    }),
  });
```

Also **remove** the `historyText` block (lines ~86–99) — it is no longer needed for Call 2. Call 1 (reasoning) uses `buildReasoningUserMessage` which takes `historyText` directly; check whether it is still referenced.

Look at `buildReasoningUserMessage` call (line ~122):
```ts
content: buildReasoningUserMessage(sheet, historyText, nextParticipant.character.name),
```

`historyText` is still needed for Call 1. Keep it.

- [ ] **Step 2: Run type-check**

```bash
bun run typecheck
```

Expected: 0 errors. If there are errors, fix them before continuing.

- [ ] **Step 3: Run all tests**

```bash
bun test --cwd frontend
```

Expected: all existing tests pass, no regressions.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/conversation/next.ts
git commit -m "feat: use per-character multi-turn messages for implicit caching"
```

---

### Task 3: Verify end-to-end behaviour

**Files:**
- No code changes — manual verification only.

- [ ] **Step 1: Start the dev stack**

From repo root:
```bash
bun run dev:llm     # LiteLLM proxy on :4000
bun run dev:mcp     # MCP server on :3001
bun run dev:frontend  # Next.js on :3000
```

- [ ] **Step 2: Create a conversation with 2 characters and run 4 turns**

In the UI:
1. Create a conversation with 2 characters (e.g. Walter White + Jesse Pinkman).
2. Start a job for 4 turns (POST `/api/conversations/{id}/jobs` with `{ "turns": 4 }`).
3. Watch the stream — confirm both characters produce dialogue with emotion tags.

- [ ] **Step 3: Verify reasoning stays private**

Check the DB (via Prisma Studio or direct query):
```bash
bun run prisma:studio
```

In the `Message` table:
- Each message has a `reasoning` value (the private thoughts from Call 1).
- The `content` field contains only the character's spoken line — no reasoning text leaked.

- [ ] **Step 4: Verify structure with 3 characters**

Create a 3-character conversation, run 6 turns. Confirm each character responds in their own voice with no cross-character reasoning leakage.

- [ ] **Step 5: Commit verification note**

```bash
git commit --allow-empty -m "chore: verified implicit caching restructure end-to-end"
```
