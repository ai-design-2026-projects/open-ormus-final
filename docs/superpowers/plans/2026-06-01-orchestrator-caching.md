# Orchestrator Caching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `selectNextSpeakerWithOrchestrator` to use a multi-turn message structure so that implicit prefix caching fires on system prompt + prior decision pairs, making cost scale with one new user message per turn rather than full conversation history.

**Architecture:** Extract a pure `buildOrchestratorMessages` function (mirrors `buildCharacterMessages`) that reconstructs the orchestrator's historical message pairs from `conversation.messages`. The orchestrator rebuilds this array from the DB on every call — no new state, no schema change. `selectNextSpeakerWithOrchestrator` is updated to use the returned messages array instead of a single flat user message.

**Tech Stack:** TypeScript, OpenAI SDK (`ChatCompletionMessageParam`), Bun test runner.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/lib/conversation/build-orchestrator-messages.ts` | **Create** | Pure function: build system prompt + messages array |
| `frontend/lib/__tests__/build-orchestrator-messages.test.ts` | **Create** | Unit tests for the pure function |
| `frontend/lib/orchestrator.ts` | **Modify** | Use `buildOrchestratorMessages`; update types |

---

## Task 1: Create `buildOrchestratorMessages` with failing tests

**Files:**
- Create: `frontend/lib/__tests__/build-orchestrator-messages.test.ts`
- Create: `frontend/lib/conversation/build-orchestrator-messages.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/lib/__tests__/build-orchestrator-messages.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import {
  buildOrchestratorSystemPrompt,
  buildOrchestratorMessages,
} from "../conversation/build-orchestrator-messages";

type Participant = { characterId: string; character: { name: string } };
type Msg = {
  characterId: string;
  character: { name: string };
  content: string;
  reasoning: string | null;
};

const p = (id: string, name: string): Participant => ({
  characterId: id,
  character: { name },
});

const m = (
  characterId: string,
  name: string,
  content: string,
  reasoning: string | null = null,
): Msg => ({ characterId, character: { name }, content, reasoning });

const PARTICIPANTS = [p("id-a", "Alice"), p("id-b", "Bob")];

describe("buildOrchestratorSystemPrompt", () => {
  test("contains character ids and names", () => {
    const prompt = buildOrchestratorSystemPrompt(PARTICIPANTS);
    expect(prompt).toContain("id-a");
    expect(prompt).toContain("Alice");
    expect(prompt).toContain("id-b");
    expect(prompt).toContain("Bob");
  });

  test("does not contain sheets or extra character data", () => {
    const prompt = buildOrchestratorSystemPrompt(PARTICIPANTS);
    expect(prompt).not.toContain("sheet");
    expect(prompt).not.toContain("personality");
  });
});

