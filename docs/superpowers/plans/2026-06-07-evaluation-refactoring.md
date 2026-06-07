# Evaluation Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `evaluation/` to eliminate ~700 lines of duplication, extract all LLM prompts to Handlebars templates, and unify the two segmenters — without changing any observable behaviour.

**Architecture:** New `evaluation/shared/` module holds generic utilities (`call.ts`, `segmenter.ts`, `loader.ts`, `constants.ts`). Each pass keeps its own `prompts/` subdirectory with `.hbs` files; `prompt.ts` becomes a thin compiler/renderer. All three `call.ts` files collapse to delegates of `shared/call.ts`.

**Tech Stack:** Bun ≥ 1.2, TypeScript strict, Handlebars ^4.7.9 (already in monorepo node_modules), OpenAI SDK, Zod, `yaml` package.

---

## File Map

**New files:**
- `evaluation/shared/constants.ts`
- `evaluation/shared/call.ts`
- `evaluation/shared/segmenter.ts`
- `evaluation/shared/loader.ts`
- `evaluation/shared/__tests__/constants.test.ts`
- `evaluation/shared/__tests__/segmenter.test.ts`
- `evaluation/judge/prompts/system.hbs`
- `evaluation/judge/prompts/user.hbs`
- `evaluation/reconstruct/prompts/reconstructor-system.hbs`
- `evaluation/reconstruct/prompts/reconstructor-user.hbs`
- `evaluation/reconstruct/prompts/comparator-system.hbs`
- `evaluation/reconstruct/prompts/comparator-user.hbs`
- `evaluation/drift/prompts/system.hbs`
- `evaluation/drift/prompts/user.hbs`

**Modified:**
- `evaluation/judge/schema.ts` — rename export
- `evaluation/judge/call.ts` — replace with delegate
- `evaluation/judge/prompt.ts` — replace with template compiler
- `evaluation/judge/pass.ts` — use shared/loader + shared/constants
- `evaluation/reconstruct/schema.ts` — remove unused param
- `evaluation/reconstruct/call.ts` — replace with delegate
- `evaluation/reconstruct/prompt.ts` — replace with template compiler
- `evaluation/reconstruct/pass.ts` — use shared/loader + shared/constants
- `evaluation/reconstruct/index.ts` — use shared/segmenter + split large function
- `evaluation/reconstruct/__tests__/segmenter.test.ts` — update import
- `evaluation/drift/schema.ts` — rename export
- `evaluation/drift/call.ts` — replace with delegate
- `evaluation/drift/prompt.ts` — replace with template compiler
- `evaluation/drift/pass.ts` — use shared/loader + shared/constants
- `evaluation/drift/index.ts` — use shared/segmenter
- `evaluation/cost/fetcher.ts` — use shared/constants

**Deleted:**
- `evaluation/reconstruct/segmenter.ts`
- `evaluation/drift/segment.ts`

---

## Task 1: `shared/constants.ts`

**Files:**
- Create: `evaluation/shared/__tests__/constants.test.ts`
- Create: `evaluation/shared/constants.ts`

- [ ] **Step 1: Write the failing test**

```ts
// evaluation/shared/__tests__/constants.test.ts
import { describe, test, expect } from "bun:test";
import { isSafePath, PASS_DIRS, DRIFT_THRESHOLD_DEGRADING, DRIFT_THRESHOLD_IMPROVING } from "../constants";

describe("isSafePath", () => {
  test("allows plain names", () => {
    expect(isSafePath("my-dataset")).toBe(true);
    expect(isSafePath("eval_01")).toBe(true);
  });
  test("rejects path traversal", () => {
    expect(isSafePath("../foo")).toBe(false);
    expect(isSafePath("a/b")).toBe(false);
    expect(isSafePath("a\\b")).toBe(false);
  });
});

describe("PASS_DIRS", () => {
  test("has all three passes", () => {
    expect(PASS_DIRS.judge).toBe("judge_guessing");
    expect(PASS_DIRS.reconstruct).toBe("reconstruct_persona");
    expect(PASS_DIRS.drift).toBe("context_drift");
  });
});

describe("drift thresholds", () => {
  test("degrading < improving", () => {
    expect(DRIFT_THRESHOLD_DEGRADING).toBeLessThan(0);
    expect(DRIFT_THRESHOLD_IMPROVING).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd /home/leo/Documents/open-ormus/.claude/worktrees/evaluation-refactoring
bun test evaluation/shared/__tests__/constants.test.ts
```

Expected: `Cannot find module '../constants'`

- [ ] **Step 3: Create `shared/constants.ts`**

```ts
// evaluation/shared/constants.ts
export const PASS_DIRS = {
  judge: "judge_guessing",
  reconstruct: "reconstruct_persona",
  drift: "context_drift",
} as const;

export const DRIFT_THRESHOLD_DEGRADING = -0.25;
export const DRIFT_THRESHOLD_IMPROVING = 0.25;

export const COST_RETRY_DELAYS_MS = [3000, 6000, 12000] as const;

export const EVAL_DIR_PAD = 2;
export const CONV_FILE_PAD = 3;

export function isSafePath(v: string): boolean {
  return !v.includes("/") && !v.includes("\\") && !v.includes("..");
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
bun test evaluation/shared/__tests__/constants.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add evaluation/shared/constants.ts evaluation/shared/__tests__/constants.test.ts
git commit -m "feat(eval): add shared/constants.ts with pass dirs, thresholds, helpers"
```

---

## Task 2: `shared/segmenter.ts`

**Files:**
- Create: `evaluation/shared/__tests__/segmenter.test.ts`
- Create: `evaluation/shared/segmenter.ts`

- [ ] **Step 1: Write the failing test** (same contract as current `reconstruct/segmenter.ts`)

```ts
// evaluation/shared/__tests__/segmenter.test.ts
import { describe, test, expect } from "bun:test";
import { segmentConversation } from "../segmenter";
import type { ConversationMessage } from "../../generator/conversation";

function makeMessages(count: number): ConversationMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    turn: i + 1,
    character_id: "char_001",
    character_name: "Alice",
    emotion: "neutral",
    intensity: "low",
    subtext: "",
    reasoning: null,
    content: `message ${i + 1}`,
  }));
}

describe("segmentConversation", () => {
  test("N=2 even: equal split", () => {
    const segs = segmentConversation(makeMessages(6), 2);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.messages).toHaveLength(3);
    expect(segs[1]!.messages).toHaveLength(3);
  });

  test("N=2 odd: last segment absorbs remainder", () => {
    const segs = segmentConversation(makeMessages(7), 2);
    expect(segs[0]!.messages).toHaveLength(3);
    expect(segs[1]!.messages).toHaveLength(4);
  });

  test("N=3: segment_index is 0-based", () => {
    const segs = segmentConversation(makeMessages(9), 3);
    expect(segs.map((s) => s.segment_index)).toEqual([0, 1, 2]);
  });

  test("N=3: turn_range is inclusive 1-based", () => {
    const segs = segmentConversation(makeMessages(9), 3);
    expect(segs[0]!.turn_range).toEqual([1, 3]);
    expect(segs[1]!.turn_range).toEqual([4, 6]);
    expect(segs[2]!.turn_range).toEqual([7, 9]);
  });

  test("empty messages returns empty array", () => {
    expect(segmentConversation([], 3)).toHaveLength(0);
  });

  test("N > messages.length: clamps to messages.length segments", () => {
    const segs = segmentConversation(makeMessages(5), 6);
    expect(segs).toHaveLength(5);
  });

  test("all messages are covered with no duplicates", () => {
    const segs = segmentConversation(makeMessages(10), 3);
    const allTurns = segs.flatMap((s) => s.messages.map((m) => m.turn));
    expect(allTurns).toHaveLength(10);
    expect(new Set(allTurns).size).toBe(10);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
bun test evaluation/shared/__tests__/segmenter.test.ts
```

Expected: `Cannot find module '../segmenter'`

- [ ] **Step 3: Create `shared/segmenter.ts`**

```ts
// evaluation/shared/segmenter.ts
import type { ConversationMessage } from "../generator/conversation";

export type Segment = {
  segment_index: number;
  turn_range: [number, number];
  messages: ConversationMessage[];
};

export function segmentConversation(
  messages: ConversationMessage[],
  n: number,
): Segment[] {
  if (messages.length === 0) return [];

  const effectiveN = Math.min(n, messages.length);
  const sliceSize = Math.floor(messages.length / effectiveN);
  const segments: Segment[] = [];

  for (let i = 0; i < effectiveN; i++) {
    const start = i * sliceSize;
    const end = i === effectiveN - 1 ? messages.length : start + sliceSize;
    const slice = messages.slice(start, end);
    segments.push({
      segment_index: i,
      turn_range: [slice[0]!.turn, slice[slice.length - 1]!.turn],
      messages: slice,
    });
  }

  return segments;
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
bun test evaluation/shared/__tests__/segmenter.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add evaluation/shared/segmenter.ts evaluation/shared/__tests__/segmenter.test.ts
git commit -m "feat(eval): add shared/segmenter.ts unifying reconstruct and drift segmenters"
```

