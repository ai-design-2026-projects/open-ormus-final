# Group Chat Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For conversations with 3+ characters, replace the round-robin speaker selection with an LLM call that reads the full conversation history and character personalities to decide who speaks next.

**Architecture:** A new `frontend/lib/orchestrator.ts` exports `selectNextSpeakerWithOrchestrator()`, which builds a prompt from participants + message history, calls LiteLLM, validates the returned characterId, and falls back to round-robin on any error. The existing `next/route.ts` branches on `participants.length >= 3` before selecting the next speaker — everything downstream (character prompt, LLM call for the actual message, DB write) is unchanged.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, LiteLLM proxy (Anthropic Messages API shape), Prisma 7 (read-only in this feature)

> **Note on testing:** No test runner is wired up in this project (AGENTS.md §4). Verification steps use `bun run --cwd frontend tsc --noEmit` in place of unit tests.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `frontend/lib/orchestrator.ts` | `selectNextSpeakerWithOrchestrator()` + internal `fallback()` |
| Modify | `frontend/app/api/conversations/[id]/next/route.ts` | Branch on `participants.length >= 3` |

---

### Task 1: Create `frontend/lib/orchestrator.ts`

**Files:**
- Create: `frontend/lib/orchestrator.ts`

- [ ] **Step 1: Create the file with types and the exported function**

```typescript
// frontend/lib/orchestrator.ts

type OrchestratorParticipant = {
  characterId: string;
  character: { name: string; sheet: unknown };
};

type OrchestratorMessage = {
  characterId: string;
  character: { name: string };
  content: string;
};

export async function selectNextSpeakerWithOrchestrator(
  participants: OrchestratorParticipant[],
  messages: OrchestratorMessage[]
): Promise<string> {
  const model = process.env["CONVERSATION_MODEL"];
  const baseUrl = process.env["ANTHROPIC_BASE_URL"] ?? "http://localhost:4000";
  const apiKey = process.env["ANTHROPIC_API_KEY"] ?? "";

  const charactersList = participants
    .map(
      (p) =>
        `- id: ${p.characterId} | Name: ${p.character.name}` +
        (p.character.sheet != null
          ? ` | Personality: ${JSON.stringify(p.character.sheet)}`
          : "")
    )
    .join("\n");

  const historyText =
    messages.length > 0
      ? messages.map((m) => `[${m.character.name}]: ${m.content}`).join("\n")
      : "(The scene has just begun — no lines have been spoken yet.)";

  const userMessage = [
    "Characters:",
    charactersList,
    "",
    "Conversation so far:",
    historyText,
    "",
    "Which character should speak next? Reply with their characterId only.",
  ].join("\n");

  try {
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 64,
        system:
          "You are a conversation director for a multi-character roleplay scene. " +
          "Given the characters and conversation history below, decide which character " +
          "should speak next to make the conversation feel natural and engaging. " +
          "Reply with only the characterId of the chosen character, nothing else.",
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      console.error(`[orchestrator] LiteLLM error: ${response.status}`);
      return fallback(participants, messages);
    }

    const completion = (await response.json()) as {
      content: { type: string; text: string }[];
    };

    const chosen =
      completion.content.find((b) => b.type === "text")?.text?.trim() ?? "";

    if (participants.some((p) => p.characterId === chosen)) {
      return chosen;
    }

    console.error(`[orchestrator] Invalid characterId returned: "${chosen}"`);
    return fallback(participants, messages);
  } catch (err) {
    console.error("[orchestrator] Error:", err);
    return fallback(participants, messages);
  }
}

function fallback(
  participants: OrchestratorParticipant[],
  messages: OrchestratorMessage[]
): string {
  return participants[messages.length % participants.length]!.characterId;
}
```

- [ ] **Step 2: Type-check to verify no errors**

```bash
bun run --cwd frontend tsc --noEmit 2>&1
```

Expected: no new errors (only pre-existing errors in `proxy.ts` are acceptable).

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/orchestrator.ts
git commit -m "feat: add LLM orchestrator for group chat speaker selection"
```

---

### Task 2: Wire the orchestrator into `next/route.ts`

**Files:**
- Modify: `frontend/app/api/conversations/[id]/next/route.ts`

- [ ] **Step 1: Add the import at the top of the file**

Add after the existing imports (line 3):

```typescript
import { selectNextSpeakerWithOrchestrator } from "@/lib/orchestrator";
```

So the top of the file becomes:

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { selectNextSpeakerWithOrchestrator } from "@/lib/orchestrator";
```

- [ ] **Step 2: Replace the speaker selection block**

Find and replace the current round-robin selection (lines 49–56):

```typescript
// REMOVE this block:
const nextParticipant =
  conversation.participants[
    conversation.messages.length % conversation.participants.length
  ];

if (nextParticipant === undefined) {
  return NextResponse.json({ error: "Could not determine next speaker" }, { status: 500 });
}
```

Replace with:

```typescript
let nextParticipant: (typeof conversation.participants)[number];

if (conversation.participants.length >= 3) {
  const characterId = await selectNextSpeakerWithOrchestrator(
    conversation.participants,
    conversation.messages
  );
  nextParticipant =
    conversation.participants.find((p) => p.characterId === characterId) ??
    conversation.participants[
      conversation.messages.length % conversation.participants.length
    ]!;
} else {
  nextParticipant =
    conversation.participants[
      conversation.messages.length % conversation.participants.length
    ]!;
}
```

- [ ] **Step 3: Type-check to verify no errors**

```bash
bun run --cwd frontend tsc --noEmit 2>&1
```

Expected: no new errors beyond the pre-existing `proxy.ts` ones.

- [ ] **Step 4: Manual smoke test**

Start the frontend dev server:

```bash
bun run dev:frontend
```

1. Open a conversation with **2 characters** → click "Generate next" several times → verify the two characters alternate (round-robin unchanged).
2. Open a conversation with **3+ characters** → click "Generate next" several times → verify the speaker varies non-mechanically and feels contextually appropriate.
3. Check the terminal logs — if the orchestrator falls back for any reason, `[orchestrator]` error lines will appear.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/api/conversations/[id]/next/route.ts
git commit -m "feat: use LLM orchestrator for group chats with 3+ characters"
```