describe("buildOrchestratorMessages", () => {
  test("empty messages — returns only scene-start user message", () => {
    const result = buildOrchestratorMessages([]);
    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe("user");
    expect(result[0]!.content as string).toContain("scene has just begun");
  });

  test("one message — scene-start + assistant + final user", () => {
    const result = buildOrchestratorMessages([m("id-a", "Alice", "Hello")]);
    expect(result).toHaveLength(3);
    expect(result[0]!.role).toBe("user");
    expect(result[0]!.content as string).toContain("scene has just begun");
    expect(result[1]!.role).toBe("assistant");
    expect(result[1]!.content).toBe("id-a");
    expect(result[2]!.role).toBe("user");
    expect(result[2]!.content as string).toContain("Alice");
    expect(result[2]!.content as string).toContain("Hello");
    expect(result[2]!.content as string).toContain("Who speaks next");
  });

  test("two messages — correct historical pairs and final user", () => {
    const result = buildOrchestratorMessages([
      m("id-a", "Alice", "Hello"),
      m("id-b", "Bob", "Hi there"),
    ]);
    // scene-start, asst(id-a), user(alice's line), asst(id-b), user(bob's line)
    expect(result).toHaveLength(5);
    expect(result[1]!.content).toBe("id-a");
    expect(result[2]!.content as string).toContain("Alice");
    expect(result[2]!.content as string).toContain("Hello");
    expect(result[3]!.content).toBe("id-b");
    expect(result[4]!.content as string).toContain("Bob");
    expect(result[4]!.content as string).toContain("Hi there");
  });

  test("reasoning null — no Private thoughts line in that turn", () => {
    const result = buildOrchestratorMessages([
      m("id-a", "Alice", "Hello", null),
      m("id-b", "Bob", "Hi"),
    ]);
    // user turn for Alice's line (index 2) should have no "Private thoughts"
    expect(result[2]!.content as string).not.toContain("Private thoughts");
  });

  test("reasoning present — Private thoughts line included in that turn", () => {
    const result = buildOrchestratorMessages([
      m("id-a", "Alice", "Hello", "I am nervous"),
      m("id-b", "Bob", "Hi"),
    ]);
    expect(result[2]!.content as string).toContain("Private thoughts");
    expect(result[2]!.content as string).toContain("I am nervous");
  });

  test("always starts with a user turn", () => {
    expect(buildOrchestratorMessages([])[0]!.role).toBe("user");
    expect(buildOrchestratorMessages([m("id-a", "Alice", "Hi")])[0]!.role).toBe("user");
  });

  test("always ends with a user turn", () => {
    const single = buildOrchestratorMessages([m("id-a", "Alice", "Hi")]);
    expect(single[single.length - 1]!.role).toBe("user");

    const two = buildOrchestratorMessages([
      m("id-a", "Alice", "Hi"),
      m("id-b", "Bob", "Hey"),
    ]);
    expect(two[two.length - 1]!.role).toBe("user");
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd frontend && bun test __tests__/build-orchestrator-messages.test.ts
```

Expected: error `Cannot find module '../conversation/build-orchestrator-messages'`.

- [ ] **Step 3: Create the implementation**

Create `frontend/lib/conversation/build-orchestrator-messages.ts`:

```ts
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export type OrchestratorParticipant = {
  characterId: string;
  character: { name: string };
};

export type OrchestratorMessage = {
  characterId: string;
  character: { name: string };
  content: string;
  reasoning: string | null;
};

const SCENE_START =
  "(The scene has just begun — no lines have been spoken yet.) Who should speak first? Reply with their characterId only.";
const WHO_NEXT = "Who speaks next? Reply with their characterId only.";

export function buildOrchestratorSystemPrompt(
  participants: OrchestratorParticipant[],
): string {
  const charactersList = participants
    .map((p) => `- id: ${p.characterId} | Name: ${p.character.name}`)
    .join("\n");

  return [
    "You are a conversation director for a multi-character roleplay scene.",
    "Given the conversation history below, decide which character should speak",
    "next to make the conversation feel natural and engaging.",
    "Reply with only the characterId of the chosen character, nothing else.",
    "",
    "Characters:",
    charactersList,
  ].join("\n");
}

function buildUserTurn(message: OrchestratorMessage): string {
  const lines: string[] = [`[${message.character.name}]: ${message.content}`];
  if (message.reasoning) {
    lines.push(`Private thoughts: ${message.reasoning}`);
  }
  lines.push(WHO_NEXT);
  return lines.join("\n");
}

export function buildOrchestratorMessages(
  messages: OrchestratorMessage[],
): ChatCompletionMessageParam[] {
  const result: ChatCompletionMessageParam[] = [];

  if (messages.length === 0) {
    result.push({ role: "user", content: SCENE_START });
    return result;
  }

  // Turn 0: scene start → first speaker
  result.push({ role: "user", content: SCENE_START });
  result.push({ role: "assistant", content: messages[0]!.characterId });

  // Historical pairs: message[i] was spoken → messages[i+1].characterId was chosen next
  for (let i = 0; i < messages.length - 1; i++) {
    result.push({ role: "user", content: buildUserTurn(messages[i]!) });
    result.push({ role: "assistant", content: messages[i + 1]!.characterId });
  }

  // Final uncached user message — what the model must respond to now
  result.push({
    role: "user",
    content: buildUserTurn(messages[messages.length - 1]!),
  });

  return result;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd frontend && bun test __tests__/build-orchestrator-messages.test.ts
```

Expected: all tests pass, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/conversation/build-orchestrator-messages.ts \
        frontend/lib/__tests__/build-orchestrator-messages.test.ts
git commit -m "feat: add buildOrchestratorMessages pure function with tests"
```

---

## Task 2: Update `orchestrator.ts` to use multi-turn messages

**Files:**
- Modify: `frontend/lib/orchestrator.ts`

- [ ] **Step 1: Replace the file contents**

Replace `frontend/lib/orchestrator.ts` with:

```ts
import { createLLMClient } from "@/lib/llm-client";
import { logLlmUsage } from "@/lib/llm-usage";
import { LlmUsageSource } from "@/lib/generated/prisma/client";
import {
  buildOrchestratorSystemPrompt,
  buildOrchestratorMessages,
  type OrchestratorParticipant,
  type OrchestratorMessage,
} from "@/lib/conversation/build-orchestrator-messages";

export type { OrchestratorParticipant, OrchestratorMessage };

export async function selectNextSpeakerWithOrchestrator(
  participants: OrchestratorParticipant[],
  messages: OrchestratorMessage[],
  conversationId: string,
  userId: string,
): Promise<string> {
  const model = process.env["CONVERSATION_MODEL"];

  if (!model) {
    console.error("[orchestrator] CONVERSATION_MODEL env var not set");
    return fallback(participants, messages);
  }

  const systemPrompt = buildOrchestratorSystemPrompt(participants);
  const turnMessages = buildOrchestratorMessages(messages);

  const client = createLLMClient();
  const startTime = Date.now();

  type CompletionResponse = Awaited<ReturnType<typeof client.chat.completions.create>>;
  let response: CompletionResponse;
  let generationId: string;

  try {
    const { data, response: httpResponse } = await client.chat.completions
      .create({
        model,
        max_tokens: 64,
        messages: [{ role: "system", content: systemPrompt }, ...turnMessages],
      })
      .withResponse();
    response = data;
    generationId = httpResponse.headers.get("x-generation-id") ?? data.id;
  } catch (err) {
    console.error("[orchestrator] Error:", err);
    return fallback(participants, messages);
  }

  const cachedTokens = response.usage?.prompt_tokens_details?.cached_tokens;
  const reasoningTokens = response.usage?.completion_tokens_details?.reasoning_tokens;
  await logLlmUsage(
    { source: LlmUsageSource.ORCHESTRATOR, conversationId, userId },
    {
      generationId,
      model,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      ...(cachedTokens !== undefined ? { cachedTokens } : {}),
      ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
      latencyMs: Date.now() - startTime,
    },
  );

  const chosen = (response.choices[0]?.message.content ?? "").trim();

  if (participants.some((p) => p.characterId === chosen)) {
    return chosen;
  }

  console.error(`[orchestrator] Invalid characterId returned: "${chosen}"`);
  return fallback(participants, messages);
}

function fallback(
  participants: OrchestratorParticipant[],
  messages: OrchestratorMessage[],
): string {
  if (participants.length === 0)
    throw new Error("[orchestrator] fallback called with empty participants");
  const p = participants[messages.length % participants.length];
  if (p === undefined)
    throw new Error("[orchestrator] fallback index out of range");
  return p.characterId;
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
bun run typecheck
```

Expected: no errors. If `next.ts` passes `conversation.messages` (which includes `characterId` and `reasoning` as Prisma scalar fields), TypeScript structural typing accepts it against `OrchestratorMessage`. No changes to `next.ts` needed.

- [ ] **Step 3: Run all frontend tests**

```bash
cd frontend && bun test
```

Expected: all tests pass including the new `build-orchestrator-messages` suite.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/orchestrator.ts
git commit -m "feat: refactor orchestrator to multi-turn messages for prefix caching"
```