---

## Task 3: `shared/call.ts`

**Files:**
- Create: `evaluation/shared/call.ts`

No unit tests here (requires mocking OpenAI). The existing per-pass tests serve as integration coverage.

- [ ] **Step 1: Create `shared/call.ts`**

```ts
// evaluation/shared/call.ts
import OpenAI from "openai";
import { parseJsonFromLlm } from "../utils";
import type { RawUsageMeta } from "../../packages/shared/conversation/types";

const MAX_RETRIES = 3;

export type ResponseFormat = { type: "json_object" };

export interface CallResult<T> {
  result: T;
  usage: RawUsageMeta | null;
}

export function formatRetryReason(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes("returned empty content")) return "empty response";

  if (msg.startsWith("JSON parse failed")) {
    const start = msg.indexOf("{");
    const preview = start >= 0 ? ` — ${msg.slice(start, start + 80)}…` : "";
    return `JSON parse${preview}`;
  }

  if (msg.trimStart().startsWith("[")) {
    try {
      const errors = JSON.parse(msg) as Array<{ message?: string }>;
      return `schema: ${errors.map((e) => e.message ?? "unknown").join("; ")}`;
    } catch {}
  }

  const firstLine = (msg.split("\n")[0] ?? msg).slice(0, 100);
  return firstLine.length < msg.length ? firstLine + "…" : firstLine;
}

export async function callWithRetry<T>(
  client: OpenAI,
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  responseFormat: ResponseFormat,
  parse: (raw: unknown) => T,
  label: string,
  log: (line: string) => void = (line) => process.stderr.write(line),
): Promise<CallResult<T>> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const startTime = Date.now();
      const { data: response, response: httpResponse } = await client.chat.completions
        .create({
          model,
          temperature: 0,
          stream: false,
          response_format: responseFormat,
          messages,
          extra_headers: {
            "HTTP-Referer": "https://openormus.app",
            "X-Title": "OpenOrmus",
          },
        })
        .withResponse();

      const raw = response.choices[0]?.message.content;
      if (!raw) throw new Error(`${label} returned empty content on attempt ${attempt}`);

      let parsed: unknown;
      try {
        parsed = parseJsonFromLlm(raw);
      } catch {
        throw new Error(`JSON parse failed. Raw response:\n${raw}`);
      }

      const result = parse(parsed);
      const generationId = httpResponse.headers.get("x-generation-id") ?? response.id;
      const usage: RawUsageMeta | null = response.usage
        ? {
            generationId,
            model,
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
            reasoningTokens: response.usage.completion_tokens_details?.reasoning_tokens ?? null,
            cachedTokens: response.usage.prompt_tokens_details?.cached_tokens ?? null,
            latencyMs: Date.now() - startTime,
          }
        : null;

      return { result, usage };
    } catch (err) {
      lastError = err;
      log(`attempt ${attempt}/${MAX_RETRIES}: ${formatRetryReason(err)}\n`);
    }
  }

  const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`[${label}] all ${MAX_RETRIES} attempts failed. Last error: ${errMsg}`);
}
```

- [ ] **Step 2: Commit**

```bash
git add evaluation/shared/call.ts
git commit -m "feat(eval): add shared/call.ts generic callWithRetry"
```

---

## Task 4: `shared/loader.ts`

**Files:**
- Create: `evaluation/shared/loader.ts`

- [ ] **Step 1: Create `shared/loader.ts`**

```ts
// evaluation/shared/loader.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ConversationResult } from "../generator/conversation";

export type ConversationEntry = {
  file: string;
  result: ConversationResult;
  i: number;
};

export function loadConversationEntries(conversationsDir: string): ConversationEntry[] {
  const files = readdirSync(conversationsDir)
    .filter((f) => f.endsWith(".yaml"))
    .sort();

  if (files.length === 0) {
    throw new Error(`No conversation YAML files found in ${conversationsDir}`);
  }

  return files.map((file, i) => ({
    file,
    result: parseYaml(readFileSync(join(conversationsDir, file), "utf-8")) as ConversationResult,
    i,
  }));
}
```

- [ ] **Step 2: Commit**

```bash
git add evaluation/shared/loader.ts
git commit -m "feat(eval): add shared/loader.ts for conversation entry loading"
```

---

## Task 5: Fix schema name collision

**Files:**
- Modify: `evaluation/judge/schema.ts`
- Modify: `evaluation/drift/schema.ts`

`judge/schema.ts` and `drift/schema.ts` both export `judgeResponseFormat` — different schemas, same name. Rename each to its pass-specific name.

- [ ] **Step 1: Update `judge/schema.ts`**

```ts
// evaluation/judge/schema.ts
export const judgeGuessingResponseFormat = {
  type: "json_object" as const,
} as const;
```

- [ ] **Step 2: Update `drift/schema.ts`**

```ts
// evaluation/drift/schema.ts
export const driftResponseFormat = {
  type: "json_object" as const,
} as const;
```

- [ ] **Step 3: Update existing import in `judge/call.ts`** (temporary — will be fully replaced in Task 6)

In `evaluation/judge/call.ts` line 4, change:
```ts
import { judgeResponseFormat } from "./schema";
```
to:
```ts
import { judgeGuessingResponseFormat } from "./schema";
```

And on line 52, change `response_format: judgeResponseFormat,` to `response_format: judgeGuessingResponseFormat,`.

- [ ] **Step 4: Update existing import in `drift/call.ts`** (temporary — will be fully replaced in Task 8)

In `evaluation/drift/call.ts` line 3, change:
```ts
import { judgeResponseFormat } from "./schema";
```
to:
```ts
import { driftResponseFormat } from "./schema";
```

And on line 27, change `response_format: judgeResponseFormat,` to `response_format: driftResponseFormat,`.

- [ ] **Step 5: Run typecheck**

```bash
bun run typecheck
```

Expected: clean output (no errors).

- [ ] **Step 6: Commit**

```bash
git add evaluation/judge/schema.ts evaluation/drift/schema.ts evaluation/judge/call.ts evaluation/drift/call.ts
git commit -m "refactor(eval): rename judgeResponseFormat to pass-specific names"
```

---

## Task 6: Slim `judge/call.ts`

**Files:**
- Modify: `evaluation/judge/call.ts`

Replace the 99-line retry loop with a delegate to `shared/call.ts`.

- [ ] **Step 1: Rewrite `judge/call.ts`**

```ts
// evaluation/judge/call.ts
import OpenAI from "openai";
import { JudgeOutputSchema } from "./types";
import type { JudgeOutput } from "./types";
import { judgeGuessingResponseFormat } from "./schema";
import { callWithRetry } from "../shared/call";
import type { CallResult } from "../shared/call";
import type { RawUsageMeta } from "../../packages/shared/conversation/types";

export async function callJudge(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userMessage: string,
  judgeLabel: string,
  log: (line: string) => void,
): Promise<{ output: JudgeOutput; usage: RawUsageMeta | null }> {
  const { result, usage }: CallResult<JudgeOutput> = await callWithRetry(
    client,
    model,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    judgeGuessingResponseFormat,
    (raw) => JudgeOutputSchema.parse(raw),
    judgeLabel,
    log,
  );
  return { output: result, usage };
}
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add evaluation/judge/call.ts
git commit -m "refactor(eval): judge/call.ts delegates to shared/callWithRetry"
```

---

## Task 7: Slim `reconstruct/call.ts`

**Files:**
- Modify: `evaluation/reconstruct/call.ts`
- Modify: `evaluation/reconstruct/schema.ts`

- [ ] **Step 1: Update `reconstruct/schema.ts`** (remove unused parameter)

```ts
// evaluation/reconstruct/schema.ts
export const reconstructorResponseFormat = {
  type: "json_object" as const,
} as const;

export const comparatorResponseFormat = {
  type: "json_object" as const,
} as const;
```

- [ ] **Step 2: Rewrite `reconstruct/call.ts`**

