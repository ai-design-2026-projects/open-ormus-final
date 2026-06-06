# Persona Drift Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a drift evaluation pass that detects how a character's fidelity to their ground-truth profile changes across isolated conversation segments (GT-divergence trend) and how consistently they behave from start to end (internal consistency).

**Architecture:** A new `evaluation/drift/` module parallel to `evaluation/reconstruct/`. It reuses the existing reconstructor and comparator calls/prompts without modification. The conversation is split into N equal non-overlapping segments; each segment is reconstructed in isolation and scored against GT. Two derived metrics — GT-divergence slope (linear regression over per-segment F1s) and internal consistency (seg[0] items vs seg[N-1] items) — are computed per field and aggregated per character.

**Tech Stack:** Bun, TypeScript (strict), OpenAI SDK, yaml, zod — all already present in the repo. No new dependencies.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `evaluation/drift/types.ts` | All drift-specific output and config types |
| Create | `evaluation/drift/segmenter.ts` | Split `ConversationMessage[]` into N equal isolated windows |
| Create | `evaluation/drift/__tests__/segmenter.test.ts` | Unit tests for segmenter |
| Create | `evaluation/drift/scoring.ts` | OLS slope, `computeFieldDriftScore`, `computeDriftSummary` |
| Create | `evaluation/drift/__tests__/scoring.test.ts` | Unit tests for scoring |
| Create | `evaluation/drift/config.ts` | Config YAML loading + validation (adds `segments` field) |
| Create | `evaluation/drift/writer.ts` | Write per-conversation YAMLs + summary |
| Create | `evaluation/drift/index.ts` | Per-conversation orchestration (LLM calls) |
| Create | `evaluation/drift/pass.ts` | Top-level pass runner |
| Create | `evaluation/drift_persona.ts` | CLI entry point |

---

## Task 1: Define types

**Files:**
- Create: `evaluation/drift/types.ts`

- [ ] **Step 1: Write the types file**

```typescript
import type { FieldScore, ProfileField } from "../reconstruct/types";

// Atomic unit — one segment × one character reconstruction scored vs GT
export type SegmentResult = {
  segment_index: number;           // 0-based; 0 is earliest
  turn_range: [number, number];    // [first_turn, last_turn], 1-based inclusive
  message_count: number;           // total messages in this window (all characters)
  field_scores: Record<ProfileField, FieldScore>; // same shape as existing reconstruction pass
};

// Drift metrics for a single field across the segment time series
export type FieldDriftScore = {
  // F1 vs GT per segment — null means field was not_observed in that segment
  segment_f1s: Array<number | null>;
  // Indices of segments where the field was observed (not_observed = false)
  observed_segments: number[];
  // OLS slope over observed-segment F1s; null when fewer than 2 segments observed
  gt_divergence_slope: number | null;
  // Comparator score of seg[N-1] items vs seg[0] items (seg[0] treated as GT)
  // null when either endpoint was not_observed for this field
  internal_consistency: FieldScore | null;
};

// One result per character in the conversation
export type CharacterDriftResult = {
  alias: string;
  real_name: string;
  difficulty_tier: string;
  // Primary evidence — all derived metrics below come from this
  segments: SegmentResult[];
  field_drift: Record<ProfileField, FieldDriftScore>;
  // Average slope across fields with non-null slopes; null if no field had enough signal
  mean_gt_divergence_slope: number | null;
  // Average internal_consistency F1 across fields with both endpoints observed; null if none
  mean_internal_consistency_f1: number | null;
};

// One result per conversation file
export type ConversationDriftResult = {
  conversation_file: string;
  scenario_id: string;
  scenario_difficulty: string;
  segment_count: number;
  characters: CharacterDriftResult[];
};

// Summary aggregates for the full run
export type FieldDriftAggregate = {
  mean_gt_divergence_slope: number | null;
  mean_internal_consistency_f1: number | null;
  // Fraction of characters with non-null slope where slope < 0 (actively drifting)
  // Denominator = characters with non-null slope for this field
  drifting_fraction: number;
};

export type TierDriftAggregate = {
  count: number;
  mean_gt_divergence_slope: number | null;
  mean_internal_consistency_f1: number | null;
};

export type DriftSummary = {
  total_conversations: number;
  total_characters_evaluated: number;
  segment_count: number;
  comparator_models: string[];
  field_aggregates: Record<ProfileField, FieldDriftAggregate>;
  by_difficulty: Record<string, TierDriftAggregate>;
  by_tier: Record<string, TierDriftAggregate>;
  // Only characters with non-null mean_gt_divergence_slope, sorted most negative first
  most_drifting: Array<{
    conversation_file: string;
    alias: string;
    real_name: string;
    mean_gt_divergence_slope: number;
    mean_internal_consistency_f1: number | null;
  }>;
};

// Config after validation
export type ValidatedDriftConfig = {
  datasetDir: string;
  outputName: string;
  baseUrl: string;
  reconstructorModel: string;
  comparators: Array<{ label: string; model: string }>;
  fields: ProfileField[];
  segments: number;
  rawConfigText: string;
};
```

