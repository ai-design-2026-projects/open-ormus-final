# Unified Persona Evaluation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge `evaluation/drift/` into `evaluation/reconstruct/` so one module, one CLI, and one output schema handle both full-transcript and segmented evaluation via an optional `segments` config field (default 1).

**Architecture:** `reconstruct/` absorbs all of `drift/` — segmenter moves in, scoring absorbs slope/IC, index wraps the inner loop in a segment iteration, writer switches to per-conversation files. `drift/` and `drift_persona.ts` are deleted. The `segments: 1` default means all existing reconstruct configs work without modification.

**Tech Stack:** Bun, TypeScript strict mode, Zod, `bun:test`

---

## File map

| File | Action |
|------|--------|
| `evaluation/reconstruct/types.ts` | Modify: add `SegmentResult`, `FieldDriftScore`; update `CharacterResult`, `ConversationReconstructionResult`, `ValidatedReconstructConfig`; remove `CharacterScore` |
| `evaluation/reconstruct/config.ts` | Modify: add optional `segments` field (int ≥ 1, default 1) |
| `evaluation/reconstruct/segmenter.ts` | Create: moved from `drift/segmenter.ts` |
| `evaluation/reconstruct/__tests__/segmenter.test.ts` | Create: moved from `drift/__tests__/segmenter.test.ts` |
| `evaluation/reconstruct/scoring.ts` | Modify: absorb `computeSlope`, `computeFieldDriftScore`; remove `computeCharacterScore`; rewrite `computeSummary` |
| `evaluation/reconstruct/index.ts` | Modify: full rewrite — segment loop, slope+IC, hard error for thin conversations |
| `evaluation/reconstruct/writer.ts` | Modify: per-conversation files in `conversations/` subdir |
| `evaluation/reconstruct/pass.ts` | Modify: add `config.segments` to `computeSummary` call |
| `evaluation/reconstruct/__tests__/scoring.test.ts` | Modify: remove `computeCharacterScore` tests; add slope/IC/summary tests |
| `evaluation/reconstruct/__tests__/config.test.ts` | Modify: add `segments` field tests |
| `evaluation/reconstruct/__tests__/index.test.ts` | Create: thin-conversation hard error test |
| `evaluation/drift/` | Delete: entire directory |
| `evaluation/drift_persona.ts` | Delete |

---

### Task 1: Update `evaluation/reconstruct/types.ts`

**Files:**
- Modify: `evaluation/reconstruct/types.ts`

- [ ] **Step 1: Replace the entire file**

```typescript
import { z } from "zod";

export const PROFILE_FIELDS = [
  "personalityTraits",
  "speechPatterns",
  "values",
  "fears",
  "goals",
  "copingStyle",
] as const;

export type ProfileField = (typeof PROFILE_FIELDS)[number];

// ── Reconstructor output ──────────────────────────────────────────────────────

export const ReconstructedFieldSchema = z.object({
  not_observed: z.boolean(),
  items: z.array(z.string()),
});

export type ReconstructedField = z.infer<typeof ReconstructedFieldSchema>;

export const ReconstructorOutputSchema = z.object({
  fields: z.record(z.string(), ReconstructedFieldSchema),
});

export type ReconstructorOutput = z.infer<typeof ReconstructorOutputSchema>;

// ── Comparator output ─────────────────────────────────────────────────────────

export const ComparatorItemSchema = z.object({
  reconstructed_item: z.string(),
  score: z.number().refine((v) => v === 1 || v === 0 || v === -1, {
    message: "score must be 1, 0, or -1",
  }),
  justification: z.string().min(1),
});

export const ComparatorOutputSchema = z.object({
  item_scores: z.array(ComparatorItemSchema),
});

export type ComparatorOutput = z.infer<typeof ComparatorOutputSchema>;

// ── Scored results ────────────────────────────────────────────────────────────

export type ItemScore = {
  reconstructed_item: string;
  score: 1 | 0 | -1;
  justification: string;
  comparator_scores: Array<{ model: string; score: 1 | 0 | -1 }>;
  comparator_agreement: number;
};

export type FieldScore = {
  not_observed: boolean;
  observed_count: number;
  gt_count: number;
  matched: number;
  contradicted: number;
  precision: number;
  recall: number;
  f1: number;
  comparator_agreement: number;
  item_scores: ItemScore[];
};

// ── Drift output types ────────────────────────────────────────────────────────

export type SegmentResult = {
  segment_index: number;
  turn_range: [number, number];
  message_count: number;
  field_scores: Record<ProfileField, FieldScore>;
};

export type FieldDriftScore = {
  segment_f1s: Array<number | null>;
  observed_segments: number[];
  gt_divergence_slope: number | null;
  internal_consistency: FieldScore | null;
};

// ── Per-character and per-conversation results ────────────────────────────────

export type CharacterResult = {
  alias: string;
  real_name: string;
  difficulty_tier: string;
  segments: SegmentResult[];
  field_drift: Record<ProfileField, FieldDriftScore>;
  mean_gt_divergence_slope: number | null;
  mean_internal_consistency_f1: number | null;
};

export type ConversationReconstructionResult = {
  conversation_file: string;
  scenario_id: string;
  scenario_title: string;
  scenario_difficulty: string;
  scenario_stress_axes: string[];
  segment_count: number;
  characters: CharacterResult[];
};

// ── Config types ──────────────────────────────────────────────────────────────

export type ComparatorConfig = {
  label: string;
  model: string;
};

export type ValidatedReconstructConfig = {
  datasetDir: string;
  outputName: string;
  baseUrl: string;
  reconstructorModel: string;
  comparators: ComparatorConfig[];
  fields: ProfileField[];
  segments: number;
  rawConfigText: string;
};
```

- [ ] **Step 2: Commit**

```bash
git add evaluation/reconstruct/types.ts
git commit -m "refactor(eval): update reconstruct types for unified schema — add SegmentResult, FieldDriftScore, remove CharacterScore"
```