```ts
// evaluation/reconstruct/call.ts
import OpenAI from "openai";
import { ReconstructorOutputSchema, ComparatorOutputSchema } from "./types";
import type { ReconstructorOutput, ComparatorOutput, ProfileField } from "./types";
import { reconstructorResponseFormat, comparatorResponseFormat } from "./schema";
import { callWithRetry } from "../shared/call";
import type { CallResult } from "../shared/call";
import type { RawUsageMeta } from "../../packages/shared/conversation/types";

export async function callReconstructor(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userMessage: string,
  _fields: ProfileField[],
  label: string,
): Promise<{ output: ReconstructorOutput; usage: RawUsageMeta | null }> {
  const { result, usage }: CallResult<ReconstructorOutput> = await callWithRetry(
    client,
    model,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    reconstructorResponseFormat,
    (raw) => ReconstructorOutputSchema.parse(raw),
    label,
  );
  return { output: result, usage };
}

export async function callComparator(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userMessage: string,
  label: string,
): Promise<{ output: ComparatorOutput; usage: RawUsageMeta | null }> {
  const { result, usage }: CallResult<ComparatorOutput> = await callWithRetry(
    client,
    model,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    comparatorResponseFormat,
    (raw) => ComparatorOutputSchema.parse(raw),
    label,
  );
  return { output: result, usage };
}
```

Note: `_fields` is kept in the signature to avoid breaking callers in `reconstruct/index.ts` which passes it; prefix with `_` since the schema is now static.

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add evaluation/reconstruct/call.ts evaluation/reconstruct/schema.ts
git commit -m "refactor(eval): reconstruct/call.ts delegates to shared/callWithRetry"
```

---

## Task 8: Slim `drift/call.ts`

**Files:**
- Modify: `evaluation/drift/call.ts`

- [ ] **Step 1: Rewrite `drift/call.ts`**

```ts
// evaluation/drift/call.ts
import OpenAI from "openai";
import { JudgeOutputSchema } from "./types";
import type { JudgeOutput } from "./types";
import { driftResponseFormat } from "./schema";
import { callWithRetry } from "../shared/call";
import type { CallResult } from "../shared/call";
import type { RawUsageMeta } from "../../packages/shared/conversation/types";

export async function callJudge(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userMessage: string,
  label: string,
): Promise<{ output: JudgeOutput; usage: RawUsageMeta | null }> {
  const { result, usage }: CallResult<JudgeOutput> = await callWithRetry(
    client,
    model,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    driftResponseFormat,
    (raw) => JudgeOutputSchema.parse(raw),
    label,
  );
  return { output: result, usage };
}
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add evaluation/drift/call.ts
git commit -m "refactor(eval): drift/call.ts delegates to shared/callWithRetry"
```

---

## Task 9: Judge prompts → Handlebars

**Files:**
- Create: `evaluation/judge/prompts/system.hbs`
- Create: `evaluation/judge/prompts/user.hbs`
- Modify: `evaluation/judge/prompt.ts`

The shuffle logic (`deterministicShuffle`, `hashSeed`) stays in `prompt.ts`. Templates receive pre-computed data objects.

- [ ] **Step 1: Create `judge/prompts/system.hbs`**

```
You are a behavioral analyst. Your task is to match anonymous aliases to fictional characters by identifying whose behavioral signature each alias displays in a conversation.

You will receive: a scenario, a conversation transcript using alias names, character profiles (unlabelled, shuffled), a list of real names, and the aliases to assign.

Read the transcript first and form impressions of each alias before reading the profiles.

Match evidence in this order:

  Tier 1 — EXACT LANGUAGE: Does any alias use a phrase that appears verbatim or near-verbatim in a character's notable quotes? An exact match is near-conclusive evidence on its own.

  Tier 2 — SPEECH SIGNATURE: How does each alias construct sentences? Look for: pronoun choice (I / we / one), sentence length and rhythm, use of qualifications or subordinate clauses, rhetorical devices, vocabulary register.

  Tier 3 — VALUE IN ACTION: What does each alias choose, refuse, or defend in this specific scenario? Match to the character's values, goals, and fears that are activated by the situation.

Constraints:
  - Each alias maps to exactly one real character name. No shared assignments.
  - If two profiles seem equally plausible for one alias, assign by elimination: the stronger match elsewhere resolves the tie.

For each assignment provide 1–3 reasons. Each reason must follow this format:
  "[exact quote or paraphrase from transcript]" → matches [profile field]: [specific value from that field]

Do not write vague summaries ("seems confrontational"). Every reason must be grounded in a specific line from the transcript and a specific field in a profile.

Respond with ONLY valid JSON — no markdown, no explanation, no preamble. Use this exact structure:
{"assignments":[{"alias":"<alias>","real_name":"<real name>","reasons":["<reason 1>","<reason 2>"]}]}
```

- [ ] **Step 2: Create `judge/prompts/user.hbs`**

```handlebars
## Scenario

**Title:** {{scenario.title}}
**Context:** {{scenario.context}}
**Opening prompt:** {{scenario.initialPrompt}}

## Conversation Transcript

Read the following exchanges carefully. Note each alias's language, framing, and choices before proceeding.

