# Evaluation Directory Refactoring — Design Spec

**Date:** 2026-06-07
**Scope:** `evaluation/` only. No changes to `frontend/`, `mcp_server/`, or `packages/shared/`.
**Constraint:** Identical behaviour and public CLI interfaces (`run_pipeline.ts`, per-pass entry points).

---

## Goals

1. Extract all LLM-facing prompt text from `.ts` files into Handlebars templates.
2. Eliminate ~700 lines of duplicated retry/call logic, entry-loading boilerplate, and score-label mappings.
3. Unify two segmenters (`reconstruct/segmenter.ts`, `drift/segment.ts`) into one.
4. Collect magic constants (pass names, drift thresholds, retry delays, label maps) into a single file.
5. Slim large functions without changing their logic.

---

## Directory Structure

```
evaluation/
├── shared/                        ← NEW
│   ├── constants.ts               ← pass names, drift thresholds, label maps, retry delays
│   ├── call.ts                    ← generic callWithRetry<T>()
│   ├── loader.ts                  ← shared entry-loading / filtering helpers
│   ├── segmenter.ts               ← unified segmenter (replaces two copies)
│   └── schema.ts                  ← shared response-format builder utilities
│
├── judge/
│   ├── prompts/                   ← NEW
│   │   ├── system.hbs
│   │   └── user.hbs
│   ├── prompt.ts                  ← now: compile + render templates only
│   ├── call.ts                    ← delegates to shared/call.ts
│   ├── alias.ts, config.ts, index.ts, pass.ts, schema.ts, types.ts, writer.ts
│   └── __tests__/
│
├── reconstruct/
│   ├── prompts/                   ← NEW
│   │   ├── reconstructor-system.hbs
│   │   ├── reconstructor-user.hbs
│   │   ├── comparator-system.hbs
│   │   └── comparator-user.hbs
│   ├── prompt.ts                  ← compile + render only
│   ├── call.ts                    ← delegates to shared/call.ts
│   ├── segmenter.ts               ← DELETED (replaced by shared/segmenter.ts)
│   ├── config.ts, index.ts, pass.ts, schema.ts, scoring.ts, types.ts, writer.ts
│   └── __tests__/
│
├── drift/
│   ├── prompts/                   ← NEW
│   │   ├── system.hbs
│   │   └── user.hbs
│   ├── prompt.ts                  ← compile + render only
│   ├── call.ts                    ← delegates to shared/call.ts
│   ├── segment.ts                 ← DELETED (replaced by shared/segmenter.ts)
│   ├── config.ts, index.ts, pass.ts, schema.ts, scoring.ts, types.ts, writer.ts
│   └── __tests__/
│
├── cost/                          ← unchanged
├── generator/                     ← unchanged
├── configs/                       ← unchanged
└── dataset/                       ← unchanged
```

---

## New Shared Modules

### `shared/constants.ts`

Collects every hardcoded string or number that appears in more than one file:

```ts
// Pass output directory names (used in config.ts and writer.ts of each pass)
export const PASS_DIRS = {
  judge: "judge_guessing",
  reconstruct: "reconstruct_persona",
  drift: "context_drift",
} as const;

// Drift scoring thresholds (used in drift/scoring.ts)
export const DRIFT_THRESHOLD_DEGRADING = -0.25;
export const DRIFT_THRESHOLD_IMPROVING = 0.25;

// Score label → numeric value maps (currently duplicated in drift/scoring.ts and reconstruct/scoring.ts)
export const ENGAGEMENT_SCORES: Record<string, number> = {
  active: 1, touched: 0.5, absent: 0,
};
export const ALIGNMENT_SCORES: Record<string, number> = {
  consistent: 1, neutral: 0.5, contradicts: 0,
};
export const COMPARATOR_SCORES: Record<string, number> = {
  match: 1, no_match: 0, contradiction: -0.5,
};

// Cost fetcher retry delays
export const COST_RETRY_DELAYS_MS = [3000, 6000, 12000];

// Filename padding widths
export const EVAL_DIR_PAD = 2;   // "eval-01"
export const CONV_FILE_PAD = 3;  // "001.yaml"

// Path safety validator
export function isSafePath(v: string): boolean {
  return !v.includes("/") && !v.includes("\\") && !v.includes("..");
}
```

### `shared/call.ts`

Single generic retry wrapper. All three `call.ts` files collapse to callers of this.

```ts
export interface CallResult<T> {
  result: T;
  usage: Usage | null;
}

export async function callWithRetry<T>(
  client: OpenAI,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  responseFormat: ResponseFormatJSONSchema,
  parse: (raw: string) => T,
  label: string,
  maxRetries = MAX_RETRIES,
): Promise<CallResult<T>>
```

- Handles the retry loop, back-off, error formatting, and usage extraction.
- `parse` is pass-supplied (each pass already has a Zod `.parse()` call).
- Returns `{ result, usage }` so callers can feed usage into the cost tracker unchanged.

### `shared/loader.ts`

