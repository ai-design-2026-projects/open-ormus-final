# Refine Character Dialogue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two dialogue quality issues: characters ignoring the scene prompt, and characters producing generic non-reactive messages instead of directly engaging with each other.

**Architecture:** Three surgical changes — add `sceneContext` and `lastSpeakerName` params to `buildCharacterMessages` so every continuation prompt includes the scene and an engagement cue; update the call site in `next.ts` to pass those values; add a `## Engagement` section to the character system-prompt template instructing direct address and reactivity.

**Tech Stack:** TypeScript, Bun test, Handlebars (`.hbs`), Next.js App Router

---

## File Map

| File | Change |
|------|--------|
| `frontend/lib/conversation/build-messages.ts` | Add `sceneContext` + `lastSpeakerName` params; inject scene and engagement cue into continuation prompt |
| `frontend/lib/__tests__/build-messages.test.ts` | Update all existing calls to new 5-arg signature; add 3 new tests |
| `frontend/lib/conversation/next.ts` | Derive `lastSpeakerName`; pass `conversation.context` and `lastSpeakerName` to `buildCharacterMessages` |
| `frontend/lib/prompts/character-roleplay.hbs` | Add `## Engagement` block inside `{{#if otherParticipants}}` |
| `frontend/lib/prompts/__tests__/index.test.ts` | Add 3 tests: Engagement present/absent, ordering |

---

## Task 1: Update `build-messages.ts` — scene + engagement (TDD)

**Files:**
- Modify: `frontend/lib/__tests__/build-messages.test.ts`
- Modify: `frontend/lib/conversation/build-messages.ts`

- [ ] **Step 1: Add failing tests**

Append these three tests to the existing `describe("buildCharacterMessages")` block in `frontend/lib/__tests__/build-messages.test.ts`. Do NOT remove or change any existing tests yet.

```typescript
  test("scene context appears in the continuation prompt", () => {
    const result = buildCharacterMessages([], "a", "Alice", "A rainy street corner.", null);
    const last = result[result.length - 1]!;
    expect(last.content).toContain("Scene: A rainy street corner.");
  });

  test("engagement cue present when lastSpeakerName is not null", () => {
    const history = [msg("b", "Bob", "Hello there.")];
    const result = buildCharacterMessages(history, "a", "Alice", "Test scene.", "Bob");
    const last = result[result.length - 1]!;
    expect(last.content).toContain("React to what was just said or address someone directly.");
  });

  test("no engagement cue when lastSpeakerName is null", () => {
    const result = buildCharacterMessages([], "a", "Alice", "Test scene.", null);
    const last = result[result.length - 1]!;
    expect(last.content).not.toContain("React to what was just said");
  });
```

- [ ] **Step 2: Run tests — verify new tests fail**

```bash
bun test frontend/lib/__tests__/build-messages.test.ts
```

Expected: existing 10 tests pass, 3 new tests fail (wrong arg count / TypeScript error).

- [ ] **Step 3: Implement changes in `build-messages.ts`**

Replace the entire file with:

```typescript
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
  sceneContext: string,
  lastSpeakerName: string | null,
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

  const engagementCue =
    lastSpeakerName !== null
      ? "React to what was just said or address someone directly. "
      : "";
  const continuePrompt = `Scene: ${sceneContext}\nContinue as ${speakingCharacterName}. ${engagementCue}Write only their next line.`;
  result.push({ role: "user", content: `${contextLines}\n\n${continuePrompt}` });

  return result;
}
```

- [ ] **Step 4: Update existing test calls to 5-arg signature**

In `frontend/lib/__tests__/build-messages.test.ts`, update every call to `buildCharacterMessages` that uses the old 3-arg form. Add `"Test scene."` as the 4th arg and `null` as the 5th arg to all existing tests (the 3 new tests already use the correct signature).

Find all occurrences of `buildCharacterMessages(` in the file and add the two new trailing args:

- `buildCharacterMessages([], "a", "Alice")` → `buildCharacterMessages([], "a", "Alice", "Test scene.", null)`
- `buildCharacterMessages(history, "a", "Alice")` → `buildCharacterMessages(history, "a", "Alice", "Test scene.", null)`

