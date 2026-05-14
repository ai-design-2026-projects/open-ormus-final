# Prompt Template System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw JSON character sheet injection in the conversation route with a structured Handlebars template that guides the LLM toward full character coherence (psychology, speech, knowledge, physical presence).

**Architecture:** A `frontend/lib/prompts/` module compiles a `.hbs` template once at module load and exports a single `buildCharacterPrompt(sheet, sceneContext)` function. The route drops its 4-line prompt construction and calls this function instead. Handlebars helpers handle `Record<string, string>` formatting.

**Tech Stack:** Handlebars (new dep, needs approval), Bun test (built-in), TypeScript strict, `@open-ormus/shared` for `CharacterSearchResult` type.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/lib/prompts/helpers.ts` | Create | Register `formatRecord` Handlebars helper |
| `frontend/lib/prompts/character-roleplay.hbs` | Create | Handlebars system prompt template |
| `frontend/lib/prompts/index.ts` | Create | Compile template, export `buildCharacterPrompt` |
| `frontend/lib/prompts/__tests__/helpers.test.ts` | Create | Unit tests for `formatRecord` |
| `frontend/lib/prompts/__tests__/index.test.ts` | Create | Unit tests for `buildCharacterPrompt` |
| `frontend/app/api/conversations/[id]/next/route.ts` | Modify | Use `buildCharacterPrompt`, parse sheet with Zod |
| `frontend/package.json` | Modify | Add `handlebars` dependency |

---

## Task 1: Add Handlebars dependency

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Request approval and install**

Ask the user for approval, then run:

```bash
bun add handlebars --cwd frontend
```

Expected output: `handlebars` appears in `frontend/package.json` dependencies.

- [ ] **Step 2: Verify types are available**

```bash
bun run --cwd frontend tsc --noEmit 2>&1 | grep -i handlebars || echo "No Handlebars type errors"
```

If Handlebars types are missing, install them:

```bash
bun add -d @types/handlebars --cwd frontend
```

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/bun.lock
git commit -m "chore: add handlebars to frontend dependencies"
```

---

## Task 2: Create `helpers.ts` with `formatRecord`

**Files:**
- Create: `frontend/lib/prompts/helpers.ts`
- Create: `frontend/lib/prompts/__tests__/helpers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/lib/prompts/__tests__/helpers.test.ts`:

```typescript
import { describe, expect, test, beforeAll } from "bun:test";
import Handlebars from "handlebars";
import "../helpers"; // side-effect: registers helpers

describe("formatRecord helper", () => {
  test("formats a non-empty record into bullet lines", () => {
    const tmpl = Handlebars.compile("{{formatRecord data}}");
    const result = tmpl({ data: { fighting: "expert", hacking: "intermediate" } });
    expect(result).toBe("- fighting: expert\n- hacking: intermediate");
  });

  test("returns empty string for empty record", () => {
    const tmpl = Handlebars.compile("{{formatRecord data}}");
    const result = tmpl({ data: {} });
    expect(result).toBe("");
  });

  test("returns empty string for undefined", () => {
    const tmpl = Handlebars.compile("{{formatRecord data}}");
    const result = tmpl({});
    expect(result).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test --cwd frontend lib/prompts/__tests__/helpers.test.ts
```

Expected: FAIL — `helpers` module not found.

- [ ] **Step 3: Implement `helpers.ts`**

Create `frontend/lib/prompts/helpers.ts`:

```typescript
import Handlebars from "handlebars";

Handlebars.registerHelper(
  "formatRecord",
  (record: Record<string, string> | undefined) => {
    if (!record || Object.keys(record).length === 0) return "";
    return Object.entries(record)
      .map(([key, value]) => `- ${key}: ${value}`)
      .join("\n");
  }
);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test --cwd frontend lib/prompts/__tests__/helpers.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/prompts/helpers.ts frontend/lib/prompts/__tests__/helpers.test.ts
git commit -m "feat: add formatRecord Handlebars helper"
```

---

## Task 3: Create `character-roleplay.hbs` template

**Files:**
- Create: `frontend/lib/prompts/character-roleplay.hbs`

Note: this file is read at runtime via `fs.readFileSync`. No compilation step needed.