---

### Task 2: Update `evaluation/reconstruct/config.ts`

**Files:**
- Modify: `evaluation/reconstruct/config.ts`

- [ ] **Step 1: Add `segments` to the Zod schema**

In `ReconstructConfigSchema`, add after `comparators`:

```typescript
  segments: z.number().int().min(1).default(1),
```

- [ ] **Step 2: Add `segments` to the return value**

In `loadReconstructConfig`, add `segments: input.segments,` to the returned object.

The complete updated `loadReconstructConfig` return:

```typescript
  return {
    datasetDir,
    outputName: input.output_name,
    baseUrl: input.base_url,
    reconstructorModel: input.reconstructor.model,
    comparators,
    fields,
    segments: input.segments,
    rawConfigText,
  };
```

- [ ] **Step 3: Add tests for `segments`**

In `evaluation/reconstruct/__tests__/config.test.ts`, add inside the `describe("loadReconstructConfig")` block:

```typescript
  it("defaults segments to 1 when omitted", () => {
    const cfg = loadReconstructConfig(validYaml);
    expect(cfg.segments).toBe(1);
  });

  it("accepts explicit segments value", () => {
    const yaml = validYaml + "\nsegments: 3\n";
    const cfg = loadReconstructConfig(yaml);
    expect(cfg.segments).toBe(3);
  });

  it("throws when segments is 0", () => {
    const yaml = validYaml + "\nsegments: 0\n";
    expect(() => loadReconstructConfig(yaml)).toThrow();
  });
```

- [ ] **Step 4: Run tests**

```bash
bun test evaluation/reconstruct/__tests__/config.test.ts
```