There are 8 occurrences across the existing tests. Update all of them.

- [ ] **Step 5: Run all tests — verify all 13 pass**

```bash
bun test frontend/lib/__tests__/build-messages.test.ts
```

Expected output:
```
 13 pass
 0 fail
```

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/conversation/build-messages.ts frontend/lib/__tests__/build-messages.test.ts
git commit -m "feat: inject scene context and engagement cue into continuation prompt"
```

---

## Task 2: Wire new params in `next.ts`

**Files:**
- Modify: `frontend/lib/conversation/next.ts:105-109`

- [ ] **Step 1: Update the call site**

In `frontend/lib/conversation/next.ts`, find the block starting at line 105:

```typescript
  const contentMessages = buildCharacterMessages(
    conversation.messages,
    nextParticipant.characterId,
    nextParticipant.character.name,
  );
```

Replace with:

```typescript
  const lastSpeakerName = conversation.messages.at(-1)?.character.name ?? null;

  const contentMessages = buildCharacterMessages(
    conversation.messages,
    nextParticipant.characterId,
    nextParticipant.character.name,
    conversation.context,
    lastSpeakerName,
  );
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/conversation/next.ts
git commit -m "feat: pass scene context and last speaker to buildCharacterMessages"
```

---

## Task 3: Add `## Engagement` to HBS template (TDD)

**Files:**
- Modify: `frontend/lib/prompts/__tests__/index.test.ts`
- Modify: `frontend/lib/prompts/character-roleplay.hbs`

- [ ] **Step 1: Add failing tests**

Append to the `describe("buildCharacterPrompt — cast and format")` block in `frontend/lib/prompts/__tests__/index.test.ts`:

```typescript
  test("includes Engagement section when other participants provided", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.", ["Jesse Pinkman"]);
    expect(result).toContain("## Engagement");
    expect(result).toContain("React directly to what the last speaker said");
  });

  test("omits Engagement section when no other participants", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.");
    expect(result).not.toContain("## Engagement");
  });

  test("Engagement appears after Scene Cast and before Scene when participants provided", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.", ["Jesse Pinkman"]);
    const idx = (s: string) => result.indexOf(s);
    expect(idx("## Scene Cast")).toBeLessThan(idx("## Engagement"));
    expect(idx("## Engagement")).toBeLessThan(idx("## Scene"));
  });
```

- [ ] **Step 2: Run tests — verify new tests fail**

```bash
bun test frontend/lib/prompts/__tests__/index.test.ts
```

Expected: 15 existing tests pass, 3 new tests fail (`## Engagement` not found).

- [ ] **Step 3: Update `character-roleplay.hbs`**

In `frontend/lib/prompts/character-roleplay.hbs`, find the `{{#if otherParticipants}}` block (lines 73–76):

```handlebars
{{#if otherParticipants}}
## Scene Cast
You are sharing this scene with: {{otherParticipants}}.
{{/if}}
```

Replace with:

```handlebars
{{#if otherParticipants}}
## Scene Cast
You are sharing this scene with: {{otherParticipants}}.

## Engagement
- React directly to what the last speaker said — don't deliver standalone monologues
- Address specific characters by name when natural (e.g. "Walter, what do you think?")
- Ask questions, challenge, invite response — make others speak
{{/if}}
```

- [ ] **Step 4: Run all prompt tests — verify all 18 pass**

```bash
bun test frontend/lib/prompts/__tests__/index.test.ts
```

Expected output:
```
 18 pass
 0 fail
```

- [ ] **Step 5: Run full typecheck and all frontend tests**

```bash
bun run typecheck && bun test frontend/lib/__tests__/build-messages.test.ts frontend/lib/prompts/__tests__/index.test.ts
```

Expected: no type errors, 31 tests pass (13 + 18).

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/prompts/character-roleplay.hbs frontend/lib/prompts/__tests__/index.test.ts
git commit -m "feat: add engagement instructions to character system prompt"
```