- [ ] **Step 1: Create the template file**

Create `frontend/lib/prompts/character-roleplay.hbs`:

```handlebars
You are {{name}}. Stay in character at all times — never break the fourth wall, never acknowledge being an AI or a fictional character.

## Identity
{{shortDescription}}

{{#if backstory}}
### Backstory
{{backstory}}
{{/if}}

## Personality
{{#if personalityTraits.length}}
{{#each personalityTraits}}- {{this}}
{{/each}}
{{/if}}

## Psychology
**What you value:** {{#each values}}"{{this}}"{{#unless @last}}, {{/unless}}{{/each}}
**What you fear:** {{#each fears}}"{{this}}"{{#unless @last}}, {{/unless}}{{/each}}
**What you want:** {{#each goals}}"{{this}}"{{#unless @last}}, {{/unless}}{{/each}}
**How you cope:** {{#each copingStyle}}{{this}}{{#unless @last}}; {{/unless}}{{/each}}

Every response must reflect this psychology. Your fears influence your reactions, your goals drive your choices, your values set your limits.

## How You Speak
{{#each speechPatterns}}- {{this}}
{{/each}}
{{#if notableQuotes.length}}
**Your words, verbatim:**
{{#each notableQuotes}}- "{{this}}"
{{/each}}
{{/if}}
Match this voice exactly. Do not adopt a generic or neutral tone.

## What You Know
{{formatRecord knowledgeScope}}
Speak only from within this knowledge. If asked about something outside it, respond as your character would — with ignorance, deflection, or your characteristic reaction — never with omniscience.

## Your Relationships
{{formatRecord relationships}}

## Your Abilities
{{#each abilities}}- {{this}}
{{/each}}

## Instructions
- Write only {{name}}'s next line of dialogue or action.
- No name prefix. No narrator voice. No meta-commentary.
- You may include brief physical action descriptions in *italics* (e.g. *crosses arms slowly*, *glances toward the door*). Actions must be consistent with {{name}}'s physical build, abilities, and characteristic mannerisms as described in Identity and Abilities above.
- Let psychology drive subtext: what {{name}} says and what {{name}} means may differ.
- Maintain continuity with the conversation history above.

## Scene
{{sceneContext}}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/lib/prompts/character-roleplay.hbs
git commit -m "feat: add character roleplay Handlebars template"
```

---

## Task 4: Create `index.ts` with `buildCharacterPrompt`

**Files:**
- Create: `frontend/lib/prompts/index.ts`
- Create: `frontend/lib/prompts/__tests__/index.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/lib/prompts/__tests__/index.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { buildCharacterPrompt } from "../index";
import type { CharacterSearchResult } from "@open-ormus/shared";

const mockSheet: CharacterSearchResult = {
  name: "Walter White",
  imageUrl: null,
  shortDescription: "A 50-year-old high school chemistry teacher, lean and intense, with a shaved head and a goatee.",
  firstAppearanceDate: "2008-01-20",
  confidence: 3,
  personality: {
    personalityTraits: ["methodical", "prideful", "brilliant"],
    backstory: "A chemistry genius who turned to manufacturing methamphetamine after a terminal cancer diagnosis.",
    relationships: { "Jesse Pinkman": "former student, business partner", "Skyler White": "estranged wife" },
    speechPatterns: ["precise and measured", "rarely uses slang", "speaks with authority"],
    values: ["pride", "legacy", "control"],
    fears: ["dying without meaning", "being seen as weak"],
    goals: ["build an empire", "provide for his family"],
    notableQuotes: ["I am the one who knocks.", "Say my name."],
    abilities: ["advanced chemistry", "strategic thinking", "manipulating others"],
    copingStyle: ["rationalisation", "dominance assertion"],
    knowledgeScope: {
      chemistry: "expert-level, specialised in methamphetamine synthesis",
      "street life": "learned through experience, still has gaps",
    },
  },
};

describe("buildCharacterPrompt", () => {
  test("includes the character name in the output", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting in a parking lot.");
    expect(result).toContain("Walter White");
  });

  test("includes values in the psychology section", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.");
    expect(result).toContain("pride");
    expect(result).toContain("legacy");
  });

  test("includes speech patterns", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.");
    expect(result).toContain("precise and measured");
  });

  test("includes a notable quote verbatim", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.");
    expect(result).toContain("I am the one who knocks.");
  });

  test("formats knowledgeScope as bullet lines", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.");
    expect(result).toContain("- chemistry: expert-level");
  });

  test("includes the scene context", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting in a parking lot.");
    expect(result).toContain("A tense meeting in a parking lot.");
  });

  test("includes physical action instruction", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.");
    expect(result).toContain("italics");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test --cwd frontend lib/prompts/__tests__/index.test.ts
```

