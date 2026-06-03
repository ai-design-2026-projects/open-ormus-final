# Enforce English-Only Generated Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Force all generated/persisted text (character personality, story, roleplay turns, scene context) to be written in English, while users may still interact in any language.

**Architecture:** Prompt-layer only. Append an English-output instruction to each of the four LLM prompt sites that produce persisted text. No schema, parser, data-model, or UI changes. Regression tests assert the instruction is present wherever the string is exported and unit-testable.

**Tech Stack:** TypeScript (strict), Bun test, Handlebars (`.hbs` prompt template), OpenAI-compatible SDK.

Spec: `docs/superpowers/specs/2026-06-03-enforce-english-data-design.md`

---

## File Structure

- Modify: `frontend/lib/prompts/character-roleplay.hbs` — roleplay output rule
- Test: `frontend/lib/prompts/__tests__/index.test.ts` — assert rule rendered (existing file)
- Modify: `frontend/lib/agent/prompt.ts` — `AGENT_SYSTEM_PROMPT` rule
- Create: `frontend/lib/agent/__tests__/prompt.test.ts` — assert agent rule present
- Modify: `packages/shared/tool-descriptions.ts` — `character_create`, `character_update` rule
- Create: `packages/shared/tool-descriptions.test.ts` — assert tool descriptions mention English
- Modify: `packages/shared/services/character_search.service.ts` — 3 research prompts (edit + typecheck; consts are module-private, no unit test)
- Modify: `frontend/app/api/conversations/improve-context/route.ts` — `SYSTEM_PROMPT` rule (edit + typecheck; not exported, no unit test)

---

### Task 1: Roleplay output — always English