Expected: all config tests pass (the existing tests plus 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add evaluation/reconstruct/config.ts evaluation/reconstruct/__tests__/config.test.ts
git commit -m "feat(eval): add optional segments field to reconstruct config (default 1)"
```

---

### Task 3: Move segmenter into `evaluation/reconstruct/`

**Files:**
- Create: `evaluation/reconstruct/segmenter.ts` (moved from `drift/segmenter.ts`)
- Create: `evaluation/reconstruct/__tests__/segmenter.test.ts` (moved from `drift/__tests__/segmenter.test.ts`)

The files are moved as-is. The imports in both files already use relative paths that resolve correctly at the new location:
- `segmenter.ts` imports `"../runner/conversation"` — same depth, still correct.
- `segmenter.test.ts` imports `"../segmenter"` and `"../../runner/conversation"` — same depth, still correct.

- [ ] **Step 1: Copy segmenter.ts**

Create `evaluation/reconstruct/segmenter.ts` with the exact content of `evaluation/drift/segmenter.ts`:

```typescript
import type { ConversationMessage } from "../runner/conversation";

export type Segment = {
  segment_index: number;
  turn_range: [number, number];
  messages: ConversationMessage[];
};

export function segmentConversation(messages: ConversationMessage[], n: number): Segment[] {
  if (messages.length === 0) return [];

  // Clamp to avoid empty slices when messages < n
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

Note: `warnIfThin` is NOT copied — it is replaced by the hard error in `index.ts` (Task 5).

- [ ] **Step 2: Copy segmenter.test.ts**

Create `evaluation/reconstruct/__tests__/segmenter.test.ts` with the exact content of `evaluation/drift/__tests__/segmenter.test.ts`. Do not include the `warnIfThin` describe block — it tests a function that no longer exists.

The file content:

```typescript
import { describe, test, expect } from "bun:test";
import { segmentConversation } from "../segmenter";
import type { ConversationMessage } from "../../runner/conversation";

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

  test("N=3: turn ranges are non-overlapping and cover all messages", () => {
    const segs = segmentConversation(makeMessages(9), 3);
    expect(segs).toHaveLength(3);
    const allTurns = segs.flatMap((s) => s.messages.map((m) => m.turn));
    expect(allTurns).toHaveLength(9);
    expect(new Set(allTurns).size).toBe(9);
    expect(allTurns[0]).toBe(1);
    expect(allTurns[allTurns.length - 1]).toBe(9);
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

  test("N=3 with 10 messages: last segment absorbs remainder", () => {
    const segs = segmentConversation(makeMessages(10), 3);
    expect(segs[0]!.messages).toHaveLength(3);
    expect(segs[1]!.messages).toHaveLength(3);
    expect(segs[2]!.messages).toHaveLength(4);
    const allTurns = segs.flatMap((s) => s.messages.map((m) => m.turn));
    expect(allTurns).toHaveLength(10);
  });

  test("N=6 on 5-message conversation: clamps to 5 segments, indices are 0-based contiguous", () => {
    const segs = segmentConversation(makeMessages(5), 6);
    expect(segs).toHaveLength(5);
    expect(segs.map((s) => s.segment_index)).toEqual([0, 1, 2, 3, 4]);
    const allTurns = segs.flatMap((s) => s.messages.map((m) => m.turn));
    expect(allTurns).toHaveLength(5);
    expect(new Set(allTurns).size).toBe(5);
  });

  test("N > messages: each segment has exactly 1 message", () => {
    const segs = segmentConversation(makeMessages(2), 5);
    expect(segs).toHaveLength(2);
    expect(segs.every((s) => s.messages.length >= 1)).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
bun test evaluation/reconstruct/__tests__/segmenter.test.ts
```

Expected: 8 tests pass, 0 fail.

- [ ] **Step 4: Commit**

```bash
git add evaluation/reconstruct/segmenter.ts evaluation/reconstruct/__tests__/segmenter.test.ts
git commit -m "refactor(eval): move segmenter into reconstruct module"
```

---

### Task 4: Rewrite `evaluation/reconstruct/scoring.ts`

**Files:**
- Modify: `evaluation/reconstruct/scoring.ts`

- [ ] **Step 1: Replace the entire file**

```typescript
import { PROFILE_FIELDS } from "./types";
import type {
  ProfileField,
  FieldScore,
  ItemScore,
  FieldDriftScore,
  CharacterResult,
  ConversationReconstructionResult,
} from "./types";

export function majorityVote(scores: number[]): 1 | 0 | -1 {
  if (scores.length === 0) return 0;
  const positives = scores.filter((s) => s === 1).length;
  const negatives = scores.filter((s) => s === -1).length;
  const half = scores.length / 2;
  if (positives > half) return 1;
  if (negatives > half) return -1;
  return 0;
}

export function computeAgreement(scores: number[]): number {
  if (scores.length <= 1) return 1.0;
  const majority = majorityVote(scores);
  return scores.filter((s) => s === majority).length / scores.length;
}

type ComparatorItemOutput = { reconstructed_item: string; score: number; justification: string };
type ComparatorOutput = { model: string; scores: ComparatorItemOutput[] };

export function buildItemScores(
  reconstructedItems: string[],
  comparatorOutputs: ComparatorOutput[],
): ItemScore[] {
  return reconstructedItems.map((item, idx) => {
    const comparatorScores = comparatorOutputs.map((c) => {
      const raw = c.scores[idx]?.score ?? 0;
      const score = (raw === 1 ? 1 : raw === -1 ? -1 : 0) as 1 | 0 | -1;
      return { model: c.model, score };
    });
    const allScores = comparatorScores.map((c) => c.score);
    const score = majorityVote(allScores);
    const justification =
      comparatorOutputs.find((c) => {
        const s = c.scores[idx]?.score ?? 0;
        return (s === 1 ? 1 : s === -1 ? -1 : 0) === score;
      })?.scores[idx]?.justification ?? "";

    return {
      reconstructed_item: item,
      score,
      justification,
      comparator_scores: comparatorScores,
      comparator_agreement: computeAgreement(allScores),
    };
  });
}

export function computeFieldScore(
  not_observed: boolean,
  gtItems: string[],
  itemScores: ItemScore[],
): FieldScore {
  if (not_observed || itemScores.length === 0) {
    return {
      not_observed: true,
      observed_count: 0,
      gt_count: gtItems.length,
      matched: 0,
      contradicted: 0,
      precision: 0,
      recall: 0,
      f1: 0,
      comparator_agreement: 1.0,
      item_scores: [],
    };
  }

  const matched = itemScores.filter((is) => is.score === 1).length;
  const contradicted = itemScores.filter((is) => is.score === -1).length;
  const observed_count = itemScores.length;
  const precision = observed_count > 0 ? matched / observed_count : 0;
  const recall = gtItems.length > 0 ? matched / gtItems.length : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const comparator_agreement =
    itemScores.reduce((s, is) => s + is.comparator_agreement, 0) / itemScores.length;

  return {
    not_observed: false,
    observed_count,
    gt_count: gtItems.length,
    matched,
    contradicted,
    precision,
    recall,
    f1,
    comparator_agreement,
    item_scores: itemScores,
  };
}

// OLS slope for y = a + b*x. Returns null when fewer than 2 points.
export function computeSlope(xIndices: number[], yValues: number[]): number | null {
  const n = xIndices.length;
  if (n < 2) return null;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += xIndices[i]!;
    sumY += yValues[i]!;
    sumXY += xIndices[i]! * yValues[i]!;
    sumX2 += xIndices[i]! * xIndices[i]!;
  }

  const denom = n * sumX2 - sumX * sumX;
  // denom === 0 means all x-indices are identical — trend is undefined, not measured-flat
  if (denom === 0) return null;
  return (n * sumXY - sumX * sumY) / denom;
}

export function computeFieldDriftScore(
  segmentF1s: Array<number | null>,
  internalConsistency: FieldScore | null,
): FieldDriftScore {
  const observedSegments = segmentF1s
    .map((f1, i) => (f1 !== null ? i : null))
    .filter((i): i is number => i !== null);

  const observedF1s = observedSegments.map((i) => segmentF1s[i]!);
  const gt_divergence_slope = computeSlope(observedSegments, observedF1s);

  return {
    segment_f1s: segmentF1s,
    observed_segments: observedSegments,
    gt_divergence_slope,
    internal_consistency: internalConsistency,
  };
}

// ── Summary aggregation ───────────────────────────────────────────────────────

type FieldAggregate = {
  mean_f1: number | null;
  mean_gt_divergence_slope: number | null;
  mean_internal_consistency_f1: number | null;
  drifting_fraction: number;
};

type TierAggregate = {
  count: number;
  mean_gt_divergence_slope: number | null;
  mean_internal_consistency_f1: number | null;
};

export type ReconstructionSummary = {
  total_conversations: number;
  total_characters_evaluated: number;
  segment_count: number;
  comparator_models: string[];
  mean_inter_comparator_agreement: number;
  field_aggregates: Record<ProfileField, FieldAggregate>;
  by_difficulty: Record<string, TierAggregate>;
  by_tier: Record<string, TierAggregate>;
  most_drifting: Array<{
    conversation_file: string;
    alias: string;
    real_name: string;
    mean_gt_divergence_slope: number;
    mean_internal_consistency_f1: number | null;
  }>;
};

export function computeSummary(
  results: ConversationReconstructionResult[],
  comparatorModels: string[],
  segmentCount: number,
): ReconstructionSummary {
  const allChars = results.flatMap((r) => r.characters);

  const fieldAgg = (field: ProfileField): FieldAggregate => {
    const f1s = allChars.flatMap((c) =>
      c.segments
        .map((s) => s.field_scores[field])
        .filter((fs): fs is FieldScore => fs !== undefined && !fs.not_observed)
        .map((fs) => fs.f1),
    );

    const slopes = allChars
      .map((c) => c.field_drift[field]?.gt_divergence_slope ?? null)
      .filter((s): s is number => s !== null);

    const icF1s = allChars
      .map((c) => c.field_drift[field]?.internal_consistency?.f1 ?? null)
      .filter((f): f is number => f !== null);

    return {
      mean_f1: f1s.length > 0 ? f1s.reduce((a, b) => a + b, 0) / f1s.length : null,
      mean_gt_divergence_slope:
        slopes.length > 0 ? slopes.reduce((a, b) => a + b, 0) / slopes.length : null,
      mean_internal_consistency_f1:
        icF1s.length > 0 ? icF1s.reduce((a, b) => a + b, 0) / icF1s.length : null,
      drifting_fraction:
        slopes.length > 0 ? slopes.filter((s) => s < 0).length / slopes.length : 0,
    };
  };

  const tierAgg = (chars: CharacterResult[]): TierAggregate => {
    const slopes = chars
      .map((c) => c.mean_gt_divergence_slope)
      .filter((s): s is number => s !== null);
    const icF1s = chars
      .map((c) => c.mean_internal_consistency_f1)
      .filter((f): f is number => f !== null);
    return {
      count: chars.length,
      mean_gt_divergence_slope:
        slopes.length > 0 ? slopes.reduce((a, b) => a + b, 0) / slopes.length : null,
      mean_internal_consistency_f1:
        icF1s.length > 0 ? icF1s.reduce((a, b) => a + b, 0) / icF1s.length : null,
    };
  };

  const allItemScores = allChars.flatMap((c) =>
    c.segments.flatMap((s) =>
      PROFILE_FIELDS.flatMap((f) => s.field_scores[f]?.item_scores ?? []),
    ),
  );
  const mean_inter_comparator_agreement =
    allItemScores.length > 0
      ? allItemScores.reduce((s, is) => s + is.comparator_agreement, 0) / allItemScores.length
      : 1.0;

  const difficultyGroups: Record<string, CharacterResult[]> = {};
  const tierGroups: Record<string, CharacterResult[]> = {};

  for (const conv of results) {
    difficultyGroups[conv.scenario_difficulty] ??= [];
    for (const char of conv.characters) {
      difficultyGroups[conv.scenario_difficulty]!.push(char);
      tierGroups[char.difficulty_tier] ??= [];
      tierGroups[char.difficulty_tier]!.push(char);
    }
  }

  const mostDrifting = allChars
    .filter(
      (c): c is CharacterResult & { mean_gt_divergence_slope: number } =>
        c.mean_gt_divergence_slope !== null,
    )
    .sort((a, b) => a.mean_gt_divergence_slope - b.mean_gt_divergence_slope)
    .slice(0, 10)
    .map((c) => {
      const conv = results.find((r) => r.characters.includes(c))!;
      return {
        conversation_file: conv.conversation_file,
        alias: c.alias,
        real_name: c.real_name,
        mean_gt_divergence_slope: c.mean_gt_divergence_slope,
        mean_internal_consistency_f1: c.mean_internal_consistency_f1,
      };
    });

  return {
    total_conversations: results.length,
    total_characters_evaluated: allChars.length,
    segment_count: segmentCount,
    comparator_models: comparatorModels,
    mean_inter_comparator_agreement,
    field_aggregates: Object.fromEntries(
      PROFILE_FIELDS.map((f) => [f, fieldAgg(f)]),
    ) as Record<ProfileField, FieldAggregate>,
    by_difficulty: Object.fromEntries(
      Object.entries(difficultyGroups).map(([k, v]) => [k, tierAgg(v)]),
    ),
    by_tier: Object.fromEntries(
      Object.entries(tierGroups).map(([k, v]) => [k, tierAgg(v)]),
    ),
    most_drifting: mostDrifting,
  };
}
```

- [ ] **Step 2: Commit (tests will be updated in Task 8)**

```bash
git add evaluation/reconstruct/scoring.ts
git commit -m "refactor(eval): absorb slope/IC scoring into reconstruct, rewrite computeSummary for unified schema"
```

---

### Task 5: Rewrite `evaluation/reconstruct/index.ts`

**Files:**
- Modify: `evaluation/reconstruct/index.ts`

This is the core change: wrap the inner loop in a segment loop, add the thin-conversation hard error, add IC computation, remove `computeCharacterScore`. Note that `prompt.ts` exports functions (`buildReconstructorSystemPrompt()`, `buildComparatorSystemPrompt()`), not constants — use function calls.

- [ ] **Step 1: Replace the entire file**

```typescript
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
import { segmentConversation } from "./segmenter";
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
import type { CharacterRecord, ScenarioRecord } from "../runner/config";
import type { ConversationResult } from "../runner/conversation";

function getGtItems(char: CharacterRecord, field: ProfileField): string[] {
  return (char[field as keyof CharacterRecord] as string[] | undefined) ?? [];
}

export async function runReconstructionForConversation(
  result: ConversationResult,
  fileName: string,
  scenario: ScenarioRecord,
  characters: CharacterRecord[],
  config: ValidatedReconstructConfig,
  apiKey: string,
): Promise<ConversationReconstructionResult> {
  const strippedMessages = result.messages.map((m) => ({
    ...m,
    reasoning: "",
    subtext: "",
  }));

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

  const charResults: CharacterResult[] = [];

  for (const convChar of result.characters) {
    const alias = convChar.name;
    const realName = aliasMap[alias] ?? alias;
    const charRecord = characters.find((c) => c.id === convChar.id);
    if (!charRecord) throw new Error(`Character ${convChar.id} not found in dataset`);

    console.log(`  [${alias} → ${realName}] reconstructing ${config.segments} segments…`);

    // ── Step 1: Reconstruct + score vs GT for each segment ───────────────────
    const segmentResults: SegmentResult[] = [];
    const segmentFields: Array<Partial<Record<ProfileField, ReconstructedField>>> = [];

    for (const seg of segments) {
      const userMsg = buildReconstructorUserMessage(alias, scenario, seg.messages, config.fields);

      const reconstruction = await callReconstructor(
        client,
        config.reconstructorModel,
        reconstructorSysPrompt,
        userMsg,
        config.fields,
        `reconstructor:${alias}:seg${seg.segment_index}`,
      );

      const fieldScores: Partial<Record<ProfileField, FieldScore>> = {};
      const reconFields: Partial<Record<ProfileField, ReconstructedField>> = {};

      for (const field of config.fields) {
        const reconField = reconstruction.fields[field];
        reconFields[field] = reconField;

        const notObserved =
          !reconField || reconField.not_observed || reconField.items.length === 0;

        if (notObserved) {
          fieldScores[field] = computeFieldScore(true, getGtItems(charRecord, field), []);
          continue;
        }

        const gtItems = getGtItems(charRecord, field);
        const comparatorOutputs = await Promise.all(
          config.comparators.map(async (comp) => {
            const compUserMsg = buildComparatorUserMessage(field, gtItems, reconField.items);
            const output = await callComparator(
              client,
              comp.model,
              comparatorSysPrompt,
              compUserMsg,
              `${comp.label}:${alias}:seg${seg.segment_index}:${field}`,
            );
            return { model: comp.model, scores: output.item_scores };
          }),
        );

        const itemScores = buildItemScores(reconField.items, comparatorOutputs);
        fieldScores[field] = computeFieldScore(false, gtItems, itemScores);
      }

      for (const field of PROFILE_FIELDS) {
        if (!fieldScores[field]) {
          fieldScores[field] = computeFieldScore(true, [], []);
        }
      }

      segmentResults.push({
        segment_index: seg.segment_index,
        turn_range: seg.turn_range,
        message_count: seg.messages.length,
        field_scores: fieldScores as Record<ProfileField, FieldScore>,
      });

      segmentFields.push(reconFields);
    }

    // ── Step 2: Compute drift metrics per field ───────────────────────────────
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
        seg0Field &&
        !seg0Field.not_observed &&
        seg0Field.items.length > 0 &&
        segNField &&
        !segNField.not_observed &&
        segNField.items.length > 0
      ) {
        process.stdout.write(`    [${field}] internal consistency seg0 vs segN…`);

        const compOutputs = await Promise.all(
          config.comparators.map(async (comp) => {
            const compUserMsg = buildComparatorUserMessage(
              field,
              seg0Field.items,
              segNField.items,
            );
            const output = await callComparator(
              client,
              comp.model,
              comparatorSysPrompt,
              compUserMsg,
              `${comp.label}:${alias}:internal:${field}`,
            );
            return { model: comp.model, scores: output.item_scores };
          }),
        );

        const itemScores = buildItemScores(segNField.items, compOutputs);
        internalConsistency = computeFieldScore(false, seg0Field.items, itemScores);
        process.stdout.write(" done\n");
      }

      fieldDrift[field] = computeFieldDriftScore(segmentF1s, internalConsistency);
    }

    // ── Step 3: Aggregate per character ──────────────────────────────────────
    const slopes = PROFILE_FIELDS.map(
      (f) => fieldDrift[f]?.gt_divergence_slope ?? null,
    ).filter((s): s is number => s !== null);

    const icF1s = PROFILE_FIELDS.map(
      (f) => fieldDrift[f]?.internal_consistency?.f1 ?? null,
    ).filter((f): f is number => f !== null);

    charResults.push({
      alias,
      real_name: realName,
      difficulty_tier: charRecord.difficultyTier,
      segments: segmentResults,
      field_drift: fieldDrift as Record<ProfileField, FieldDriftScore>,
      mean_gt_divergence_slope:
        slopes.length > 0 ? slopes.reduce((s, v) => s + v, 0) / slopes.length : null,
      mean_internal_consistency_f1:
        icF1s.length > 0 ? icF1s.reduce((s, v) => s + v, 0) / icF1s.length : null,
    });
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

- [ ] **Step 2: Commit**

```bash
git add evaluation/reconstruct/index.ts
git commit -m "refactor(eval): unify reconstruction loop — segment iteration, slope+IC, hard error for thin conversations"
```

---

### Task 6: Update `evaluation/reconstruct/writer.ts`

**Files:**
- Modify: `evaluation/reconstruct/writer.ts`

- [ ] **Step 1: Replace the entire file**

Switch from one big `reconstruction_result.yaml` to per-conversation files in a `conversations/` subdir (same layout as drift).

```typescript
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import type { ConversationReconstructionResult } from "./types";
import type { ReconstructionSummary } from "./scoring";

export function initReconstructOutputDir(
  datasetDir: string,
  outputName: string,
  rawConfigText: string,
): string {
  const outputDir = join(datasetDir, "reconstruct_persona", outputName);
  mkdirSync(join(outputDir, "conversations"), { recursive: true });
  writeFileSync(join(outputDir, "config.yaml"), rawConfigText, "utf-8");
  return outputDir;
}

export function writeReconstructResults(
  outputDir: string,
  results: ConversationReconstructionResult[],
): void {
  for (const result of results) {
    writeFileSync(
      join(outputDir, "conversations", result.conversation_file),
      stringify(result),
      "utf-8",
    );
  }
}

export function writeSummary(outputDir: string, summary: ReconstructionSummary): void {
  writeFileSync(join(outputDir, "summary.yaml"), stringify(summary), "utf-8");
}
```

- [ ] **Step 2: Commit**

```bash
git add evaluation/reconstruct/writer.ts
git commit -m "refactor(eval): switch reconstruct writer to per-conversation files"
```

---

### Task 7: Update `evaluation/reconstruct/pass.ts`

**Files:**
- Modify: `evaluation/reconstruct/pass.ts`

The only change is passing `config.segments` as the third argument to `computeSummary`.

- [ ] **Step 1: Update the `computeSummary` call**

Find this line:
```typescript
writeSummary(outputDir, computeSummary(allResults, config.comparators.map((c) => c.model)));
```

Replace with:
```typescript
writeSummary(outputDir, computeSummary(allResults, config.comparators.map((c) => c.model), config.segments));
```

- [ ] **Step 2: Commit**

```bash
git add evaluation/reconstruct/pass.ts
git commit -m "fix(eval): pass segments count to computeSummary in reconstruct pass"
```

---

### Task 8: Update `evaluation/reconstruct/__tests__/scoring.test.ts`

**Files:**
- Modify: `evaluation/reconstruct/__tests__/scoring.test.ts`

Remove the `computeCharacterScore` describe block. Add `computeSlope`, `computeFieldDriftScore`, and updated `computeSummary` tests (ported from `drift/__tests__/scoring.test.ts` with type names updated).

- [ ] **Step 1: Replace the entire file**

```typescript
import { describe, test, it, expect } from "bun:test";
import {
  majorityVote,
  computeAgreement,
  buildItemScores,
  computeFieldScore,
  computeSlope,
  computeFieldDriftScore,
  computeSummary,
} from "../scoring";
import type { ItemScore, FieldScore, CharacterResult, ConversationReconstructionResult } from "../types";

describe("majorityVote", () => {
  it("returns 1 when sum is positive", () => expect(majorityVote([1, 1, 0])).toBe(1));
  it("returns -1 when sum is negative", () => expect(majorityVote([0, -1, -1])).toBe(-1));
  it("returns 0 on tie", () => expect(majorityVote([1, -1])).toBe(0));
  it("returns 0 for empty", () => expect(majorityVote([])).toBe(0));
});

describe("computeAgreement", () => {
  it("returns 1.0 for unanimous", () => expect(computeAgreement([1, 1, 1])).toBe(1.0));
  it("returns 2/3 for 2-of-3", () => {
    expect(computeAgreement([1, 1, -1])).toBeCloseTo(2 / 3);
  });
  it("returns 1.0 for single comparator", () => expect(computeAgreement([1])).toBe(1.0));
});

describe("buildItemScores", () => {
  it("computes majority score and agreement per item", () => {
    const items = ["brave", "reckless"];
    const outputs = [
      { model: "m1", scores: [{ reconstructed_item: "brave", score: 1, justification: "j1" }, { reconstructed_item: "reckless", score: 0, justification: "j2" }] },
      { model: "m2", scores: [{ reconstructed_item: "brave", score: 1, justification: "j3" }, { reconstructed_item: "reckless", score: -1, justification: "j4" }] },
    ];
    const result = buildItemScores(items, outputs);
    expect(result[0]!.score).toBe(1);
    expect(result[0]!.comparator_agreement).toBe(1.0);
    expect(result[1]!.score).toBe(0);
  });
});

describe("computeFieldScore", () => {
  it("returns not_observed when flag is true", () => {
    const fs = computeFieldScore(true, ["courage"], []);
    expect(fs.not_observed).toBe(true);
    expect(fs.matched).toBe(0);
  });

  it("computes precision/recall/f1 correctly", () => {
    const items: ItemScore[] = [
      { reconstructed_item: "a", score: 1, justification: "j", comparator_scores: [], comparator_agreement: 1 },
      { reconstructed_item: "b", score: 0, justification: "j", comparator_scores: [], comparator_agreement: 1 },
      { reconstructed_item: "c", score: -1, justification: "j", comparator_scores: [], comparator_agreement: 1 },
    ];
    const fs = computeFieldScore(false, ["x", "y"], items);
    expect(fs.observed_count).toBe(3);
    expect(fs.gt_count).toBe(2);
    expect(fs.matched).toBe(1);
    expect(fs.contradicted).toBe(1);
    expect(fs.precision).toBeCloseTo(1 / 3);
    expect(fs.recall).toBeCloseTo(1 / 2);
    expect(fs.f1).toBeCloseTo((2 * (1 / 3) * (1 / 2)) / (1 / 3 + 1 / 2));
  });

  it("handles zero gt_count without NaN", () => {
    const items: ItemScore[] = [
      { reconstructed_item: "x", score: 0, justification: "j", comparator_scores: [], comparator_agreement: 1 },
    ];
    const fs = computeFieldScore(false, [], items);
    expect(fs.recall).toBe(0);
    expect(fs.f1).toBe(0);
  });
});

// ── computeSlope ──────────────────────────────────────────────────────────────

describe("computeSlope", () => {
  test("returns null for empty input", () => {
    expect(computeSlope([], [])).toBeNull();
  });

  test("returns null for single point", () => {
    expect(computeSlope([0], [0.8])).toBeNull();
  });

  test("positive slope from two points", () => {
    expect(computeSlope([0, 1], [0.5, 0.8])).toBeCloseTo(0.3, 5);
  });

  test("negative slope from three points", () => {
    expect(computeSlope([0, 1, 2], [0.9, 0.6, 0.3])).toBeCloseTo(-0.3, 5);
  });

  test("flat line returns slope ~0", () => {
    expect(computeSlope([0, 1, 2], [0.5, 0.5, 0.5])).toBeCloseTo(0, 5);
  });

  test("non-consecutive x indices (skipped segment)", () => {
    expect(computeSlope([0, 2], [0.8, 0.4])).toBeCloseTo(-0.2, 5);
  });
});

// ── computeFieldDriftScore ────────────────────────────────────────────────────

function makeFieldScore(f1: number): FieldScore {
  return {
    not_observed: false,
    observed_count: 1,
    gt_count: 1,
    matched: 1,
    contradicted: 0,
    precision: f1,
    recall: f1,
    f1,
    comparator_agreement: 1,
    item_scores: [],
  };
}

describe("computeFieldDriftScore", () => {
  test("null slope when only 1 segment observed", () => {
    const result = computeFieldDriftScore([0.7, null, null], null);
    expect(result.gt_divergence_slope).toBeNull();
    expect(result.observed_segments).toEqual([0]);
    expect(result.segment_f1s).toEqual([0.7, null, null]);
  });

  test("computes slope across 3 observed segments", () => {
    const result = computeFieldDriftScore([0.9, 0.6, 0.3], null);
    expect(result.gt_divergence_slope).toBeCloseTo(-0.3, 5);
    expect(result.observed_segments).toEqual([0, 1, 2]);
  });

  test("excludes null segments from slope — uses correct x indices", () => {
    const result = computeFieldDriftScore([0.9, null, 0.3], null);
    expect(result.gt_divergence_slope).toBeCloseTo(-0.3, 5);
    expect(result.observed_segments).toEqual([0, 2]);
  });

  test("null slope when no segments observed", () => {
    const result = computeFieldDriftScore([null, null, null], null);
    expect(result.gt_divergence_slope).toBeNull();
    expect(result.observed_segments).toEqual([]);
  });

  test("internal_consistency null is preserved", () => {
    const result = computeFieldDriftScore([0.8, 0.5], null);
    expect(result.internal_consistency).toBeNull();
  });

  test("internal_consistency FieldScore is preserved", () => {
    const ic = makeFieldScore(0.75);
    const result = computeFieldDriftScore([0.8, 0.5], ic);
    expect(result.internal_consistency).toBe(ic);
  });
});

// ── computeSummary ────────────────────────────────────────────────────────────

function makeChar(
  alias: string,
  personalityF1s: Array<number | null>,
  meanSlope: number | null,
  meanIC: number | null,
  tier = "tier-1",
): CharacterResult {
  const allNullDrift = computeFieldDriftScore([null, null], null);
  return {
    alias,
    real_name: alias,
    difficulty_tier: tier,
    segments: [],
    field_drift: {
      personalityTraits: computeFieldDriftScore(personalityF1s, null),
      speechPatterns: allNullDrift,
      values: allNullDrift,
      fears: allNullDrift,
      goals: allNullDrift,
      copingStyle: allNullDrift,
    },
    mean_gt_divergence_slope: meanSlope,
    mean_internal_consistency_f1: meanIC,
  };
}

function makeResult(
  file: string,
  char: CharacterResult,
  difficulty = "medium",
): ConversationReconstructionResult {
  return {
    conversation_file: file,
    scenario_id: "scen_001",
    scenario_title: "Test Scenario",
    scenario_difficulty: difficulty,
    scenario_stress_axes: [],
    segment_count: 2,
    characters: [char],
  };
}

describe("computeSummary", () => {
  test("total counts are correct", () => {
    const results = [
      makeResult("conv_001.yaml", makeChar("Alice", [0.8, 0.5], -0.3, 0.7)),
      makeResult("conv_002.yaml", makeChar("Bob", [0.4, 0.6], 0.2, null)),
    ];
    const summary = computeSummary(results, ["model-a"], 2);
    expect(summary.total_conversations).toBe(2);
    expect(summary.total_characters_evaluated).toBe(2);
    expect(summary.segment_count).toBe(2);
  });

  test("most_drifting excludes null-slope characters and sorts most-negative first", () => {
    const results = [
      makeResult("conv_001.yaml", makeChar("A", [0.9, 0.4], -0.5, null)),
      makeResult("conv_002.yaml", makeChar("B", [null, null], null, null)),
      makeResult("conv_003.yaml", makeChar("C", [0.8, 0.7], -0.1, 0.8)),
    ];
    const summary = computeSummary(results, ["m"], 2);
    expect(summary.most_drifting).toHaveLength(2);
    expect(summary.most_drifting[0]!.mean_gt_divergence_slope).toBeCloseTo(-0.5);
    expect(summary.most_drifting[1]!.mean_gt_divergence_slope).toBeCloseTo(-0.1);
  });

  test("drifting_fraction denominator excludes characters with null slope", () => {
    const results = [
      makeResult("conv_001.yaml", makeChar("Alice", [0.8, 0.4], -0.4, null)),
      makeResult("conv_002.yaml", makeChar("Bob", [0.4, 0.8], 0.4, null)),
      makeResult("conv_003.yaml", makeChar("Carol", [null, null], null, null)),
    ];
    const summary = computeSummary(results, ["m"], 2);
    expect(summary.field_aggregates.personalityTraits!.drifting_fraction).toBeCloseTo(0.5);
  });

  test("null vs 0 preserved — field with no observed segments stays null in aggregates", () => {
    const results = [
      makeResult("conv_001.yaml", makeChar("Alice", [null, null], null, null)),
    ];
    const summary = computeSummary(results, ["m"], 2);
    expect(summary.field_aggregates.speechPatterns!.mean_gt_divergence_slope).toBeNull();
    expect(summary.field_aggregates.personalityTraits!.mean_gt_divergence_slope).toBeNull();
  });

  test("segments=1: no slopes, empty most_drifting, drifting_fraction=0", () => {
    const char: CharacterResult = {
      alias: "Alice",
      real_name: "Alice",
      difficulty_tier: "tier-1",
      segments: [],
      field_drift: {
        personalityTraits: computeFieldDriftScore([0.7], null),
        speechPatterns: computeFieldDriftScore([null], null),
        values: computeFieldDriftScore([null], null),
        fears: computeFieldDriftScore([null], null),
        goals: computeFieldDriftScore([null], null),
        copingStyle: computeFieldDriftScore([null], null),
      },
      mean_gt_divergence_slope: null,
      mean_internal_consistency_f1: null,
    };
    const result: ConversationReconstructionResult = {
      conversation_file: "conv_001.yaml",
      scenario_id: "scen_001",
      scenario_title: "Test",
      scenario_difficulty: "medium",
      scenario_stress_axes: [],
      segment_count: 1,
      characters: [char],
    };
    const summary = computeSummary([result], ["model-a"], 1);
    expect(summary.segment_count).toBe(1);
    expect(summary.most_drifting).toHaveLength(0);
    expect(summary.field_aggregates.personalityTraits!.mean_gt_divergence_slope).toBeNull();
    expect(summary.field_aggregates.personalityTraits!.drifting_fraction).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
bun test evaluation/reconstruct/__tests__/scoring.test.ts
```

Expected: all tests pass (the old tests plus the new ones).

- [ ] **Step 3: Commit**

```bash
git add evaluation/reconstruct/__tests__/scoring.test.ts
git commit -m "test(eval): update scoring tests — remove computeCharacterScore, add slope/IC/unified summary tests"
```

---

### Task 9: Add thin-conversation test

**Files:**
- Create: `evaluation/reconstruct/__tests__/index.test.ts`

The thin-conversation error is thrown before any LLM calls (before the OpenAI client is constructed), so the test does not require mocking.

- [ ] **Step 1: Write the failing test**

Create `evaluation/reconstruct/__tests__/index.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { runReconstructionForConversation } from "../index";
import type { ValidatedReconstructConfig } from "../types";

function makeMinimalConfig(segments: number): ValidatedReconstructConfig {
  return {
    baseUrl: "http://localhost",
    segments,
    reconstructorModel: "test-model",
    comparators: [{ label: "comparator_1", model: "test-model" }],
    fields: ["personalityTraits"],
    datasetDir: "/tmp",
    outputName: "test",
    rawConfigText: "",
  };
}

describe("runReconstructionForConversation", () => {
  test("throws when messages < segments * 2", async () => {
    const result = {
      scenario_id: "scen_001",
      scenario_title: "Test",
      messages: [
        { turn: 1, character_id: "c1", character_name: "Alice", emotion: "neutral", intensity: "low", subtext: "", reasoning: null, content: "hi" },
        { turn: 2, character_id: "c1", character_name: "Alice", emotion: "neutral", intensity: "low", subtext: "", reasoning: null, content: "bye" },
        { turn: 3, character_id: "c1", character_name: "Alice", emotion: "neutral", intensity: "low", subtext: "", reasoning: null, content: "ok" },
      ],
      characters: [{ id: "c1", name: "Alice" }],
    } as any;

    await expect(
      runReconstructionForConversation(
        result,
        "001.yaml",
        { id: "scen_001", title: "Test", context: "", difficulty_level: "medium", stress_axes: [] } as any,
        [] as any,
        makeMinimalConfig(3),
        "fake-api-key",
      ),
    ).rejects.toThrow("not enough messages for 3 segments");
  });

  test("does not throw when messages >= segments * 2 (proceeds to LLM call, which may fail for other reasons)", async () => {
    // 6 messages, 3 segments = 2 per segment — just over the threshold
    // This will throw eventually (no real LLM), but NOT on the thin check
    const messages = Array.from({ length: 6 }, (_, i) => ({
      turn: i + 1,
      character_id: "c1",
      character_name: "Alice",
      emotion: "neutral",
      intensity: "low",
      subtext: "",
      reasoning: null,
      content: `msg ${i + 1}`,
    }));
    const result = {
      scenario_id: "scen_001",
      scenario_title: "Test",
      messages,
      characters: [{ id: "c1", name: "Alice" }],
    } as any;

    const promise = runReconstructionForConversation(
      result,
      "001.yaml",
      { id: "scen_001", title: "Test", context: "", difficulty_level: "medium", stress_axes: [] } as any,
      [] as any,
      makeMinimalConfig(3),
      "fake-api-key",
    );

    // Should NOT throw the thin-conversation error — will throw a different error (LLM/network)
    await expect(promise).rejects.not.toThrow("not enough messages");
  });
});
```

- [ ] **Step 2: Run test to verify first case passes, second case passes**

```bash
bun test evaluation/reconstruct/__tests__/index.test.ts
```

Expected: both tests pass (the first confirms the thin check fires; the second confirms it doesn't fire when messages are sufficient — the function throws a different error from the LLM call).

- [ ] **Step 3: Commit**

```bash
git add evaluation/reconstruct/__tests__/index.test.ts
git commit -m "test(eval): add thin-conversation hard error test"
```

---

### Task 10: Delete `evaluation/drift/` and `evaluation/drift_persona.ts`

**Files:**
- Delete: `evaluation/drift/` (entire directory)
- Delete: `evaluation/drift_persona.ts`

- [ ] **Step 1: Delete**

```bash
git rm -r evaluation/drift/
git rm evaluation/drift_persona.ts
```

- [ ] **Step 2: Run all reconstruct tests to confirm nothing broke**

```bash
bun test evaluation/reconstruct/__tests__/
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(eval): delete drift module — absorbed into reconstruct"
```

---

### Task 11: Final verification

- [ ] **Step 1: Run all reconstruct tests**

```bash
bun test evaluation/reconstruct/__tests__/
```

Expected output (exact counts may vary):
```
X pass
0 fail
```

- [ ] **Step 2: Run mcp_server tests (pre-existing failures are acceptable)**

```bash
bun test mcp_server 2>&1 | tail -5
```

The 6 pre-existing failures are due to missing Prisma client generation (not related to this change). Confirm the pass/fail counts have not changed.

- [ ] **Step 3: Smoke-test the CLI**

Run a dry-check — this will fail on the LLM call (no real model reachable), but should fail AFTER config loading, not before:

```bash
bun evaluation/reconstruct_persona.ts evaluation/configs/drift-check.yaml 2>&1 | head -5
```

Expected: config loads (no "segments" error, no "output already exists" error), then attempts LLM calls.

Note: if `evaluation/results/test-run-001/reconstruct_persona/drift-check-001/` does not exist yet, the config check passes. If it does exist from a previous run, rename `output_name` in the config or delete the directory first.

- [ ] **Step 4: Confirm `drift_persona.ts` is gone**

```bash
ls evaluation/*.ts
```

Expected: only `generate_dataset.ts`, `judge_guessing.ts`, `reconstruct_persona.ts` — no `drift_persona.ts`.