Expected: FAIL — `index` module not found.

- [ ] **Step 3: Implement `index.ts`**

Create `frontend/lib/prompts/index.ts`:

```typescript
import Handlebars from "handlebars";
import { readFileSync } from "fs";
import { join } from "path";
import "./helpers";
import type { CharacterSearchResult } from "@open-ormus/shared";

const templateSource = readFileSync(
  join(process.cwd(), "lib/prompts/character-roleplay.hbs"),
  "utf-8"
);
const template = Handlebars.compile(templateSource);

export function buildCharacterPrompt(
  sheet: CharacterSearchResult,
  sceneContext: string
): string {
  return template({
    name: sheet.name,
    shortDescription: sheet.shortDescription,
    ...sheet.personality,
    sceneContext,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test --cwd frontend lib/prompts/__tests__/index.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 5: Type-check**

```bash
bun run --cwd frontend tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/prompts/index.ts frontend/lib/prompts/__tests__/index.test.ts
git commit -m "feat: add buildCharacterPrompt with Handlebars template"
```

---

## Task 5: Update `route.ts` to use `buildCharacterPrompt`

**Files:**
- Modify: `frontend/app/api/conversations/[id]/next/route.ts`

- [ ] **Step 1: Replace the inline prompt construction**

In `frontend/app/api/conversations/[id]/next/route.ts`, make these two changes:

**Add import** at the top of the file (after the existing imports):

```typescript
import { buildCharacterPrompt } from "@/lib/prompts";
import { CharacterSearchResultSchema } from "@open-ormus/shared";
```

**Replace** the `systemPrompt` block (lines ~58-63):

```typescript
// REMOVE this:
const systemPrompt = [
  `You are ${nextParticipant.character.name}.`,
  `Your character sheet: ${JSON.stringify(nextParticipant.character.sheet)}`,
  `Scene context: ${conversation.context}`,
  `Respond only as ${nextParticipant.character.name}. Write only the character's next line of dialogue or action. Do not include a name prefix.`,
].join("\n\n");

// ADD this:
const sheet = CharacterSearchResultSchema.parse(nextParticipant.character.sheet);
const systemPrompt = buildCharacterPrompt(sheet, conversation.context);
```

- [ ] **Step 2: Type-check**

```bash
bun run --cwd frontend tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/api/conversations/[id]/next/route.ts
git commit -m "feat: use buildCharacterPrompt in conversation route"
```

---

## Task 6: Smoke test

**No automated test here — manual verification that the route returns sensible output.**

- [ ] **Step 1: Start the dev server**

```bash
bun run dev:frontend
```

Expected: Next.js starts on port 3000 without errors.

- [ ] **Step 2: Verify the template file is found**

If the server throws `ENOENT: no such file or directory, open '.../character-roleplay.hbs'`, the working directory is not `frontend/`. Fix by using an absolute path in `index.ts`:

```typescript
// Replace:
join(process.cwd(), "lib/prompts/character-roleplay.hbs")

// With:
join(import.meta.dirname, "character-roleplay.hbs")
```

`import.meta.dirname` is the directory of the compiled source file, which in Next.js dev mode points to the source directory directly.

- [ ] **Step 3: Trigger the conversation route**

Open a conversation in the UI and send a turn. Inspect the LLM response to verify it:
- Uses the character's name (not "I" without context)
- Matches the character's speech patterns
- Does not use JSON dump language ("According to my character sheet...")

- [ ] **Step 4: Final commit (if Step 2 fix was needed)**

```bash
git add frontend/lib/prompts/index.ts
git commit -m "fix: use import.meta.dirname for reliable .hbs file path"
```