- [ ] **Step 2: Commit**

```bash
git add evaluation/drift/types.ts
git commit -m "feat(eval): add drift evaluation types"
```

---

## Task 2: Segmenter (TDD)

**Files:**
- Create: `evaluation/drift/segmenter.ts`
- Create: `evaluation/drift/__tests__/segmenter.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// evaluation/drift/__tests__/segmenter.test.ts
import { describe, test, expect } from "bun:test";
import { segmentConversation, warnIfThin } from "../segmenter";
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
});

describe("warnIfThin", () => {
  test("does not throw for adequate message count", () => {
    expect(() => warnIfThin(makeMessages(6), 3, "conv_001.yaml")).not.toThrow();
  });

  test("does not throw for thin conversations (only warns to stderr)", () => {
    expect(() => warnIfThin(makeMessages(3), 3, "conv_001.yaml")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
bun test evaluation/drift/__tests__/segmenter.test.ts
```

Expected: `Cannot find module '../segmenter'`

- [ ] **Step 3: Implement segmenter**

```typescript
// evaluation/drift/segmenter.ts
import type { ConversationMessage } from "../runner/conversation";

export type Segment = {
  segment_index: number;
  turn_range: [number, number];
  messages: ConversationMessage[];
};

export function segmentConversation(messages: ConversationMessage[], n: number): Segment[] {
  if (messages.length === 0) return [];

  const sliceSize = Math.floor(messages.length / n);
  const segments: Segment[] = [];

  for (let i = 0; i < n; i++) {
    const start = i * sliceSize;
    const end = i === n - 1 ? messages.length : start + sliceSize;
    const slice = messages.slice(start, end);

    if (slice.length === 0) continue;

    segments.push({
      segment_index: i,
      turn_range: [slice[0]!.turn, slice[slice.length - 1]!.turn],
      messages: slice,
    });
  }

  return segments;
}

export function warnIfThin(messages: ConversationMessage[], n: number, conversationFile: string): void {
  if (messages.length < n * 2) {
    process.stderr.write(
      `[WARN] ${conversationFile}: ${messages.length} messages for ${n} segments — segments may be too thin for reliable reconstruction\n`,
    );
  }
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
bun test evaluation/drift/__tests__/segmenter.test.ts
```

Expected: all tests pass, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add evaluation/drift/segmenter.ts evaluation/drift/__tests__/segmenter.test.ts
git commit -m "feat(eval): add conversation segmenter for drift evaluation"
```

---

## Task 3: Scoring functions (TDD)

**Files:**
- Create: `evaluation/drift/scoring.ts`
- Create: `evaluation/drift/__tests__/scoring.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// evaluation/drift/__tests__/scoring.test.ts
import { describe, test, expect } from "bun:test";
import { computeSlope, computeFieldDriftScore, computeDriftSummary } from "../scoring";
import type { FieldScore } from "../../reconstruct/types";
import type { ConversationDriftResult } from "../types";

// Minimal FieldScore factory for tests
function makeFieldScore(f1: number, contradicted = 0): FieldScore {
  return {
    not_observed: false,
    observed_count: 1,
    gt_count: 1,
    matched: 1,
    contradicted,
    precision: f1,
    recall: f1,
    f1,
    comparator_agreement: 1,
    item_scores: [],
  };
}

const NOT_OBSERVED: FieldScore = {
  not_observed: true,
  observed_count: 0,
  gt_count: 0,
  matched: 0,
  contradicted: 0,
  precision: 0,
  recall: 0,
  f1: 0,
  comparator_agreement: 1,
  item_scores: [],
};