**Files:**
- Modify: `frontend/lib/prompts/character-roleplay.hbs` (Instructions section, around line 64-72)
- Test: `frontend/lib/prompts/__tests__/index.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the first `describe("buildCharacterPrompt", ...)` block in `frontend/lib/prompts/__tests__/index.test.ts`:

```typescript
  test("instructs the character to always respond in English", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.");
    expect(result).toContain("Always respond in English");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test frontend/lib/prompts/__tests__/index.test.ts -t "always respond in English"`
Expected: FAIL — `expect(received).toContain("Always respond in English")`, string not present.

- [ ] **Step 3: Add the rule to the template**

In `frontend/lib/prompts/character-roleplay.hbs`, in the `## Instructions` bullet list (after the existing `- Maintain continuity with the conversation history.` line, line 71), add:

```handlebars
- Always respond in English — dialogue, the `<|reasoning|>` block, and the emotion subtext — regardless of the language the user writes in. The user may write in any language; understand it, but always reply in English.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test frontend/lib/prompts/__tests__/index.test.ts`
Expected: PASS — all tests in file (new one + existing) green.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/prompts/character-roleplay.hbs frontend/lib/prompts/__tests__/index.test.ts
git commit -m "feat: enforce English-only roleplay output"
```

---

### Task 2: Assistant agent — store character data in English

**Files:**
- Modify: `frontend/lib/agent/prompt.ts`
- Create: `frontend/lib/agent/__tests__/prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/lib/agent/__tests__/prompt.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { AGENT_SYSTEM_PROMPT } from "../prompt";

describe("AGENT_SYSTEM_PROMPT", () => {
  test("requires character data to be stored in English", () => {
    expect(AGENT_SYSTEM_PROMPT).toContain("stored in English");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test frontend/lib/agent/__tests__/prompt.test.ts`
Expected: FAIL — `expect(received).toContain("stored in English")`, not present.

- [ ] **Step 3: Add the rule to the prompt**

In `frontend/lib/agent/prompt.ts`, add a bullet to the `## Rules` list (after the existing last bullet about concise responses):

```typescript
- All character data is stored in English. If the user provides details in another language, translate them to English before calling character_create or character_update.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test frontend/lib/agent/__tests__/prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/agent/prompt.ts frontend/lib/agent/__tests__/prompt.test.ts
git commit -m "feat: agent stores character data in English"
```

---

### Task 3: Tool descriptions — English at call time

**Files:**
- Modify: `packages/shared/tool-descriptions.ts` (`character_create` ~line 17-25, `character_update` ~line 36-39)
- Create: `packages/shared/tool-descriptions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tool-descriptions.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { TOOL_DESCRIPTIONS } from "./tool-descriptions";

describe("TOOL_DESCRIPTIONS", () => {
  test("character_create requires English fields", () => {
    expect(TOOL_DESCRIPTIONS.character_create).toContain("English");
  });
  test("character_update requires English fields", () => {
    expect(TOOL_DESCRIPTIONS.character_update).toContain("English");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/shared/tool-descriptions.test.ts`
Expected: FAIL — neither description contains "English".

- [ ] **Step 3: Add the clause to both descriptions**

In `packages/shared/tool-descriptions.ts`, append to the `character_create` string (after `"Returns the saved character with its assigned ID."`):

```typescript
    "All fields must be in English; translate any non-English input before saving.",
```

Append to the `character_update` string (after `"Replaces the entire sheet — include all fields, not just the changed ones."`):

```typescript
    " All fields must be in English; translate any non-English input before saving.",
```

(Note: `character_create` uses one string per line concatenated — add as a new concatenated line. `character_update`'s final line ends without a trailing space, so prefix the appended clause with a space as shown.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/shared/tool-descriptions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/tool-descriptions.ts packages/shared/tool-descriptions.test.ts
git commit -m "feat: tool descriptions require English fields"
```

---

### Task 4: Character research prompts — English output

**Files:**
- Modify: `packages/shared/services/character_search.service.ts` (`BASICS_SYSTEM_PROMPT` ~line 128, `PERSONALITY_SYSTEM_PROMPT` ~line 136, `CONNECTIONS_SYSTEM_PROMPT` ~line 142)

No unit test: these constants are module-private and consumed only through Exa network calls (mocked in the existing service test). Adding an export solely to assert a substring is not warranted. Verified by typecheck + manual run.

- [ ] **Step 1: Append the English clause to each of the three prompts**

In `packages/shared/services/character_search.service.ts`, append to the end of each string literal (`BASICS_SYSTEM_PROMPT`, `PERSONALITY_SYSTEM_PROMPT`, `CONNECTIONS_SYSTEM_PROMPT`) this sentence (mind the leading space so it joins cleanly to the existing trailing text):

```typescript
" Write all output fields in English, regardless of the source material's language."
```

For each, this becomes an added concatenation line, e.g. for `BASICS_SYSTEM_PROMPT`:

```typescript
const BASICS_SYSTEM_PROMPT =
  "You are a fictional character analyst. Given a search query identifying a fictional character " +
  // ...existing lines unchanged...
  "If the first appearance date is unknown, return null for firstAppearanceDate." +
  " Write all output fields in English, regardless of the source material's language.";
```

Apply the same trailing `+ " Write all output fields in English, regardless of the source material's language."` to `PERSONALITY_SYSTEM_PROMPT` and `CONNECTIONS_SYSTEM_PROMPT`.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS (no type errors).

- [ ] **Step 3: Run the service test to confirm no regression**

Run: `bun test packages/shared/services/character_search.service.test.ts`
Expected: PASS (mocked-Exa tests unaffected by prompt text).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/services/character_search.service.ts
git commit -m "feat: research prompts emit English fields"
```

---

### Task 5: Scene context generation — English output

**Files:**
- Modify: `frontend/app/api/conversations/improve-context/route.ts` (`SYSTEM_PROMPT`, the `Rules:` list)

No unit test: `SYSTEM_PROMPT` is a route-local const, not exported. Verified by typecheck + manual run.

- [ ] **Step 1: Add the English rule**

In `frontend/app/api/conversations/improve-context/route.ts`, add a bullet to the `Rules:` list in `SYSTEM_PROMPT` (after the `- Output ONLY the improved text — no explanation, no preamble, no quotes` line):

```
- Always write the improved scene context in English, regardless of the draft's language
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/api/conversations/improve-context/route.ts
git commit -m "feat: scene context generated in English"
```

---

### Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck all workspaces**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 2: Run mcp_server tests**

Run: `bun test --cwd mcp_server`
Expected: PASS (registry/tool tests green).

- [ ] **Step 3: Run frontend + shared prompt tests**

Run: `bun test frontend/lib/prompts/__tests__/index.test.ts frontend/lib/agent/__tests__/prompt.test.ts packages/shared/tool-descriptions.test.ts packages/shared/services/character_search.service.test.ts`
Expected: PASS.

- [ ] **Step 4: Build frontend**

Run: `bun run build`
Expected: build succeeds.