Extracts the repeated "read conversations YAML, map to entries, filter invalid" logic from each `pass.ts`:

```ts
export function loadConversationEntries(
  conversationsDir: string,
  filter?: (entry: ConversationEntry) => boolean,
): ConversationEntry[]
```

### `shared/segmenter.ts`

Unified conversation segmenter. The two current implementations differ only in return type:

- `reconstruct/segmenter.ts` returns `Segment[]` (objects with metadata)
- `drift/segment.ts` returns `ConversationMessage[][]` (raw arrays)

The unified version returns `Segment[]`; drift's callers update to use `.messages` on each segment (one-line change per call site).

```ts
export interface Segment {
  index: number;
  messages: ConversationMessage[];
}

export function segmentConversation(
  messages: ConversationMessage[],
  windowSize: number,
  stride: number,
): Segment[]
```

### `shared/schema.ts`

`judge/schema.ts` and `drift/schema.ts` both export a constant named `judgeResponseFormat` with different JSON schemas (judge validates `assignments[]`; drift validates `scenario_engagement` + `character_alignment[]`). The name clash is the bug — not the schemas. Fix: rename each to its pass-specific name (`judgeGuessingResponseFormat`, `driftResponseFormat`) and keep them in their own `schema.ts`. No shared file needed for schemas — the value is in eliminating the misleading name collision.

---

## Prompt → Handlebars Migration

### Pattern

Each `prompt.ts` becomes a thin compiler:

```ts
import Handlebars from "handlebars";
import { readFileSync } from "fs";
import { join } from "path";

const systemTemplate = Handlebars.compile(
  readFileSync(join(__dirname, "prompts/system.hbs"), "utf8")
);

export function buildJudgeSystemPrompt(): string {
  return systemTemplate({});
}

export function buildJudgeUserMessage(data: JudgeUserData): string {
  return userTemplate(data);
}
```

Templates receive typed data objects. All prose, formatting, and example JSON structures live in the `.hbs` files. No logic in templates — Handlebars `{{variable}}`, `{{#each}}`, and `{{#if}}` only.

### Template variables per pass

**judge/prompts/user.hbs:** `scenario`, `transcript`, `profiles` (array), `realNames` (array), `aliases` (array)

**reconstruct/prompts/reconstructor-user.hbs:** `scenario`, `transcript`, `alias`, `fields` (array with name + definition)

**reconstruct/prompts/comparator-user.hbs:** `field`, `groundTruth` (array), `reconstructed` (array)

**drift/prompts/user.hbs:** `scenario`, `characters` (array with full sheet), `priorSegment` (optional), `currentSegment`

System prompts for all passes have no dynamic variables — they compile to static strings.

---

## Per-Pass Changes

### `judge/call.ts`

Before: ~65 lines with full retry loop.
After: ~15 lines — imports `callWithRetry`, passes `judgeResponseFormat` and `JudgeOutput.parse`.

### `reconstruct/call.ts`

Before: ~115 lines — two near-identical functions (`callReconstructor`, `callComparator`).
After: ~25 lines — both functions call `callWithRetry` with their respective schema and parser.

### `drift/call.ts`

Before: ~62 lines.
After: ~12 lines.

### `pass.ts` files (all three)

The repeated "load entries → validate → Promise.all → cost finalize" skeleton is extracted into helpers from `shared/loader.ts`. Each `pass.ts` keeps only its pass-specific logic (filtering criteria, result shape). Target: ~40 lines each (from 75–79).

### `reconstruct/index.ts`

Before: 213 lines, one function doing character iteration + segment iteration + API calls + scoring.
After: Split into focused helpers:
- `reconstructCharacter(entry, char, segments, ...)` — one character's reconstruction loop
- `scoreCharacter(reconstructed, groundTruth)` — scoring only
- `runReconstruction(entry, config, ...)` — top-level orchestrator, now ~40 lines

---

## What Does NOT Change

- All public function signatures visible from `pass.ts` upward.
- YAML config file format and paths.
- Output file structure written by `writer.ts` files.
- Cost tracking logic (only the call sites are de-duplicated).
- Test files — they test behaviour, not internals. Any test that breaks after this refactor is a signal that the behaviour changed (which is not allowed).
- `generator/` module — no issues warranting change.
- `cost/` module — `COST_RETRY_DELAYS_MS` moves to `shared/constants.ts`, nothing else.

---

## Handlebars Dependency

Handlebars (`^4.7.9`) is already declared in `packages/shared/package.json`. The evaluation scripts are run from the repo root via `bun run` and can import it directly from the monorepo's `node_modules`. No new `bun add` required.

---

## Testing Strategy

- Run the full existing test suite (`bun test --cwd mcp_server` passes; evaluation has its own `__tests__/` dirs).
- Run `bun run typecheck` — must pass clean.
- Smoke-test one pass end-to-end with a small dataset to confirm output files are identical.
- Any test that touches a deleted file (`segmenter.ts`, `segment.ts`) is updated to import from `shared/segmenter.ts`.