describe("computeSlope", () => {
  test("returns null for empty input", () => {
    expect(computeSlope([], [])).toBeNull();
  });

  test("returns null for single point", () => {
    expect(computeSlope([0], [0.8])).toBeNull();
  });

  test("positive slope from two points", () => {
    // x=[0,1], y=[0.5,0.8] → slope = 0.3
    expect(computeSlope([0, 1], [0.5, 0.8])).toBeCloseTo(0.3, 5);
  });

  test("negative slope from three points", () => {
    // x=[0,1,2], y=[0.9,0.6,0.3] → slope = -0.3
    expect(computeSlope([0, 1, 2], [0.9, 0.6, 0.3])).toBeCloseTo(-0.3, 5);
  });

  test("flat line returns slope ~0", () => {
    expect(computeSlope([0, 1, 2], [0.5, 0.5, 0.5])).toBeCloseTo(0, 5);
  });

  test("non-consecutive x indices (skipped segment)", () => {
    // x=[0,2], y=[0.8,0.4] → slope = (0.4-0.8)/(2-0) = -0.2
    expect(computeSlope([0, 2], [0.8, 0.4])).toBeCloseTo(-0.2, 5);
  });
});

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
    // observed at indices 0 and 2 only; x=[0,2], y=[0.9,0.3] → slope=-0.3
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