{{#each transcript}}
**{{this.character_name}}**: {{this.content}}
{{/each}}
## Character Profiles

The following profiles describe the characters in this conversation. Presented in shuffled order with no name or alias labels. Fields are ordered from most to least directly observable in dialogue.

{{#each profiles}}
### Profile {{this.profileNumber}}
**Speech patterns:** {{this.speechPatternsStr}}
**Notable quotes:** {{this.notableQuotesStr}}
**Personality traits:** {{this.personalityTraitsStr}}
**Values:** {{this.valuesStr}}
**Goals:** {{this.goalsStr}}
**Fears:** {{this.fearsStr}}
**Coping style:** {{this.copingStyleStr}}
**Archetype:** {{this.archetype}}
**Backstory:** {{this.backstory}}

{{/each}}
## Real Character Names

The following are the real names of the characters in the transcript. Not listed in the same order as the profiles above.

{{#each realNames}}
- {{this}}
{{/each}}

## Aliases to Assign

Assign each alias to one real character name. Provide 1–3 reasons per assignment in the required format.

{{#each aliases}}
- {{this}}
{{/each}}
```

- [ ] **Step 3: Rewrite `judge/prompt.ts`**

```ts
// evaluation/judge/prompt.ts
import Handlebars from "handlebars";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CharacterRecord, ScenarioRecord } from "../generator/config";
import type { ConversationMessage } from "../generator/conversation";

const promptDir = join(import.meta.dirname, "prompts");
const systemTemplate = Handlebars.compile(readFileSync(join(promptDir, "system.hbs"), "utf8"));
const userTemplate = Handlebars.compile(readFileSync(join(promptDir, "user.hbs"), "utf8"));

export function buildJudgeSystemPrompt(): string {
  return systemTemplate({});
}

export function buildJudgeUserMessage(
  aliasMap: Record<string, string>,
  characters: CharacterRecord[],
  scenario: ScenarioRecord,
  messages: ConversationMessage[],
): string {
  const shuffled = deterministicShuffle(characters, scenario.id);
  return userTemplate({
    scenario: {
      title: scenario.title,
      context: scenario.context,
      initialPrompt: scenario.initial_prompt,
    },
    transcript: messages,
    profiles: shuffled.map((char, i) => ({
      profileNumber: i + 1,
      speechPatternsStr: char.speechPatterns.join("; "),
      notableQuotesStr: char.notableQuotes.map((q) => `"${q}"`).join(" | "),
      personalityTraitsStr: char.personalityTraits.join(", "),
      valuesStr: char.values.join(", "),
      goalsStr: char.goals.join(", "),
      fearsStr: char.fears.join(", "),
      copingStyleStr: char.copingStyle.join("; "),
      archetype: char.archetype,
      backstory: char.backstory,
    })),
    realNames: characters.map((c) => c.name),
    aliases: Object.keys(aliasMap),
  });
}

function deterministicShuffle<T>(arr: T[], seed: string): T[] {
  const copy = [...arr];
  let s = hashSeed(seed);
  for (let i = copy.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const j = Math.abs(s) % (i + 1);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function hashSeed(str: string): number {
  let h = 0x12345678;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(h ^ str.charCodeAt(i), 2654435761) | 0) >>> 0;
  }
  return h;
}
```

- [ ] **Step 4: Run typecheck**

```bash
bun run typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add evaluation/judge/prompts/ evaluation/judge/prompt.ts
git commit -m "refactor(eval): extract judge prompts to Handlebars templates"
```

---

## Task 10: Reconstruct prompts → Handlebars

**Files:**
- Create: `evaluation/reconstruct/prompts/reconstructor-system.hbs`
- Create: `evaluation/reconstruct/prompts/reconstructor-user.hbs`
- Create: `evaluation/reconstruct/prompts/comparator-system.hbs`
- Create: `evaluation/reconstruct/prompts/comparator-user.hbs`
- Modify: `evaluation/reconstruct/prompt.ts`

- [ ] **Step 1: Create `reconstruct/prompts/reconstructor-system.hbs`**

```
You are a behavioral analyst. Your task is to infer a fictional character's personality profile from a conversation transcript.

You will receive a scenario context, a conversation transcript, and a list of personality fields to reconstruct for a specific character (identified by alias).

For each field, produce either:
- A list of reconstructed items grounded in the transcript
- { not_observed: true, items: [] } if the transcript contains no sufficient evidence for that field

Rules:
1. Only include items you can ground in specific behavior, dialogue, or choices from the transcript. Do not add traits not evidenced in the text.
2. "not_observed" means the evidence is absent — not that the character lacks this trait. Use it freely.
3. Focus only on the character identified by the specified alias. Ignore other characters.
4. 2–5 items per field is typical. Match the abstraction level of the field definition.
5. For speechPatterns: describe observable language features (not interpretations).
6. For values/fears/goals: infer from what the character chooses, refuses, or defends — not from what they say they believe.

Respond with ONLY valid JSON — no markdown, no explanation. Use this structure:
{"fields":{"personalityTraits":{"not_observed":false,"items":["..."]},"speechPatterns":{"not_observed":false,"items":["..."]}}}
```

- [ ] **Step 2: Create `reconstruct/prompts/reconstructor-user.hbs`**

```handlebars
## Scenario

**Title:** {{scenario.title}}
**Context:** {{scenario.context}}

## Conversation Transcript

Read the following exchanges. You will reconstruct the profile for **{{alias}}** only.

{{#each transcript}}
**{{this.character_name}}** [{{this.emotion}}, {{this.intensity}}]: {{this.content}}
{{/each}}

## Task: Reconstruct profile for alias "{{alias}}"

For each field below, output reconstructed items or mark not_observed.

{{#each fields}}
**{{this.name}}:** {{this.definition}}
{{/each}}
```

- [ ] **Step 3: Create `reconstruct/prompts/comparator-system.hbs`**

```
You are an expert semantic evaluator. Your task is to label reconstructed personality items against ground-truth profile items.

For each reconstructed item, determine whether it is covered by the ground-truth and assign one of three labels:

  match: The reconstructed item expresses the same idea as at least one ground-truth item, even if worded differently. Paraphrase, synonym, and generalization all count as a match.
  no_match: The reconstructed item is not covered by any ground-truth item. It may be a plausible trait not mentioned in the ground truth — that is fine.
  contradiction: The reconstructed item directly contradicts a ground-truth item. Use this only when the reconstructed item is incompatible with or the opposite of a ground-truth item.

Important: reserve "contradiction" for clear semantic contradictions. A trait absent from the ground-truth is "no_match", not "contradiction". Ambiguous cases default to "no_match".

For each item provide a justification: which ground-truth item it matches, partially matches, is contradicted by, or why there is no match.

Respond with ONLY valid JSON — no markdown, no explanation. Use this structure:
{"item_scores":[{"reconstructed_item":"...","score":"match","justification":"..."}]}
```

- [ ] **Step 4: Create `reconstruct/prompts/comparator-user.hbs`**

```handlebars
## Field: {{field}}

**Definition:** {{definition}}

## Ground-Truth Items

{{#each gtItems}}
{{addOne @index}}. {{this}}
{{/each}}

## Reconstructed Items to Label

Label each item as: match, no_match, or contradiction.

{{#each reconstructedItems}}
{{addOne @index}}. {{this}}
{{/each}}
```

Note: the `addOne` Handlebars helper (for 1-based numbering) must be registered in `prompt.ts`.

- [ ] **Step 5: Rewrite `reconstruct/prompt.ts`**

```ts
// evaluation/reconstruct/prompt.ts
import Handlebars from "handlebars";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProfileField } from "./types";
import type { ScenarioRecord } from "../generator/config";
import type { ConversationMessage } from "../generator/conversation";

Handlebars.registerHelper("addOne", (index: number) => index + 1);

const promptDir = join(import.meta.dirname, "prompts");
const reconstructorSystemTemplate = Handlebars.compile(
  readFileSync(join(promptDir, "reconstructor-system.hbs"), "utf8"),
);
const reconstructorUserTemplate = Handlebars.compile(
  readFileSync(join(promptDir, "reconstructor-user.hbs"), "utf8"),
);
const comparatorSystemTemplate = Handlebars.compile(
  readFileSync(join(promptDir, "comparator-system.hbs"), "utf8"),
);
const comparatorUserTemplate = Handlebars.compile(
  readFileSync(join(promptDir, "comparator-user.hbs"), "utf8"),
);

const FIELD_DEFINITIONS: Record<ProfileField, string> = {
  personalityTraits:
    "Stable character traits that show up across different situations — adjectives or short phrases describing how this character fundamentally is.",
  speechPatterns:
    "Observable features of how this character constructs sentences: pronoun choice, sentence length, rhythm, hedging, vocabulary register, rhetorical habits.",
  values:
    "What this character demonstrably prioritizes, protects, or acts to uphold — inferred from their choices and stated positions.",
  fears:
    "What this character avoids, resists, or shows distress about — inferred from what they protect against or refuse.",
  goals:
    "What this character is trying to achieve or move towards in this interaction and in general.",
  copingStyle:
    "How this character manages stress, conflict, or uncertainty — behavioral patterns visible when under pressure.",
};

export function buildReconstructorSystemPrompt(): string {
  return reconstructorSystemTemplate({});
}

export function buildReconstructorUserMessage(
  alias: string,
  scenario: ScenarioRecord,
  messages: ConversationMessage[],
  fields: ProfileField[],
): string {
  return reconstructorUserTemplate({
    alias,
    scenario: { title: scenario.title, context: scenario.context },
    transcript: messages,
    fields: fields.map((f) => ({ name: f, definition: FIELD_DEFINITIONS[f] })),
  });
}

export function buildComparatorSystemPrompt(): string {
  return comparatorSystemTemplate({});
}

export function buildComparatorUserMessage(
  field: ProfileField,
  gtItems: string[],
  reconstructedItems: string[],
): string {
  return comparatorUserTemplate({
    field,
    definition: FIELD_DEFINITIONS[field],
    gtItems,
    reconstructedItems,
  });
}
```

- [ ] **Step 6: Run typecheck**

```bash
bun run typecheck
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add evaluation/reconstruct/prompts/ evaluation/reconstruct/prompt.ts
git commit -m "refactor(eval): extract reconstruct prompts to Handlebars templates"
```

---

## Task 11: Drift prompts → Handlebars

**Files:**
- Create: `evaluation/drift/prompts/system.hbs`
- Create: `evaluation/drift/prompts/user.hbs`
- Modify: `evaluation/drift/prompt.ts`

The existing `drift/__tests__/prompt.test.ts` acts as the TDD harness — it must pass before and after.

- [ ] **Step 1: Run existing drift prompt tests as baseline**

```bash
bun test evaluation/drift/__tests__/prompt.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 2: Create `drift/prompts/system.hbs`**

```
You are evaluating a roleplay conversation segment for scenario adherence and character consistency.

Your task:
1. Score how actively this segment engages the scenario's intended stress axes.
2. For each character listed, score whether their response to the scenario's pressure is consistent with their personality sheet.

Scoring for scenario_engagement:
  active  — The scenario's stress axis is clearly being enacted. Characters are responding to the scenario's specific pressure.
  touched — The scenario's theme is present but not the central driver of the exchange.
  absent  — The conversation has drifted away from the scenario's intended tension.

Scoring for character_alignment (per character):
  consistent  — The character's response to the scenario reflects their archetype and listed traits, values, fears, or coping style.
  neutral     — The character's response is plausible but does not clearly reflect their specific personality sheet.
  contradicts — The character's response directly contradicts their stated traits, archetype, or coping style.

Return only valid JSON matching the provided schema. For each character in character_alignment, use the exact character_id shown in the Characters section. Include all listed characters.
```

- [ ] **Step 3: Create `drift/prompts/user.hbs`**

```handlebars
## Scenario

stress_axes: [{{scenario.stressAxes}}]
social_context: {{scenario.socialContext}}
pressure_source: {{scenario.pressureSource}}
initial_prompt: "{{scenario.initialPrompt}}"

## Characters

{{#each characters}}
{{this.name}} (character_id: {{this.id}}) — {{this.archetype}}
  personalityTraits: [{{this.traitsStr}}]
  values: [{{this.valuesStr}}]
  fears: [{{this.fearsStr}}]
  goals: [{{this.goalsStr}}]
  copingStyle: [{{this.copingStr}}]
  speechPatterns: [{{this.speechStr}}]

{{/each}}
{{#if hasPrior}}
## Prior Conversation (turns 1–{{priorEnd}})

{{#each priorMessages}}
[{{this.character_name}}]: {{this.content}}
{{/each}}

{{/if}}
## Current Segment — Segment {{segmentIndex}} of {{totalSegments}} (turns {{firstTurn}}–{{lastTurn}})

{{#each currentSegment}}
[{{this.character_name}}] ({{this.emotion}}, {{this.intensity}}): {{this.content}}
{{/each}}

## Task
{{#if hasPrior}}
Score scenario_engagement and personality_alignment for the Current Segment only (turns {{firstTurn}}–{{lastTurn}}). Use the Prior Conversation to understand established references and dynamics, but base your scores on what happens in the Current Segment.
{{else}}
Score scenario_engagement and personality_alignment for the Current Segment only (turns {{firstTurn}}–{{lastTurn}}).
{{/if}}
Score personality_alignment for each of: {{characterIds}}
```

- [ ] **Step 4: Rewrite `drift/prompt.ts`**

```ts
// evaluation/drift/prompt.ts
import Handlebars from "handlebars";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ScenarioRecord } from "../generator/config";
import type { ConversationMessage } from "../generator/conversation";
import type { CharacterRecord } from "../generator/config";

export type PromptCharacter = {
  id: string;
  name: string;
  archetype: string;
  record: CharacterRecord;
};

const promptDir = join(import.meta.dirname, "prompts");
const systemTemplate = Handlebars.compile(readFileSync(join(promptDir, "system.hbs"), "utf8"));
const userTemplate = Handlebars.compile(readFileSync(join(promptDir, "user.hbs"), "utf8"));

export function buildJudgeSystemPrompt(): string {
  return systemTemplate({});
}

export function buildJudgeUserPrompt(
  scenario: ScenarioRecord,
  characters: PromptCharacter[],
  priorMessages: ConversationMessage[],
  segmentMessages: ConversationMessage[],
  segmentIndex: number,
  totalSegments: number,
  firstTurn: number,
  lastTurn: number,
): string {
  return userTemplate({
    scenario: {
      stressAxes: scenario.stress_axes.join(", "),
      socialContext: scenario.social_context,
      pressureSource: scenario.pressure_source,
      initialPrompt: scenario.initial_prompt,
    },
    characters: characters.map((c) => ({
      id: c.id,
      name: c.name,
      archetype: c.archetype,
      traitsStr: c.record.personalityTraits.join(", "),
      valuesStr: c.record.values.join(", "),
      fearsStr: c.record.fears.join(", "),
      goalsStr: c.record.goals.join(", "),
      copingStr: c.record.copingStyle.join(", "),
      speechStr: c.record.speechPatterns.join(", "),
    })),
    hasPrior: priorMessages.length > 0,
    priorEnd: firstTurn - 1,
    priorMessages,
    segmentIndex,
    totalSegments,
    firstTurn,
    lastTurn,
    currentSegment: segmentMessages,
    characterIds: characters.map((c) => c.id).join(", "),
  });
}
```

- [ ] **Step 5: Run existing tests — must still pass**

```bash
bun test evaluation/drift/__tests__/prompt.test.ts
```

Expected: all 7 tests pass. If any fail, the template output doesn't match what tests expect — fix the `.hbs` content, not the test.

- [ ] **Step 6: Commit**

```bash
git add evaluation/drift/prompts/ evaluation/drift/prompt.ts
git commit -m "refactor(eval): extract drift prompts to Handlebars templates"
```

---

## Task 12: `drift/index.ts` → `shared/segmenter`

**Files:**
- Modify: `evaluation/drift/index.ts`
- Delete: `evaluation/drift/segment.ts`

- [ ] **Step 1: Run existing drift tests as baseline**

```bash
bun test evaluation/drift/
```

Note how many pass.

- [ ] **Step 2: Update `drift/index.ts`**

Replace the import and the loop. Full updated file:

```ts
// evaluation/drift/index.ts
import OpenAI from "openai";
import { segmentConversation } from "../shared/segmenter";
import {
  majorityVoteEngagement,
  majorityVoteAlignment,
  computeDriftDeltas,
} from "./scoring";
import { callJudge } from "./call";
import { buildJudgeSystemPrompt, buildJudgeUserPrompt } from "./prompt";
import type {
  SegmentScore,
  CharacterAlignmentScore,
  ConversationDriftResult,
  ValidatedDriftConfig,
  EngagementLabel,
  AlignmentLabel,
} from "./types";
import type { CharacterRecord, ScenarioRecord } from "../generator/config";
import type { ConversationResult } from "../generator/conversation";
import type { CostTracker } from "../cost/tracker";

export async function runDriftForConversation(
  result: ConversationResult,
  fileName: string,
  scenario: ScenarioRecord,
  characters: CharacterRecord[],
  config: ValidatedDriftConfig,
  apiKey: string,
  tracker: CostTracker,
  conversationId: string,
): Promise<ConversationDriftResult> {
  const client = new OpenAI({ baseURL: `${config.baseUrl}/v1`, apiKey });

  const aliasToRecord = new Map<string, CharacterRecord>();
  for (const convChar of result.characters) {
    const record = characters.find((c) => c.id === convChar.id);
    if (!record) throw new Error(`Character "${convChar.id}" not found in dataset (${fileName})`);
    aliasToRecord.set(convChar.name, record);
  }

  const promptCharacters = result.characters.map((convChar) => {
    const record = aliasToRecord.get(convChar.name)!;
    return { id: convChar.id, name: record.name, archetype: record.archetype, record };
  });

  const messages = result.messages.map((m) => ({ ...m, reasoning: "", subtext: "" }));

  const realNameMessages = messages.map((m) => ({
    ...m,
    character_name: aliasToRecord.get(m.character_name)?.name ?? m.character_name,
  }));

  const segments = segmentConversation(realNameMessages, config.segments);
  const systemPrompt = buildJudgeSystemPrompt();
  const segmentScores: SegmentScore[] = [];

  for (const seg of segments) {
    const { segment_index: segIdx, turn_range: [firstTurn, lastTurn], messages: segMessages } = seg;
    const priorMessages = realNameMessages.slice(0, firstTurn - 1);

    const userPrompt = buildJudgeUserPrompt(
      scenario,
      promptCharacters,
      priorMessages,
      segMessages,
      segIdx + 1,
      segments.length,
      firstTurn,
      lastTurn,
    );

    process.stdout.write(`  [seg ${segIdx + 1}/${segments.length}] judging…`);

    const judgeResults = await Promise.allSettled(
      config.judges.map((judge) =>
        callJudge(
          client,
          judge.model,
          systemPrompt,
          userPrompt,
          `${judge.label}:seg${segIdx + 1}`,
        ),
      ),
    );

    const successfulResults = judgeResults
      .filter(
        (r): r is PromiseFulfilledResult<{ output: Awaited<ReturnType<typeof callJudge>>["output"]; usage: Awaited<ReturnType<typeof callJudge>>["usage"] }> =>
          r.status === "fulfilled",
      )
      .map((r) => r.value);

    for (const { usage } of successfulResults) {
      if (usage) {
        tracker.record({
          conversationId,
          segmentIdx: segIdx,
          role: "judge",
          ...usage,
        });
      }
    }

    const successfulOutputs = successfulResults.map((r) => r.output);
    const lowConfidence = successfulOutputs.length < 2;

    if (successfulOutputs.length === 0) {
      throw new Error(`All judges failed for segment ${segIdx + 1} in ${fileName}`);
    }

    const engVotes = successfulOutputs.map((o) => o.scenario_engagement as EngagementLabel);
    const engResult = majorityVoteEngagement(engVotes);

    const alignmentScores: CharacterAlignmentScore[] = promptCharacters.map((char) => {
      const votes = successfulOutputs
        .map((o) => o.character_alignment.find((a) => a.character_id === char.id)?.label)
        .filter((v): v is AlignmentLabel => v !== undefined);
      const voteResult = majorityVoteAlignment(votes.length > 0 ? votes : ["neutral"]);
      return {
        character_id: char.id,
        archetype: char.archetype,
        label: voteResult.label,
        votes,
        confidence: voteResult.confidence,
        score: voteResult.score,
      };
    });

    segmentScores.push({
      index: segIdx + 1,
      turn_range: [firstTurn, lastTurn],
      scenario_engagement: {
        label: engResult.label,
        votes: engVotes,
        confidence: engResult.confidence,
        score: engResult.score,
      },
      personality_alignment: alignmentScores,
      low_confidence: lowConfidence,
    });

    process.stdout.write(` ${engResult.label} (${successfulOutputs.length}/${config.judges.length} judges)\n`);
  }

  const { scenarioDrift, charDrifts } = computeDriftDeltas(segmentScores);

  return {
    conversation_file: fileName,
    scenario_id: result.scenario_id,
    scenario_title: result.scenario_title,
    stress_axes: scenario.stress_axes,
    segments: segmentScores,
    drift: {
      scenario_engagement: scenarioDrift,
      personality_alignment: charDrifts,
    },
  };
}
```

- [ ] **Step 3: Delete `drift/segment.ts`**

```bash
git rm evaluation/drift/segment.ts
```

- [ ] **Step 4: Run drift tests — must match baseline**

```bash
bun test evaluation/drift/
```

Expected: same pass count as baseline.

- [ ] **Step 5: Commit**

```bash
git add evaluation/drift/index.ts
git commit -m "refactor(eval): drift/index.ts uses shared/segmenter, removes drift/segment.ts"
```

---

## Task 13: `reconstruct/index.ts` → `shared/segmenter` + split function

**Files:**
- Modify: `evaluation/reconstruct/index.ts`
- Modify: `evaluation/reconstruct/__tests__/segmenter.test.ts`
- Delete: `evaluation/reconstruct/segmenter.ts`

- [ ] **Step 1: Run existing reconstruct tests as baseline**

```bash
bun test evaluation/reconstruct/
```

Note how many pass.

- [ ] **Step 2: Rewrite `reconstruct/index.ts`** (split the 213-line function)

```ts
// evaluation/reconstruct/index.ts
import OpenAI from "openai";
import { callReconstructor, callComparator } from "./call";
import {
  buildReconstructorSystemPrompt,
  buildReconstructorUserMessage,
  buildComparatorSystemPrompt,
  buildComparatorUserMessage,
} from "./prompt";
import { buildItemScores, computeFieldScore, computeFieldDriftScore } from "./scoring";
import { reconstructAliasMap } from "../judge/alias";
import { segmentConversation } from "../shared/segmenter";
import type { Segment } from "../shared/segmenter";
import { PROFILE_FIELDS } from "./types";
import type {
  ProfileField,
  FieldScore,
  ReconstructedField,
  CharacterResult,
  ConversationReconstructionResult,
  ValidatedReconstructConfig,
  SegmentResult,
  FieldDriftScore,
} from "./types";
import type { CharacterRecord, ScenarioRecord } from "../generator/config";
import type { ConversationResult } from "../generator/conversation";
import type { CostTracker } from "../cost/tracker";

function getGtItems(char: CharacterRecord, field: ProfileField): string[] {
  return (char[field as keyof CharacterRecord] as string[] | undefined) ?? [];
}

async function processSegment(
  alias: string,
  scenario: ScenarioRecord,
  seg: Segment,
  config: ValidatedReconstructConfig,
  client: OpenAI,
  reconstructorSysPrompt: string,
  comparatorSysPrompt: string,
  charRecord: CharacterRecord,
  tracker: CostTracker,
  conversationId: string,
): Promise<{ segmentResult: SegmentResult; reconFields: Partial<Record<ProfileField, ReconstructedField>> }> {
  const userMsg = buildReconstructorUserMessage(alias, scenario, seg.messages, config.fields);

  const { output: reconstruction, usage: reconUsage } = await callReconstructor(
    client,
    config.reconstructorModel,
    reconstructorSysPrompt,
    userMsg,
    config.fields,
    `reconstructor:${alias}:seg${seg.segment_index}`,
  );

  if (reconUsage) {
    tracker.record({ conversationId, segmentIdx: seg.segment_index, role: "reconstructor", ...reconUsage });
  }

  const fieldScores: Partial<Record<ProfileField, FieldScore>> = {};
  const reconFields: Partial<Record<ProfileField, ReconstructedField>> = {};

  for (const field of config.fields) {
    const reconField = reconstruction.fields[field];
    reconFields[field] = reconField;
    const notObserved = !reconField || reconField.not_observed || reconField.items.length === 0;

    if (notObserved) {
      fieldScores[field] = computeFieldScore(true, getGtItems(charRecord, field), []);
      continue;
    }

    const gtItems = getGtItems(charRecord, field);
    const comparatorOutputs = await Promise.all(
      config.comparators.map(async (comp) => {
        const compUserMsg = buildComparatorUserMessage(field, gtItems, reconField.items);
        const { output, usage: compUsage } = await callComparator(
          client,
          comp.model,
          comparatorSysPrompt,
          compUserMsg,
          `${comp.label}:${alias}:seg${seg.segment_index}:${field}`,
        );
        if (compUsage) {
          tracker.record({ conversationId, segmentIdx: seg.segment_index, role: "comparator", ...compUsage });
        }
        return { model: comp.model, scores: output.item_scores };
      }),
    );

    const itemScores = buildItemScores(reconField.items, comparatorOutputs);
    fieldScores[field] = computeFieldScore(false, gtItems, itemScores);
  }

  for (const field of PROFILE_FIELDS) {
    if (!fieldScores[field]) fieldScores[field] = computeFieldScore(true, [], []);
  }

  return {
    segmentResult: {
      segment_index: seg.segment_index,
      turn_range: seg.turn_range,
      message_count: seg.messages.length,
      field_scores: fieldScores as Record<ProfileField, FieldScore>,
    },
    reconFields,
  };
}

async function processCharacter(
  convChar: ConversationResult["characters"][number],
  charRecord: CharacterRecord,
  aliasMap: Record<string, string>,
  segments: Segment[],
  scenario: ScenarioRecord,
  config: ValidatedReconstructConfig,
  client: OpenAI,
  reconstructorSysPrompt: string,
  comparatorSysPrompt: string,
  tracker: CostTracker,
  conversationId: string,
): Promise<CharacterResult> {
  const alias = convChar.name;
  const realName = aliasMap[alias] ?? alias;

  console.log(`  [${alias} → ${realName}] reconstructing ${config.segments} segments…`);

  const segmentResults: SegmentResult[] = [];
  const segmentFields: Array<Partial<Record<ProfileField, ReconstructedField>>> = [];

  for (const seg of segments) {
    const { segmentResult, reconFields } = await processSegment(
      alias, scenario, seg, config, client,
      reconstructorSysPrompt, comparatorSysPrompt,
      charRecord, tracker, conversationId,
    );
    segmentResults.push(segmentResult);
    segmentFields.push(reconFields);
  }

  const hasMultipleSegments = segmentFields.length >= 2;
  const seg0Fields = segmentFields[0] ?? {};
  const segNFields = segmentFields[segmentFields.length - 1] ?? {};
  const fieldDrift: Partial<Record<ProfileField, FieldDriftScore>> = {};

  for (const field of PROFILE_FIELDS) {
    const segmentF1s: Array<number | null> = segmentResults.map((sr) => {
      const fs = sr.field_scores[field];
      return fs && !fs.not_observed ? fs.f1 : null;
    });

    let internalConsistency: FieldScore | null = null;
    const seg0Field = seg0Fields[field];
    const segNField = segNFields[field];

    if (
      hasMultipleSegments &&
      seg0Field && !seg0Field.not_observed && seg0Field.items.length > 0 &&
      segNField && !segNField.not_observed && segNField.items.length > 0
    ) {
      process.stdout.write(`    [${field}] internal consistency seg0 vs segN…`);
      const compOutputs = await Promise.all(
        config.comparators.map(async (comp) => {
          const compUserMsg = buildComparatorUserMessage(field, seg0Field.items, segNField.items);
          const { output, usage: compUsage } = await callComparator(
            client, comp.model, comparatorSysPrompt, compUserMsg,
            `${comp.label}:${alias}:internal:${field}`,
          );
          if (compUsage) {
            tracker.record({ conversationId, segmentIdx: null, role: "comparator", ...compUsage });
          }
          return { model: comp.model, scores: output.item_scores };
        }),
      );
      const itemScores = buildItemScores(segNField.items, compOutputs);
      internalConsistency = computeFieldScore(false, seg0Field.items, itemScores);
      process.stdout.write(" done\n");
    }

    fieldDrift[field] = computeFieldDriftScore(segmentF1s, internalConsistency);
  }

  const slopes = PROFILE_FIELDS.map((f) => fieldDrift[f]?.gt_divergence_slope ?? null)
    .filter((s): s is number => s !== null);
  const icF1s = PROFILE_FIELDS.map((f) => fieldDrift[f]?.internal_consistency?.f1 ?? null)
    .filter((f): f is number => f !== null);

  return {
    alias,
    real_name: realName,
    difficulty_tier: charRecord.difficultyTier,
    segments: segmentResults,
    field_drift: fieldDrift as Record<ProfileField, FieldDriftScore>,
    mean_gt_divergence_slope: slopes.length > 0 ? slopes.reduce((s, v) => s + v, 0) / slopes.length : null,
    mean_internal_consistency_f1: icF1s.length > 0 ? icF1s.reduce((s, v) => s + v, 0) / icF1s.length : null,
  };
}

export async function runReconstructionForConversation(
  result: ConversationResult,
  fileName: string,
  scenario: ScenarioRecord,
  characters: CharacterRecord[],
  config: ValidatedReconstructConfig,
  apiKey: string,
  tracker?: CostTracker,
  conversationId?: string,
): Promise<ConversationReconstructionResult> {
  const strippedMessages = result.messages.map((m) => ({ ...m, reasoning: "", subtext: "" }));

  if (strippedMessages.length < config.segments * 2) {
    throw new Error(
      `${fileName}: not enough messages for ${config.segments} segments ` +
        `(${strippedMessages.length} messages, need at least ${config.segments * 2})`,
    );
  }

  const client = new OpenAI({ baseURL: `${config.baseUrl}/v1`, apiKey });
  const aliasMap = reconstructAliasMap(result.characters, characters);
  const segments = segmentConversation(strippedMessages, config.segments);
  const reconstructorSysPrompt = buildReconstructorSystemPrompt();
  const comparatorSysPrompt = buildComparatorSystemPrompt();

  const effectiveTracker = tracker ?? { record: () => {} } as unknown as CostTracker;
  const effectiveConversationId = conversationId ?? fileName;

  const charResults: CharacterResult[] = [];
  for (const convChar of result.characters) {
    const charRecord = characters.find((c) => c.id === convChar.id);
    if (!charRecord) throw new Error(`Character ${convChar.id} not found in dataset`);
    charResults.push(
      await processCharacter(
        convChar, charRecord, aliasMap, segments, scenario, config,
        client, reconstructorSysPrompt, comparatorSysPrompt,
        effectiveTracker, effectiveConversationId,
      ),
    );
  }

  return {
    conversation_file: fileName,
    scenario_id: result.scenario_id,
    scenario_title: result.scenario_title,
    scenario_difficulty: scenario.difficulty_level,
    scenario_stress_axes: scenario.stress_axes,
    segment_count: config.segments,
    characters: charResults,
  };
}
```

Note: `tracker` and `conversationId` are made optional (with safe defaults) so existing tests that omit them keep working.

- [ ] **Step 3: Update `reconstruct/__tests__/segmenter.test.ts`** — change import to `shared/segmenter`

Replace line 3:
```ts
import { segmentConversation } from "../segmenter";
```
with:
```ts
import { segmentConversation } from "../../shared/segmenter";
```

- [ ] **Step 4: Delete `reconstruct/segmenter.ts`**

```bash
git rm evaluation/reconstruct/segmenter.ts
```

- [ ] **Step 5: Run reconstruct tests — must match baseline**

```bash
bun test evaluation/reconstruct/
```

Expected: same pass count as baseline.

- [ ] **Step 6: Commit**

```bash
git add evaluation/reconstruct/index.ts evaluation/reconstruct/__tests__/segmenter.test.ts
git commit -m "refactor(eval): split reconstruct/index.ts, use shared/segmenter, remove reconstruct/segmenter.ts"
```

---

## Task 14: Use threshold constants in `drift/scoring.ts`

**Files:**
- Modify: `evaluation/drift/scoring.ts`

- [ ] **Step 1: Run drift scoring tests as baseline**

```bash
bun test evaluation/drift/__tests__/scoring.test.ts
```

- [ ] **Step 2: Update `drift/scoring.ts` — replace magic numbers**

Add import at top of file:
```ts
import { DRIFT_THRESHOLD_DEGRADING, DRIFT_THRESHOLD_IMPROVING } from "../shared/constants";
```

Replace `computeVerdict`:
```ts
export function computeVerdict(totalDrift: number): Verdict {
  if (totalDrift < DRIFT_THRESHOLD_DEGRADING) return "degrading";
  if (totalDrift > DRIFT_THRESHOLD_IMPROVING) return "improving";
  return "stable";
}
```

- [ ] **Step 3: Run tests — must still pass**

```bash
bun test evaluation/drift/__tests__/scoring.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add evaluation/drift/scoring.ts
git commit -m "refactor(eval): drift/scoring.ts uses shared threshold constants"
```

---

## Task 15: Use constants in `cost/fetcher.ts`

**Files:**
- Modify: `evaluation/cost/fetcher.ts`

- [ ] **Step 1: Update `cost/fetcher.ts`**

Replace the local `const COST_RETRY_DELAYS_MS = [3000, 6000, 12000];` with an import:

```ts
import { COST_RETRY_DELAYS_MS } from "../shared/constants";
```

Remove line 5 (`const COST_RETRY_DELAYS_MS = ...`). Everything else stays identical.

- [ ] **Step 2: Run cost tests**

```bash
bun test evaluation/cost/
```

- [ ] **Step 3: Commit**

```bash
git add evaluation/cost/fetcher.ts
git commit -m "refactor(eval): cost/fetcher uses COST_RETRY_DELAYS_MS from shared/constants"
```

---

## Task 16: Slim `pass.ts` files with `shared/loader` + `shared/constants`

**Files:**
- Modify: `evaluation/judge/pass.ts`
- Modify: `evaluation/reconstruct/pass.ts`
- Modify: `evaluation/drift/pass.ts`

- [ ] **Step 1: Update `judge/pass.ts`**

```ts
// evaluation/judge/pass.ts
import { rmSync } from "node:fs";
import { join } from "node:path";
import { loadJudgeConfig } from "./config";
import { reconstructAliasMap } from "./alias";
import { runJudges } from "./index";
import { initJudgeOutputDir, writeGuessingResult } from "./writer";
import { CostTracker } from "../cost/tracker";
import { fetchPassCosts } from "../cost/fetcher";
import { termColors } from "../utils";
import { loadConversationEntries } from "../shared/loader";
import { PASS_DIRS } from "../shared/constants";
import type { CharacterRecord, ScenarioRecord } from "../generator/config";
import type { GuessingScenarioResult } from "./types";

const col = termColors();

import rawCharacters from "../dataset/characters.yaml";
import rawScenarios from "../dataset/scenarios.yaml";

const ALL_CHARACTERS = rawCharacters as CharacterRecord[];
const ALL_SCENARIOS = rawScenarios as ScenarioRecord[];

export async function runJudgingPass(configPath: string, evalName: string): Promise<void> {
  const config = loadJudgeConfig(configPath, evalName);
  const apiKey = process.env["LLM_API_KEY"]!;

  const judgeRunDir = initJudgeOutputDir(config.evalDir, config);
  const tracker = new CostTracker();

  try {
    const entries = loadConversationEntries(config.conversationsDir);
    const total = entries.length;

    const guessingResults: GuessingScenarioResult[] = await Promise.all(
      entries.map(async ({ file, result, i }) => {
        const scenario = ALL_SCENARIOS.find((s) => s.id === result.scenario_id);
        if (!scenario) throw new Error(`Scenario "${result.scenario_id}" not found in dataset (from ${file})`);

        const convCharIds = result.characters.map((c) => c.id);
        const characters = convCharIds.map((id) => {
          const found = ALL_CHARACTERS.find((c) => c.id === id);
          if (!found) throw new Error(`Character "${id}" not found in dataset (from ${file})`);
          return found;
        });

        const aliasMap = reconstructAliasMap(result.characters, ALL_CHARACTERS);
        const label = `[${i + 1}/${total}] ${result.scenario_id} · ${result.characters.map((ch) => ch.name).join(" + ")}`;
        const conversationId = file.replace(".yaml", "");

        const lines: string[] = [];
        try {
          const guessingResult = await runJudges(result, aliasMap, characters, scenario, config.judges, config.baseUrl, apiKey, tracker, conversationId, (line) => lines.push(line));
          const allCorrect = guessingResult.judges.every((j) => j.all_correct);
          const wrongCount = guessingResult.judges.filter((j) => !j.all_correct).length;
          const status = allCorrect
            ? `${col.green}✓${col.reset}`
            : `${col.red}✗ ${wrongCount}/${guessingResult.judges.length} judges wrong${col.reset}`;
          process.stdout.write(`${label}  ${status}\n`);
          for (const line of lines) process.stdout.write(line);
          process.stdout.write("\n");
          return guessingResult;
        } catch (err) {
          process.stdout.write(`${col.boldRed}${label}  ✗ failed${col.reset}\n`);
          for (const line of lines) process.stdout.write(line);
          process.stdout.write("\n");
          throw new Error(`${label} failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
        }
      }),
    );

    writeGuessingResult(judgeRunDir, guessingResults);

    const costsPath = join(config.evalDir, "costs", `${PASS_DIRS.judge}.yaml`);
    await tracker.flush(costsPath);
    try { await fetchPassCosts(costsPath); } catch (err) {
      process.stderr.write(`[costs] Cost fetch failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }

    console.log(`\nDone. Results written to ${judgeRunDir}/guessing_result.yaml`);
  } catch (err) {
    rmSync(judgeRunDir, { recursive: true, force: true });
    console.error(`\nJudging failed — removed incomplete directory: ${judgeRunDir}`);
    throw err;
  }
}
```

- [ ] **Step 2: Update `reconstruct/pass.ts`**

```ts
// evaluation/reconstruct/pass.ts
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadReconstructConfig } from "./config";
import { runReconstructionForConversation } from "./index";
import { initReconstructOutputDir, writeReconstructResults, writeSummary } from "./writer";
import { computeSummary } from "./scoring";
import { CostTracker } from "../cost/tracker";
import { fetchPassCosts } from "../cost/fetcher";
import { loadConversationEntries } from "../shared/loader";
import { PASS_DIRS } from "../shared/constants";
import type { CharacterRecord, ScenarioRecord } from "../generator/config";
import type { ConversationReconstructionResult } from "./types";

import rawCharacters from "../dataset/characters.yaml";
import rawScenarios from "../dataset/scenarios.yaml";

const ALL_CHARACTERS = rawCharacters as CharacterRecord[];
const ALL_SCENARIOS = rawScenarios as ScenarioRecord[];

export async function runReconstructionPass(configPath: string, evalName: string): Promise<void> {
  const rawConfigText = readFileSync(configPath, "utf-8");
  const config = loadReconstructConfig(rawConfigText, evalName);
  const apiKey = process.env["LLM_API_KEY"]!;

  const outputDir = initReconstructOutputDir(config.evalDir, config);
  const tracker = new CostTracker();

  try {
    const allEntries = loadConversationEntries(config.conversationsDir);

    const processable = allEntries.filter(({ file, result, i }) => {
      if (!result.messages || result.messages.length === 0) {
        console.log(`[${i + 1}/${allEntries.length}] ${file} — skipped (failed conversation)`);
        return false;
      }
      return true;
    });

    if (processable.length === 0) {
      throw new Error("No processable conversations found — all files were skipped or empty.");
    }

    const allResults: ConversationReconstructionResult[] = await Promise.all(
      processable.map(async ({ file, result, i }) => {
        const scenario = ALL_SCENARIOS.find((s) => s.id === result.scenario_id);
        if (!scenario) throw new Error(`Scenario "${result.scenario_id}" not found (from ${file})`);

        const characters = result.characters.map((c) => {
          const found = ALL_CHARACTERS.find((r) => r.id === c.id);
          if (!found) throw new Error(`Character "${c.id}" not found (from ${file})`);
          return found;
        });

        const label = `[${i + 1}/${allEntries.length}] ${result.scenario_id} · ${result.characters.map((c) => c.name).join(" + ")}`;
        const conversationId = file.replace(".yaml", "");

        console.log(`${label} — started`);
        try {
          const convResult = await runReconstructionForConversation(result, file, scenario, characters, config, apiKey, tracker, conversationId);
          console.log(`${label} ✓`);
          return convResult;
        } catch (err) {
          throw new Error(`${label} failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
        }
      }),
    );

    writeReconstructResults(outputDir, allResults);
    writeSummary(outputDir, computeSummary(allResults, config.comparators.map((c) => c.model), config.segments));

    const costsPath = join(config.evalDir, "costs", `${PASS_DIRS.reconstruct}.yaml`);
    await tracker.flush(costsPath);
    try { await fetchPassCosts(costsPath); } catch (err) {
      process.stderr.write(`[costs] Cost fetch failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }

    console.log(`\nDone. Results written to ${outputDir}/`);
  } catch (err) {
    rmSync(outputDir, { recursive: true, force: true });
    console.error(`\nReconstruction failed — removed incomplete output: ${outputDir}`);
    throw err;
  }
}
```

- [ ] **Step 3: Update `drift/pass.ts`**

```ts
// evaluation/drift/pass.ts
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadDriftConfig } from "./config";
import { runDriftForConversation } from "./index";
import { initDriftOutputDir, writeConversationResults, writeSummary } from "./writer";
import { computeScenarioSummaries } from "./scoring";
import { CostTracker } from "../cost/tracker";
import { fetchPassCosts } from "../cost/fetcher";
import { loadConversationEntries } from "../shared/loader";
import { PASS_DIRS } from "../shared/constants";
import type { CharacterRecord, ScenarioRecord } from "../generator/config";
import type { ConversationDriftResult } from "./types";

import rawCharacters from "../dataset/characters.yaml";
import rawScenarios from "../dataset/scenarios.yaml";

const ALL_CHARACTERS = rawCharacters as CharacterRecord[];
const ALL_SCENARIOS = rawScenarios as ScenarioRecord[];

export async function runDriftPass(configPath: string, evalName: string): Promise<void> {
  const rawConfigText = readFileSync(configPath, "utf-8");
  const config = loadDriftConfig(rawConfigText, evalName);
  const apiKey = process.env["LLM_API_KEY"]!;

  const outputDir = initDriftOutputDir(config.evalDir, config);
  const tracker = new CostTracker();

  try {
    const allEntries = loadConversationEntries(config.conversationsDir);

    const processable = allEntries.filter(({ file, result, i }) => {
      if (!result.messages || result.messages.length === 0) {
        console.log(`[${i + 1}/${allEntries.length}] ${file} — skipped (no messages)`);
        return false;
      }
      if (result.messages.length < config.segments) {
        console.log(`[${i + 1}/${allEntries.length}] ${file} — skipped (${result.messages.length} turns < ${config.segments} segments)`);
        return false;
      }
      return true;
    });

    if (processable.length === 0) {
      throw new Error("No conversations were successfully processed.");
    }

    const allResults: ConversationDriftResult[] = await Promise.all(
      processable.map(async ({ file, result, i }) => {
        const scenario = ALL_SCENARIOS.find((s) => s.id === result.scenario_id);
        if (!scenario) throw new Error(`Scenario "${result.scenario_id}" not found (${file})`);

        const characters = result.characters.map((c) => {
          const found = ALL_CHARACTERS.find((r) => r.id === c.id);
          if (!found) throw new Error(`Character "${c.id}" not found (${file})`);
          return found;
        });

        const label = `[${i + 1}/${allEntries.length}] ${result.scenario_id} · ${result.characters.map((c) => c.name).join(" + ")}`;
        const conversationId = file.replace(".yaml", "");

        console.log(`${label} — started`);
        try {
          const convResult = await runDriftForConversation(result, file, scenario, characters, config, apiKey, tracker, conversationId);
          console.log(`${label} ✓`);
          return convResult;
        } catch (err) {
          throw new Error(`${label} failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
        }
      }),
    );

    writeConversationResults(outputDir, allResults);
    writeSummary(outputDir, computeScenarioSummaries(allResults));

    const costsPath = join(config.evalDir, "costs", `${PASS_DIRS.drift}.yaml`);
    await tracker.flush(costsPath);
    try { await fetchPassCosts(costsPath); } catch (err) {
      process.stderr.write(`[costs] Cost fetch failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }

    console.log(`\nDone. ${allResults.length} conversations processed. Results: ${outputDir}/`);
  } catch (err) {
    rmSync(outputDir, { recursive: true, force: true });
    console.error(`\nDrift pass failed — removed incomplete output: ${outputDir}`);
    throw err;
  }
}
```

- [ ] **Step 4: Run typecheck**

```bash
bun run typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add evaluation/judge/pass.ts evaluation/reconstruct/pass.ts evaluation/drift/pass.ts
git commit -m "refactor(eval): pass.ts files use shared/loader and shared/constants"
```

---

## Task 17: Final verification

- [ ] **Step 1: Run full test suite**

```bash
bun test evaluation/
```

Expected: all tests pass (same count as before refactoring — 39+ tests across all suites).

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: clean output.

- [ ] **Step 3: Confirm deleted files are gone**

```bash
ls evaluation/reconstruct/segmenter.ts evaluation/drift/segment.ts 2>&1
```

Expected: `No such file or directory` for both.

- [ ] **Step 4: Spot-check prompt output unchanged**

Run a quick sanity check that the judge system prompt still contains the expected text:

```bash
bun --eval "
import { buildJudgeSystemPrompt } from './evaluation/judge/prompt.ts';
const p = buildJudgeSystemPrompt();
console.log(p.includes('behavioral analyst') ? 'PASS' : 'FAIL');
console.log(p.includes('Tier 1') ? 'PASS' : 'FAIL');
console.log(p.includes('Tier 2') ? 'PASS' : 'FAIL');
"
```

Expected: three `PASS` lines.

- [ ] **Step 5: Final commit if any stragglers**

```bash
git status
```

If clean, no commit needed. If any uncommitted changes, add and commit with appropriate message.