describe("computeDriftSummary", () => {
  // Build a minimal CharacterDriftResult with explicit personalityTraits segment F1s.
  // All other fields are not_observed (null segment_f1s).
  function makeChar(
    alias: string,
    personalityF1s: Array<number | null>,
    meanSlope: number | null,
    meanIC: number | null,
    tier = "tier-1",
  ): CharacterDriftResult {
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
    char: CharacterDriftResult,
    difficulty = "medium",
  ): ConversationDriftResult {
    return {
      conversation_file: file,
      scenario_id: "scen_001",
      scenario_difficulty: difficulty,
      segment_count: 2,
      characters: [char],
    };
  }

  test("total counts are correct", () => {
    const results = [
      makeResult("conv_001.yaml", makeChar("Alice", [0.8, 0.5], -0.3, 0.7)),
      makeResult("conv_002.yaml", makeChar("Bob", [0.4, 0.6], 0.2, null)),
    ];
    const summary = computeDriftSummary(results, ["model-a"], 2);
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
    const summary = computeDriftSummary(results, ["m"], 2);
    expect(summary.most_drifting).toHaveLength(2);
    expect(summary.most_drifting[0]!.mean_gt_divergence_slope).toBeCloseTo(-0.5);
    expect(summary.most_drifting[1]!.mean_gt_divergence_slope).toBeCloseTo(-0.1);
  });

  test("drifting_fraction denominator excludes characters with null slope", () => {
    // Alice: personalityTraits slope = (0.4-0.8)/(1-0) = -0.4 → drifting
    // Bob:   personalityTraits slope = (0.8-0.4)/(1-0) = +0.4 → not drifting
    // Carol: personalityTraits not observed → excluded from denominator
    const results = [
      makeResult("conv_001.yaml", makeChar("Alice", [0.8, 0.4], -0.4, null)),
      makeResult("conv_002.yaml", makeChar("Bob",   [0.4, 0.8],  0.4, null)),
      makeResult("conv_003.yaml", makeChar("Carol", [null, null], null, null)),
    ];
    const summary = computeDriftSummary(results, ["m"], 2);
    // 2 chars have non-null slope for personalityTraits; 1 is negative → 1/2 = 0.5
    expect(summary.field_aggregates.personalityTraits!.drifting_fraction).toBeCloseTo(0.5);
  });

  test("null vs 0 preserved — field with no observed segments stays null in aggregates", () => {
    const results = [
      makeResult("conv_001.yaml", makeChar("Alice", [null, null], null, null)),
    ];
    const summary = computeDriftSummary(results, ["m"], 2);
    // speechPatterns is all-null → no slope → mean_gt_divergence_slope is null, not 0
    expect(summary.field_aggregates.speechPatterns!.mean_gt_divergence_slope).toBeNull();
    // personalityTraits is also all-null
    expect(summary.field_aggregates.personalityTraits!.mean_gt_divergence_slope).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
bun test evaluation/drift/__tests__/scoring.test.ts
```

Expected: `Cannot find module '../scoring'`

- [ ] **Step 3: Implement scoring**

```typescript
// evaluation/drift/scoring.ts
import { PROFILE_FIELDS } from "../reconstruct/types";
import type { ProfileField, FieldScore } from "../reconstruct/types";
import type {
  FieldDriftScore,
  FieldDriftAggregate,
  TierDriftAggregate,
  DriftSummary,
  CharacterDriftResult,
  ConversationDriftResult,
} from "./types";

// Ordinary least squares slope for y = a + b*x.
// Returns null when fewer than 2 points — a line cannot be fit.
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
  if (denom === 0) return 0;
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

export function computeDriftSummary(
  results: ConversationDriftResult[],
  comparatorModels: string[],
  segmentCount: number,
): DriftSummary {
  const allChars = results.flatMap((r) => r.characters);

  const fieldAgg = (field: ProfileField): FieldDriftAggregate => {
    const slopes = allChars
      .map((c) => c.field_drift[field]?.gt_divergence_slope ?? null)
      .filter((s): s is number => s !== null);

    const icF1s = allChars
      .map((c) => c.field_drift[field]?.internal_consistency?.f1 ?? null)
      .filter((f): f is number => f !== null);

    return {
      mean_gt_divergence_slope: slopes.length > 0
        ? slopes.reduce((s, v) => s + v, 0) / slopes.length
        : null,
      mean_internal_consistency_f1: icF1s.length > 0
        ? icF1s.reduce((s, v) => s + v, 0) / icF1s.length
        : null,
      drifting_fraction: slopes.length > 0
        ? slopes.filter((s) => s < 0).length / slopes.length
        : 0,
    };
  };

  const tierAgg = (chars: CharacterDriftResult[]): TierDriftAggregate => {
    const slopes = chars.map((c) => c.mean_gt_divergence_slope).filter((s): s is number => s !== null);
    const icF1s = chars.map((c) => c.mean_internal_consistency_f1).filter((f): f is number => f !== null);
    return {
      count: chars.length,
      mean_gt_divergence_slope: slopes.length > 0
        ? slopes.reduce((s, v) => s + v, 0) / slopes.length
        : null,
      mean_internal_consistency_f1: icF1s.length > 0
        ? icF1s.reduce((s, v) => s + v, 0) / icF1s.length
        : null,
    };
  };

  const difficultyGroups: Record<string, CharacterDriftResult[]> = {};
  const tierGroups: Record<string, CharacterDriftResult[]> = {};

  for (const conv of results) {
    difficultyGroups[conv.scenario_difficulty] ??= [];
    for (const char of conv.characters) {
      difficultyGroups[conv.scenario_difficulty]!.push(char);
      tierGroups[char.difficulty_tier] ??= [];
      tierGroups[char.difficulty_tier]!.push(char);
    }
  }

  const mostDrifting = allChars
    .filter((c): c is CharacterDriftResult & { mean_gt_divergence_slope: number } =>
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
    field_aggregates: Object.fromEntries(
      PROFILE_FIELDS.map((f) => [f, fieldAgg(f)]),
    ) as Record<ProfileField, FieldDriftAggregate>,
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

- [ ] **Step 4: Run tests — expect all pass**

```bash
bun test evaluation/drift/__tests__/scoring.test.ts
```

Expected: all tests pass, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add evaluation/drift/scoring.ts evaluation/drift/__tests__/scoring.test.ts
git commit -m "feat(eval): add drift scoring — OLS slope and field drift aggregation"
```

---

## Task 4: Config loader

**Files:**
- Create: `evaluation/drift/config.ts`

- [ ] **Step 1: Write the config loader**

```typescript
// evaluation/drift/config.ts
import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PROFILE_FIELDS } from "../reconstruct/types";
import type { ProfileField } from "../reconstruct/types";
import type { ValidatedDriftConfig } from "./types";

const DriftConfigSchema = z.object({
  dataset_dir: z
    .string()
    .min(1)
    .refine(
      (v) => !v.includes("/") && !v.includes("\\") && !v.includes(".."),
      "dataset_dir must be a simple directory name",
    ),
  output_name: z
    .string()
    .min(1)
    .refine(
      (v) => !v.includes("/") && !v.includes("\\") && !v.includes(".."),
      "output_name must be a simple directory name",
    ),
  base_url: z.string().min(1),
  reconstructor: z.object({ model: z.string().min(1) }),
  comparators: z
    .array(z.object({ model: z.string().min(1) }))
    .min(1, "At least 1 comparator required")
    .max(3, "At most 3 comparators allowed"),
  fields: z.array(z.enum(PROFILE_FIELDS)).optional(),
  segments: z.number().int().min(2).max(6).default(3),
});

export function loadDriftConfig(
  rawConfigText: string,
  resultsBasePath: string = join(process.cwd(), "evaluation", "results"),
): ValidatedDriftConfig {
  const parsed: unknown = parseYaml(rawConfigText);
  const input = DriftConfigSchema.parse(parsed);

  if (!process.env["LLM_API_KEY"]) {
    throw new Error("LLM_API_KEY env var is not set");
  }

  const datasetDir = join(resultsBasePath, input.dataset_dir);
  const conversationsDir = join(datasetDir, "conversations");

  if (!existsSync(conversationsDir)) {
    throw new Error(
      `Dataset conversations directory not found: ${conversationsDir}\nRun the generate step first.`,
    );
  }

  const outputDir = join(datasetDir, "drift_persona", input.output_name);
  if (existsSync(outputDir)) {
    throw new Error(
      `Drift output directory already exists: ${outputDir}\nDelete it or choose a different output_name.`,
    );
  }

  const comparators = input.comparators.map((c, i) => ({
    label: `comparator_${i + 1}`,
    model: c.model,
  }));

  const fields: ProfileField[] = input.fields ?? [...PROFILE_FIELDS];

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
}
```

- [ ] **Step 2: Commit**

```bash
git add evaluation/drift/config.ts
git commit -m "feat(eval): add drift config loader"
```

---

## Task 5: Writer

**Files:**
- Create: `evaluation/drift/writer.ts`

- [ ] **Step 1: Write the writer**

```typescript
// evaluation/drift/writer.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import type { ConversationDriftResult, DriftSummary } from "./types";

export function initDriftOutputDir(
  datasetDir: string,
  outputName: string,
  rawConfigText: string,
): string {
  const outputDir = join(datasetDir, "drift_persona", outputName);
  mkdirSync(join(outputDir, "conversations"), { recursive: true });
  writeFileSync(join(outputDir, "config.yaml"), rawConfigText, "utf-8");
  return outputDir;
}

export function writeDriftResults(
  outputDir: string,
  results: ConversationDriftResult[],
): void {
  for (const result of results) {
    writeFileSync(
      join(outputDir, "conversations", result.conversation_file),
      stringify(result),
      "utf-8",
    );
  }
}

export function writeDriftSummary(outputDir: string, summary: DriftSummary): void {
  writeFileSync(join(outputDir, "summary.yaml"), stringify(summary), "utf-8");
}
```

- [ ] **Step 2: Commit**

```bash
git add evaluation/drift/writer.ts
git commit -m "feat(eval): add drift output writer"
```

---

## Task 6: Per-conversation orchestration

**Files:**
- Create: `evaluation/drift/index.ts`

This is the LLM-calling layer. It calls the reconstructor for each segment, scores each segment against GT, and then runs the internal consistency comparator between seg[0] and seg[N-1].

- [ ] **Step 1: Write the orchestration**

```typescript
// evaluation/drift/index.ts
import OpenAI from "openai";
import { callReconstructor, callComparator } from "../reconstruct/call";
import {
  buildReconstructorSystemPrompt,
  buildReconstructorUserMessage,
  buildComparatorSystemPrompt,
  buildComparatorUserMessage,
} from "../reconstruct/prompt";
import { buildItemScores, computeFieldScore } from "../reconstruct/scoring";
import { reconstructAliasMap } from "../judge/alias";
import { segmentConversation, warnIfThin } from "./segmenter";
import { computeFieldDriftScore } from "./scoring";
import { PROFILE_FIELDS } from "../reconstruct/types";
import type { ProfileField, FieldScore, ReconstructedField } from "../reconstruct/types";
import type {
  CharacterDriftResult,
  ConversationDriftResult,
  SegmentResult,
  FieldDriftScore,
  ValidatedDriftConfig,
} from "./types";
import type { CharacterRecord, ScenarioRecord } from "../runner/config";
import type { ConversationResult } from "../runner/conversation";

function getGtItems(char: CharacterRecord, field: ProfileField): string[] {
  return (char[field as keyof CharacterRecord] as string[] | undefined) ?? [];
}

export async function runDriftForConversation(
  result: ConversationResult,
  fileName: string,
  scenario: ScenarioRecord,
  characters: CharacterRecord[],
  config: ValidatedDriftConfig,
  apiKey: string,
): Promise<ConversationDriftResult> {
  const client = new OpenAI({ baseURL: `${config.baseUrl}/v1`, apiKey });
  const aliasMap = reconstructAliasMap(result.characters, characters);

  // Strip reasoning/subtext upfront — same as the existing reconstruction pass
  const strippedMessages = result.messages.map((m) => ({
    ...m,
    reasoning: "",
    subtext: "",
  }));

  warnIfThin(strippedMessages, config.segments, fileName);

  const segments = segmentConversation(strippedMessages, config.segments);

  const reconstructorSysPrompt = buildReconstructorSystemPrompt();
  const comparatorSysPrompt = buildComparatorSystemPrompt();

  const charResults: CharacterDriftResult[] = [];

  for (const convChar of result.characters) {
    const alias = convChar.name;
    const realName = aliasMap[alias] ?? alias;
    const charRecord = characters.find((c) => c.id === convChar.id);
    if (!charRecord) throw new Error(`Character ${convChar.id} not found in dataset`);

    console.log(
      `  [${alias} → ${realName}] reconstructing ${config.segments} segments…`,
    );

    // ── Step 1: Reconstruct + score vs GT for each segment ───────────────────
    const segmentResults: SegmentResult[] = [];
    // Store raw ReconstructedField per segment for internal consistency later
    const segmentFields: Array<Partial<Record<ProfileField, ReconstructedField>>> = [];

    for (const seg of segments) {
      const userMsg = buildReconstructorUserMessage(
        alias,
        scenario,
        seg.messages,
        config.fields,
      );

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
            const compUserMsg = buildComparatorUserMessage(
              field,
              gtItems,
              reconField.items,
            );
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

      // Fill non-configured fields as not_observed for type completeness
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
    const seg0Fields = segmentFields[0] ?? {};
    const segNFields = segmentFields[segmentFields.length - 1] ?? {};

    const fieldDrift: Partial<Record<ProfileField, FieldDriftScore>> = {};

    for (const field of PROFILE_FIELDS) {
      const segmentF1s: Array<number | null> = segmentResults.map((sr) => {
        const fs = sr.field_scores[field];
        return fs && !fs.not_observed ? fs.f1 : null;
      });

      // Internal consistency: seg[0] items as GT, seg[N-1] items as reconstructed
      let internalConsistency: FieldScore | null = null;
      const seg0Field = seg0Fields[field];
      const segNField = segNFields[field];

      if (
        seg0Field && !seg0Field.not_observed && seg0Field.items.length > 0 &&
        segNField && !segNField.not_observed && segNField.items.length > 0
      ) {
        // TypeScript narrows seg0Field/segNField to non-undefined non-not_observed here
        process.stdout.write(
          `    [${field}] internal consistency seg0 vs segN…`,
        );

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
    const slopes = PROFILE_FIELDS
      .map((f) => fieldDrift[f]?.gt_divergence_slope ?? null)
      .filter((s): s is number => s !== null);

    const icF1s = PROFILE_FIELDS
      .map((f) => fieldDrift[f]?.internal_consistency?.f1 ?? null)
      .filter((f): f is number => f !== null);

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
    scenario_difficulty: scenario.difficulty_level,
    segment_count: config.segments,
    characters: charResults,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add evaluation/drift/index.ts
git commit -m "feat(eval): add per-conversation drift orchestration"
```

---

## Task 7: Pass runner + CLI entry point

**Files:**
- Create: `evaluation/drift/pass.ts`
- Create: `evaluation/drift_persona.ts`

- [ ] **Step 1: Write the pass runner**

```typescript
// evaluation/drift/pass.ts
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadDriftConfig } from "./config";
import { runDriftForConversation } from "./index";
import { initDriftOutputDir, writeDriftResults, writeDriftSummary } from "./writer";
import { computeDriftSummary } from "./scoring";
import type { CharacterRecord, ScenarioRecord } from "../runner/config";
import type { ConversationResult } from "../runner/conversation";
import type { ConversationDriftResult } from "./types";

import rawCharacters from "../dataset/characters.yaml";
import rawScenarios from "../dataset/scenarios.yaml";

const ALL_CHARACTERS = rawCharacters as CharacterRecord[];
const ALL_SCENARIOS = rawScenarios as ScenarioRecord[];

export async function runDriftPass(configPath: string): Promise<void> {
  const rawConfigText = readFileSync(configPath, "utf-8");
  const config = loadDriftConfig(rawConfigText);
  const apiKey = process.env["LLM_API_KEY"]!;

  const outputDir = initDriftOutputDir(config.datasetDir, config.outputName, rawConfigText);

  try {
    const conversationsDir = join(config.datasetDir, "conversations");
    const files = readdirSync(conversationsDir)
      .filter((f) => f.endsWith(".yaml"))
      .sort();

    if (files.length === 0) {
      throw new Error(`No conversation YAML files found in ${conversationsDir}`);
    }

    const allResults: ConversationDriftResult[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const raw = readFileSync(join(conversationsDir, file), "utf-8");
      const result = parseYaml(raw) as ConversationResult;

      if (!result.messages || result.messages.length === 0) {
        console.log(`[${i + 1}/${files.length}] ${file} — skipped (failed conversation)`);
        continue;
      }

      const scenario = ALL_SCENARIOS.find((s) => s.id === result.scenario_id);
      if (!scenario) {
        throw new Error(`Scenario "${result.scenario_id}" not found (from ${file})`);
      }

      const characters = result.characters.map((c) => {
        const found = ALL_CHARACTERS.find((r) => r.id === c.id);
        if (!found) throw new Error(`Character "${c.id}" not found (from ${file})`);
        return found;
      });

      console.log(
        `[${i + 1}/${files.length}] ${result.scenario_id} · ${result.characters.map((c) => c.name).join(" + ")}`,
      );

      const convResult = await runDriftForConversation(
        result,
        file,
        scenario,
        characters,
        config,
        apiKey,
      );
      allResults.push(convResult);
    }

    writeDriftResults(outputDir, allResults);
    writeDriftSummary(
      outputDir,
      computeDriftSummary(
        allResults,
        config.comparators.map((c) => c.model),
        config.segments,
      ),
    );

    console.log(`\nDone. Results written to ${outputDir}/`);
  } catch (err) {
    rmSync(outputDir, { recursive: true, force: true });
    console.error(`\nDrift pass failed — removed incomplete output: ${outputDir}`);
    throw err;
  }
}
```

- [ ] **Step 2: Write the CLI entry point**

```typescript
// evaluation/drift_persona.ts
import { runDriftPass } from "./drift/pass";

const configPath = process.argv[2];
if (!configPath) {
  console.error("Usage: bun evaluation/drift_persona.ts <config.yaml>");
  process.exit(1);
}

await runDriftPass(configPath);
```

- [ ] **Step 3: Commit**

```bash
git add evaluation/drift/pass.ts evaluation/drift_persona.ts
git commit -m "feat(eval): add drift pass runner and CLI entry point"
```

---

## Task 8: Verify everything compiles and tests pass

- [ ] **Step 1: Run typecheck**

```bash
bun run typecheck
```

Expected: 0 errors. If errors appear, fix them before proceeding.

- [ ] **Step 2: Run all drift tests**

```bash
bun test evaluation/drift
```

Expected: all tests pass, 0 failures.

- [ ] **Step 3: Run full test suite to check for regressions**

```bash
bun test --cwd mcp_server
```

Expected: same pass/fail counts as before this feature branch (13 pass / 6 fail — pre-existing failures unrelated to this work).

- [ ] **Step 4: Commit if any fixes were needed from typecheck**

If typecheck or tests required fixes:
```bash
git add -p
git commit -m "fix(eval): resolve typecheck errors in drift module"
```

---

## Example config file

For reference — a minimal config to run the drift pass against an existing dataset:

```yaml
# evaluation/configs/drift_v1.yaml
dataset_dir: run_001          # must contain a conversations/ subdirectory
output_name: drift_v1
base_url: http://localhost:11434
reconstructor:
  model: llama3.1:70b
comparators:
  - model: llama3.1:70b
segments: 3
```

Run with:
```bash
bun evaluation/drift_persona.ts evaluation/configs/drift_v1.yaml
```
