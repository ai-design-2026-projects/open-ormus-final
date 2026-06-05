# Persona Reconstruction Evaluation Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `evaluation/reconstruct/` — a third evaluation pass that reconstructs character personality profiles from conversation transcripts and scores them against ground truth using a multi-model comparator panel.

**Architecture:** Mirrors `evaluation/judge/` exactly (config → prompt → schema → types → call → index → pass → writer). A reconstructor LLM reads each conversation blind (no GT) and outputs a structured profile. A multi-model comparator panel scores each reconstructed item against GT with majority vote. Pair differentiation is computed in post-processing from cross-comparator calls with no extra LLM role.

**Tech Stack:** TypeScript, Bun, OpenAI SDK (existing), Zod v4 (existing), yaml (existing).

---

## File Map

| File | Responsibility |
|---|---|
| `evaluation/reconstruct/types.ts` | All Zod schemas + TypeScript types |
| `evaluation/reconstruct/schema.ts` | JSON schema builders for OpenAI structured output |
| `evaluation/reconstruct/config.ts` | Config loading + validation |
| `evaluation/reconstruct/prompt.ts` | Prompt builders for reconstructor + comparator |
| `evaluation/reconstruct/call.ts` | `callReconstructor()`, `callComparator()` with MAX_RETRIES=3 |
| `evaluation/reconstruct/scoring.ts` | Pure scoring functions (majority vote, field score, summary) |
| `evaluation/reconstruct/writer.ts` | `initOutputDir()`, `writeResults()`, `writeSummary()` |
| `evaluation/reconstruct/index.ts` | Per-conversation orchestration + pair cross-comparison |
| `evaluation/reconstruct/pass.ts` | `runReconstructionPass()` — reads YAMLs, loops, cleans up on failure |
| `evaluation/reconstruct/__tests__/config.test.ts` | Config validation unit tests |
| `evaluation/reconstruct/__tests__/scoring.test.ts` | Scoring unit tests |
| `evaluation/reconstruct_persona.ts` | CLI entry point |
| `evaluation/configs/reconstruct-persona.yaml` | Example config |

---

## Task 1: Types and JSON Schemas

**Files:**
- Create: `evaluation/reconstruct/types.ts`
- Create: `evaluation/reconstruct/schema.ts`

- [ ] **Step 1: Create `evaluation/reconstruct/types.ts`**

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

export type CharacterScore = {
  mean_f1: number;
  mean_precision: number;
  mean_recall: number;
  contradiction_count: number;
  fields_not_observed: ProfileField[];
};

export type CharacterResult = {
  alias: string;
  real_name: string;
  difficulty_tier: string;
  varying_axis: string | null;
  field_scores: Record<ProfileField, FieldScore>;
  character_score: CharacterScore;
};

export type PairDifferentiationResult = {
  pair_ids: [string, string];
  varying_axis: string;
  scenario_activates_axis: boolean;
  A_on_A: number;
  B_on_B: number;
  A_on_B: number;
  B_on_A: number;
  differentiated: boolean;
};

export type ConversationReconstructionResult = {
  conversation_file: string;
  scenario_id: string;
  scenario_title: string;
  scenario_difficulty: string;
  scenario_stress_axes: string[];
  characters: CharacterResult[];
  pair_differentiation: PairDifferentiationResult | null;
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
  rawConfigText: string;
};
```

- [ ] **Step 2: Create `evaluation/reconstruct/schema.ts`**

```typescript
import type { ProfileField } from "./types";

const fieldJsonSchema = {
  type: "object",
  properties: {
    not_observed: { type: "boolean" },
    items: { type: "array", items: { type: "string" } },
  },
  required: ["not_observed", "items"],
  additionalProperties: false,
} as const;

export function buildReconstructorResponseFormat(fields: ProfileField[]) {
  const properties: Record<string, unknown> = {};
  for (const f of fields) properties[f] = fieldJsonSchema;

  return {
    type: "json_schema" as const,
    json_schema: {
      name: "persona_reconstruction",
      strict: true,
      schema: {
        type: "object",
        properties: {
          fields: {
            type: "object",
            properties,
            required: fields as string[],
            additionalProperties: false,
          },
        },
        required: ["fields"],
        additionalProperties: false,
      },
    },
  };
}

export const comparatorResponseFormat = {
  type: "json_schema" as const,
  json_schema: {
    name: "comparator_scores",
    strict: true,
    schema: {
      type: "object",
      properties: {
        item_scores: {
          type: "array",
          items: {
            type: "object",
            properties: {
              reconstructed_item: { type: "string" },
              score: { type: "number" },
              justification: { type: "string" },
            },
            required: ["reconstructed_item", "score", "justification"],
            additionalProperties: false,
          },
        },
      },
      required: ["item_scores"],
      additionalProperties: false,
    },
  },
} as const;
```

- [ ] **Step 3: Commit**

```bash
git add evaluation/reconstruct/types.ts evaluation/reconstruct/schema.ts
git commit -m "feat(eval): add persona reconstruction types and JSON schemas"
```

---

## Task 2: Config (TDD)

**Files:**
- Create: `evaluation/reconstruct/config.ts`
- Create: `evaluation/reconstruct/__tests__/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `evaluation/reconstruct/__tests__/config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadReconstructConfig } from "../config";

const TMP = join(process.cwd(), "evaluation", "results", "__test_reconstruct_config__");
const CONVERSATIONS = join(TMP, "conversations");

beforeEach(() => {
  mkdirSync(CONVERSATIONS, { recursive: true });
  process.env["LLM_API_KEY"] = "test-key";
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  delete process.env["LLM_API_KEY"];
});

const validYaml = `
dataset_dir: __test_reconstruct_config__
output_name: run-001
base_url: https://openrouter.ai/api
reconstructor:
  model: mistralai/mistral-nemo
comparators:
  - model: mistralai/mistral-nemo
  - model: google/gemma-2-9b-it
`;

describe("loadReconstructConfig", () => {
  it("loads a valid config", () => {
    const cfg = loadReconstructConfig(validYaml);
    expect(cfg.outputName).toBe("run-001");
    expect(cfg.reconstructorModel).toBe("mistralai/mistral-nemo");
    expect(cfg.comparators).toHaveLength(2);
    expect(cfg.comparators[0]!.label).toBe("comparator_1");
    expect(cfg.fields).toHaveLength(6);
  });

  it("accepts optional fields override", () => {
    const yaml = validYaml + "\nfields:\n  - values\n  - fears\n";
    const cfg = loadReconstructConfig(yaml);
    expect(cfg.fields).toEqual(["values", "fears"]);
  });

  it("throws when LLM_API_KEY is missing", () => {
    delete process.env["LLM_API_KEY"];
    expect(() => loadReconstructConfig(validYaml)).toThrow("LLM_API_KEY");
  });

  it("throws when output directory already exists", () => {
    mkdirSync(join(TMP, "reconstruct_persona", "run-001"), { recursive: true });
    expect(() => loadReconstructConfig(validYaml)).toThrow("already exists");
  });

  it("throws when conversations directory is missing", () => {
    rmSync(CONVERSATIONS, { recursive: true });
    expect(() => loadReconstructConfig(validYaml)).toThrow("conversations");
  });

  it("throws when dataset_dir contains a slash", () => {
    const yaml = validYaml.replace("__test_reconstruct_config__", "foo/bar");
    expect(() => loadReconstructConfig(yaml)).toThrow();
  });

  it("throws when no comparators are provided", () => {
    const yaml = validYaml.replace(/comparators:[\s\S]*?(?=\n\w|$)/, "comparators: []");
    expect(() => loadReconstructConfig(yaml)).toThrow();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
bun test evaluation/reconstruct/__tests__/config.test.ts 2>&1 | tail -5
```

Expected: error — `loadReconstructConfig` not found.

- [ ] **Step 3: Implement `evaluation/reconstruct/config.ts`**

```typescript
import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PROFILE_FIELDS } from "./types";
import type { ProfileField, ValidatedReconstructConfig, ComparatorConfig } from "./types";

const ComparatorInputSchema = z.object({ model: z.string().min(1) });

const ReconstructConfigSchema = z.object({
  dataset_dir: z.string().min(1).refine(
    (v) => !v.includes("/") && !v.includes("\\") && !v.includes(".."),
    "dataset_dir must be a simple directory name",
  ),
  output_name: z.string().min(1).refine(
    (v) => !v.includes("/") && !v.includes("\\") && !v.includes(".."),
    "output_name must be a simple directory name",
  ),
  base_url: z.string().min(1),
  reconstructor: z.object({ model: z.string().min(1) }),
  comparators: z.array(ComparatorInputSchema).min(1, "At least 1 comparator required").max(3, "At most 3 comparators allowed"),
  fields: z.array(z.enum(PROFILE_FIELDS)).optional(),
});

export function loadReconstructConfig(
  rawConfigText: string,
  resultsBasePath: string = join(process.cwd(), "evaluation", "results"),
): ValidatedReconstructConfig {
  const parsed: unknown = parseYaml(rawConfigText);
  const input = ReconstructConfigSchema.parse(parsed);

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

  const outputDir = join(datasetDir, "reconstruct_persona", input.output_name);
  if (existsSync(outputDir)) {
    throw new Error(
      `Reconstruct output directory already exists: ${outputDir}\nDelete it or choose a different output_name.`,
    );
  }

  const comparators: ComparatorConfig[] = input.comparators.map((c, i) => ({
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
    rawConfigText,
  };
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
bun test evaluation/reconstruct/__tests__/config.test.ts 2>&1 | tail -5
```

Expected: `7 pass  0 fail`

- [ ] **Step 5: Commit**

```bash
git add evaluation/reconstruct/config.ts evaluation/reconstruct/__tests__/config.test.ts
git commit -m "feat(eval): add persona reconstruction config loader"
```

---

## Task 3: Scoring (TDD)

**Files:**
- Create: `evaluation/reconstruct/scoring.ts`
- Create: `evaluation/reconstruct/__tests__/scoring.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `evaluation/reconstruct/__tests__/scoring.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import {
  majorityVote,
  computeAgreement,
  buildItemScores,
  computeFieldScore,
  computeCharacterScore,
  computePairDiff,
} from "../scoring";
import type { ItemScore } from "../types";

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
    expect(result[1]!.score).toBe(0); // majority of [0, -1] = 0 (tie → 0)
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

describe("computeCharacterScore", () => {
  it("averages f1 across observed fields only", () => {
    const fieldScores = {
      personalityTraits: { not_observed: false, observed_count: 2, gt_count: 3, matched: 2, contradicted: 0, precision: 1, recall: 0.67, f1: 0.8, comparator_agreement: 1, item_scores: [] },
      speechPatterns:    { not_observed: true,  observed_count: 0, gt_count: 2, matched: 0, contradicted: 0, precision: 0, recall: 0,    f1: 0,   comparator_agreement: 1, item_scores: [] },
      values:            { not_observed: false, observed_count: 1, gt_count: 2, matched: 1, contradicted: 0, precision: 1, recall: 0.5,  f1: 0.67, comparator_agreement: 1, item_scores: [] },
      fears:             { not_observed: true,  observed_count: 0, gt_count: 2, matched: 0, contradicted: 0, precision: 0, recall: 0,    f1: 0,   comparator_agreement: 1, item_scores: [] },
      goals:             { not_observed: false, observed_count: 1, gt_count: 1, matched: 1, contradicted: 0, precision: 1, recall: 1,    f1: 1,   comparator_agreement: 1, item_scores: [] },
      copingStyle:       { not_observed: false, observed_count: 1, gt_count: 2, matched: 0, contradicted: 1, precision: 0, recall: 0,    f1: 0,   comparator_agreement: 1, item_scores: [] },
    } as any;
    const score = computeCharacterScore(fieldScores);
    expect(score.mean_f1).toBeCloseTo((0.8 + 0.67 + 1 + 0) / 4);
    expect(score.contradiction_count).toBe(1);
    expect(score.fields_not_observed).toEqual(["speechPatterns", "fears"]);
  });
});

describe("computePairDiff", () => {
  it("marks differentiated when diagonal high and cross low", () => {
    const r = computePairDiff(["char_009", "char_010"], "speechPatterns", 0.8, 0.7, 0.1, 0.2, true);
    expect(r.differentiated).toBe(true);
  });

  it("marks not differentiated when diagonal low", () => {
    const r = computePairDiff(["char_009", "char_010"], "speechPatterns", 0.3, 0.8, 0.1, 0.2, true);
    expect(r.differentiated).toBe(false);
  });

  it("marks not differentiated when cross high", () => {
    const r = computePairDiff(["char_009", "char_010"], "speechPatterns", 0.8, 0.7, 0.6, 0.2, true);
    expect(r.differentiated).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
bun test evaluation/reconstruct/__tests__/scoring.test.ts 2>&1 | tail -5
```

Expected: import error — `scoring.ts` not found.

- [ ] **Step 3: Implement `evaluation/reconstruct/scoring.ts`**

```typescript
import { PROFILE_FIELDS } from "./types";
import type {
  ProfileField,
  ItemScore,
  FieldScore,
  CharacterScore,
  CharacterResult,
  PairDifferentiationResult,
  ConversationReconstructionResult,
} from "./types";

const PAIR_DIFF_THRESHOLD = 0.5;

export function majorityVote(scores: number[]): 1 | 0 | -1 {
  if (scores.length === 0) return 0;
  const sum = scores.reduce((a, b) => a + b, 0);
  if (sum > 0) return 1;
  if (sum < 0) return -1;
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

export function computeCharacterScore(
  fieldScores: Record<ProfileField, FieldScore>,
): CharacterScore {
  const observed = PROFILE_FIELDS.filter((f) => !fieldScores[f]!.not_observed);
  const notObserved = PROFILE_FIELDS.filter((f) => fieldScores[f]!.not_observed);

  if (observed.length === 0) {
    return { mean_f1: 0, mean_precision: 0, mean_recall: 0, contradiction_count: 0, fields_not_observed: notObserved };
  }

  const avg = (key: "f1" | "precision" | "recall") =>
    observed.reduce((s, f) => s + fieldScores[f]![key], 0) / observed.length;

  return {
    mean_f1: avg("f1"),
    mean_precision: avg("precision"),
    mean_recall: avg("recall"),
    contradiction_count: observed.reduce((s, f) => s + fieldScores[f]!.contradicted, 0),
    fields_not_observed: notObserved,
  };
}

export function computePairDiff(
  pairIds: [string, string],
  varyingAxis: string,
  A_on_A: number,
  B_on_B: number,
  A_on_B: number,
  B_on_A: number,
  scenario_activates_axis: boolean,
): PairDifferentiationResult {
  const differentiated =
    A_on_A > PAIR_DIFF_THRESHOLD &&
    B_on_B > PAIR_DIFF_THRESHOLD &&
    A_on_B < PAIR_DIFF_THRESHOLD &&
    B_on_A < PAIR_DIFF_THRESHOLD;

  return { pair_ids: pairIds, varying_axis: varyingAxis, scenario_activates_axis, A_on_A, B_on_B, A_on_B, B_on_A, differentiated };
}

// ── Summary aggregation ───────────────────────────────────────────────────────

type FieldAggregate = {
  mean_f1: number;
  mean_precision: number;
  mean_recall: number;
  mean_contradicted: number;
};

type TierAggregate = { count: number; mean_f1: number; mean_contradiction_rate: number };

export type ReconstructionSummary = {
  total_conversations: number;
  total_characters_evaluated: number;
  comparator_models: string[];
  mean_inter_comparator_agreement: number;
  field_aggregates: Record<ProfileField, FieldAggregate>;
  by_difficulty: Record<string, TierAggregate>;
  by_tier: Record<string, TierAggregate>;
  pair_differentiation: {
    total_pairs_evaluated: number;
    pairs_differentiated: number;
    accuracy: number;
    by_pair: PairDifferentiationResult[];
  };
};

export function computeSummary(
  results: ConversationReconstructionResult[],
  comparatorModels: string[],
): ReconstructionSummary {
  const allChars = results.flatMap((r) => r.characters);

  const fieldAgg = (field: ProfileField): FieldAggregate => {
    const observed = allChars.filter((c) => !c.field_scores[field]!.not_observed);
    if (observed.length === 0) return { mean_f1: 0, mean_precision: 0, mean_recall: 0, mean_contradicted: 0 };
    const avg = (key: "f1" | "precision" | "recall") =>
      observed.reduce((s, c) => s + c.field_scores[field]![key], 0) / observed.length;
    return {
      mean_f1: avg("f1"),
      mean_precision: avg("precision"),
      mean_recall: avg("recall"),
      mean_contradicted: observed.reduce((s, c) => s + c.field_scores[field]!.contradicted, 0) / observed.length,
    };
  };

  const tierAgg = (chars: CharacterResult[]): TierAggregate => ({
    count: chars.length,
    mean_f1: chars.length ? chars.reduce((s, c) => s + c.character_score.mean_f1, 0) / chars.length : 0,
    mean_contradiction_rate: chars.length
      ? chars.reduce((s, c) => s + c.character_score.contradiction_count, 0) /
        chars.reduce((s, c) => s + PROFILE_FIELDS.filter((f) => !c.field_scores[f]!.not_observed).length, 0)
      : 0,
  });

  const allPairs = results.flatMap((r) => (r.pair_differentiation ? [r.pair_differentiation] : []));

  const allItemScores = allChars.flatMap((c) =>
    PROFILE_FIELDS.flatMap((f) => c.field_scores[f]!.item_scores),
  );
  const mean_inter_comparator_agreement =
    allItemScores.length > 0
      ? allItemScores.reduce((s, is) => s + is.comparator_agreement, 0) / allItemScores.length
      : 1.0;

  const difficultyGroups: Record<string, CharacterResult[]> = {};
  const tierGroups: Record<string, CharacterResult[]> = {};

  for (const conv of results) {
    const diff = conv.scenario_difficulty;
    difficultyGroups[diff] ??= [];
    tierGroups["all"] ??= [];
    for (const char of conv.characters) {
      difficultyGroups[diff]!.push(char);
      const tier = char.difficulty_tier;
      tierGroups[tier] ??= [];
      tierGroups[tier]!.push(char);
    }
  }

  return {
    total_conversations: results.length,
    total_characters_evaluated: allChars.length,
    comparator_models: comparatorModels,
    mean_inter_comparator_agreement,
    field_aggregates: Object.fromEntries(PROFILE_FIELDS.map((f) => [f, fieldAgg(f)])) as Record<ProfileField, FieldAggregate>,
    by_difficulty: Object.fromEntries(Object.entries(difficultyGroups).map(([k, v]) => [k, tierAgg(v)])),
    by_tier: Object.fromEntries(Object.entries(tierGroups).filter(([k]) => k !== "all").map(([k, v]) => [k, tierAgg(v)])),
    pair_differentiation: {
      total_pairs_evaluated: allPairs.length,
      pairs_differentiated: allPairs.filter((p) => p.differentiated).length,
      accuracy: allPairs.length ? allPairs.filter((p) => p.differentiated).length / allPairs.length : 0,
      by_pair: allPairs,
    },
  };
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
bun test evaluation/reconstruct/__tests__/scoring.test.ts 2>&1 | tail -5
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add evaluation/reconstruct/scoring.ts evaluation/reconstruct/__tests__/scoring.test.ts
git commit -m "feat(eval): add persona reconstruction scoring functions"
```

---

## Task 4: Prompts

**Files:**
- Create: `evaluation/reconstruct/prompt.ts`

- [ ] **Step 1: Create `evaluation/reconstruct/prompt.ts`**

```typescript
import type { ProfileField } from "./types";
import type { ScenarioRecord } from "../runner/config";
import type { ConversationMessage } from "../runner/conversation";

const FIELD_DEFINITIONS: Record<ProfileField, string> = {
  personalityTraits: "Stable character traits that show up across different situations — adjectives or short phrases describing how this character fundamentally is.",
  speechPatterns: "Observable features of how this character constructs sentences: pronoun choice, sentence length, rhythm, hedging, vocabulary register, rhetorical habits.",
  values: "What this character demonstrably prioritizes, protects, or acts to uphold — inferred from their choices and stated positions.",
  fears: "What this character avoids, resists, or shows distress about — inferred from what they protect against or refuse.",
  goals: "What this character is trying to achieve or move towards in this interaction and in general.",
  copingStyle: "How this character manages stress, conflict, or uncertainty — behavioral patterns visible when under pressure.",
};

export function buildReconstructorSystemPrompt(): string {
  return `You are a behavioral analyst. Your task is to infer a fictional character's personality profile from a conversation transcript.

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
6. For values/fears/goals: infer from what the character chooses, refuses, or defends — not from what they say they believe.`;
}

export function buildReconstructorUserMessage(
  alias: string,
  scenario: ScenarioRecord,
  messages: ConversationMessage[],
  fields: ProfileField[],
): string {
  const parts: string[] = [];

  parts.push("## Scenario\n");
  parts.push(`**Title:** ${scenario.title}`);
  parts.push(`**Context:** ${scenario.context}\n`);

  parts.push("## Conversation Transcript\n");
  parts.push(`Read the following exchanges. You will reconstruct the profile for **${alias}** only.\n`);

  for (const msg of messages) {
    parts.push(`**${msg.character_name}** [${msg.emotion}, ${msg.intensity}]: ${msg.content}`);
  }
  parts.push("");

  parts.push(`## Task: Reconstruct profile for alias "${alias}"\n`);
  parts.push("For each field below, output reconstructed items or mark not_observed.\n");

  for (const field of fields) {
    parts.push(`**${field}:** ${FIELD_DEFINITIONS[field]}`);
  }

  return parts.join("\n");
}

export function buildComparatorSystemPrompt(): string {
  return `You are an expert semantic evaluator. Your task is to score reconstructed personality items against ground-truth profile items.

For each reconstructed item, determine whether it is covered by the ground-truth:

  1 (MATCH): The reconstructed item expresses the same idea as at least one ground-truth item, even if worded differently. Paraphrase, synonym, and generalization all count as a match.
  0 (NO MATCH): The reconstructed item is not covered by any ground-truth item. It may be a plausible trait not mentioned in the ground truth — that is fine.
 -1 (CONTRADICTION): The reconstructed item directly contradicts a ground-truth item. Use -1 only when the reconstructed item is incompatible with or the opposite of a ground-truth item.

Important: reserve -1 for clear semantic contradictions. A trait absent from the ground-truth is a 0, not a -1. Ambiguous cases default to 0.

For each item provide a justification: which ground-truth item it matches, partially matches, is contradicted by, or why there is no match.`;
}

export function buildComparatorUserMessage(
  field: ProfileField,
  gtItems: string[],
  reconstructedItems: string[],
): string {
  const parts: string[] = [];

  parts.push(`## Field: ${field}\n`);
  parts.push(`**Definition:** ${FIELD_DEFINITIONS[field]}\n`);

  parts.push("## Ground-Truth Items\n");
  gtItems.forEach((item, i) => parts.push(`${i + 1}. ${item}`));
  parts.push("");

  parts.push("## Reconstructed Items to Score\n");
  parts.push("Score each item as 1 (match), 0 (no match), or -1 (contradiction).\n");
  reconstructedItems.forEach((item, i) => parts.push(`${i + 1}. ${item}`));

  return parts.join("\n");
}
```

- [ ] **Step 2: Commit**

```bash
git add evaluation/reconstruct/prompt.ts
git commit -m "feat(eval): add persona reconstruction prompt builders"
```

---

## Task 5: LLM Call Functions

**Files:**
- Create: `evaluation/reconstruct/call.ts`

- [ ] **Step 1: Create `evaluation/reconstruct/call.ts`**

```typescript
import OpenAI from "openai";
import { ReconstructorOutputSchema, ComparatorOutputSchema } from "./types";
import type { ReconstructorOutput, ComparatorOutput, ProfileField } from "./types";
import { buildReconstructorResponseFormat, comparatorResponseFormat } from "./schema";

const MAX_RETRIES = 3;

export async function callReconstructor(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userMessage: string,
  fields: ProfileField[],
  label: string,
): Promise<ReconstructorOutput> {
  const responseFormat = buildReconstructorResponseFormat(fields);
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model,
        temperature: 0,
        stream: false,
        response_format: responseFormat,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        extra_headers: { "HTTP-Referer": "https://openormus.app", "X-Title": "OpenOrmus" },
      });

      const raw = response.choices[0]?.message.content;
      if (!raw) throw new Error(`[${label}] empty response on attempt ${attempt}`);

      let parsed: unknown;
      try { parsed = JSON.parse(raw); }
      catch { throw new Error(`[${label}] JSON parse failed. Raw:\n${raw}`); }

      return ReconstructorOutputSchema.parse(parsed);
    } catch (err) {
      lastError = err;
      process.stderr.write(`  [${label}] attempt ${attempt}/${MAX_RETRIES} failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  throw new Error(`[${label}] all ${MAX_RETRIES} attempts failed. Last: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function callComparator(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userMessage: string,
  label: string,
): Promise<ComparatorOutput> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model,
        temperature: 0,
        stream: false,
        response_format: comparatorResponseFormat,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        extra_headers: { "HTTP-Referer": "https://openormus.app", "X-Title": "OpenOrmus" },
      });

      const raw = response.choices[0]?.message.content;
      if (!raw) throw new Error(`[${label}] empty response on attempt ${attempt}`);

      let parsed: unknown;
      try { parsed = JSON.parse(raw); }
      catch { throw new Error(`[${label}] JSON parse failed. Raw:\n${raw}`); }

      return ComparatorOutputSchema.parse(parsed);
    } catch (err) {
      lastError = err;
      process.stderr.write(`  [${label}] attempt ${attempt}/${MAX_RETRIES} failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  throw new Error(`[${label}] all ${MAX_RETRIES} attempts failed. Last: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
```

- [ ] **Step 2: Commit**

```bash
git add evaluation/reconstruct/call.ts
git commit -m "feat(eval): add persona reconstruction LLM call functions"
```

---

## Task 6: Writer

**Files:**
- Create: `evaluation/reconstruct/writer.ts`

- [ ] **Step 1: Create `evaluation/reconstruct/writer.ts`**

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
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "config.yaml"), rawConfigText, "utf-8");
  return outputDir;
}

export function writeReconstructResults(
  outputDir: string,
  results: ConversationReconstructionResult[],
): void {
  writeFileSync(join(outputDir, "reconstruction_result.yaml"), stringify(results), "utf-8");
}

export function writeSummary(outputDir: string, summary: ReconstructionSummary): void {
  writeFileSync(join(outputDir, "summary.yaml"), stringify(summary), "utf-8");
}
```

- [ ] **Step 2: Commit**

```bash
git add evaluation/reconstruct/writer.ts
git commit -m "feat(eval): add persona reconstruction writer"
```

---

## Task 7: Per-Conversation Orchestration

**Files:**
- Create: `evaluation/reconstruct/index.ts`

- [ ] **Step 1: Create `evaluation/reconstruct/index.ts`**

```typescript
import OpenAI from "openai";
import { callReconstructor, callComparator } from "./call";
import {
  buildReconstructorSystemPrompt,
  buildReconstructorUserMessage,
  buildComparatorSystemPrompt,
  buildComparatorUserMessage,
} from "./prompt";
import {
  buildItemScores,
  computeFieldScore,
  computeCharacterScore,
  computePairDiff,
} from "./scoring";
import { reconstructAliasMap } from "../judge/alias";
import { PROFILE_FIELDS } from "./types";
import type {
  ProfileField,
  FieldScore,
  CharacterResult,
  PairDifferentiationResult,
  ConversationReconstructionResult,
  ValidatedReconstructConfig,
} from "./types";
import type { CharacterRecord, ScenarioRecord } from "../runner/config";
import type { ConversationResult } from "../runner/conversation";

function getGtItems(char: CharacterRecord, field: ProfileField): string[] {
  return (char[field as keyof CharacterRecord] as string[] | undefined) ?? [];
}

function scenarioActivatesAxis(scenario: ScenarioRecord): boolean {
  return scenario.difficulty_level !== "baseline";
}

export async function runReconstructionForConversation(
  result: ConversationResult,
  fileName: string,
  scenario: ScenarioRecord,
  characters: CharacterRecord[],
  config: ValidatedReconstructConfig,
  apiKey: string,
): Promise<ConversationReconstructionResult> {
  const client = new OpenAI({ baseURL: `${config.baseUrl}/v1`, apiKey });
  const aliasMap = reconstructAliasMap(result.characters, characters);

  const reconstructorSystemPrompt = buildReconstructorSystemPrompt();
  const comparatorSystemPrompt = buildComparatorSystemPrompt();

  // Strip reasoning/subtext — only content, emotion, intensity go to reconstructor
  const strippedMessages = result.messages.map((m) => ({
    ...m,
    reasoning: "",
    subtext: "",
  }));

  const charResults: CharacterResult[] = [];
  const reconstructedByAlias: Map<string, Map<ProfileField, string[]>> = new Map();

  for (const convChar of result.characters) {
    const alias = convChar.name;
    const realName = aliasMap[alias] ?? alias;
    const charRecord = characters.find((c) => c.id === convChar.id);
    if (!charRecord) throw new Error(`Character ${convChar.id} not found in dataset`);

    process.stdout.write(`  [${alias} → ${realName}] reconstructing…`);

    const userMsg = buildReconstructorUserMessage(alias, scenario, strippedMessages, config.fields);
    const reconstruction = await callReconstructor(
      client,
      config.reconstructorModel,
      reconstructorSystemPrompt,
      userMsg,
      config.fields,
      `reconstructor:${alias}`,
    );
    process.stdout.write(" done\n");

    const fieldItemsByField: Map<ProfileField, string[]> = new Map();
    const fieldScores: Partial<Record<ProfileField, FieldScore>> = {};

    for (const field of config.fields) {
      const reconstructedField = reconstruction.fields[field];
      const notObserved = !reconstructedField || reconstructedField.not_observed || reconstructedField.items.length === 0;
      const reconstructedItems = notObserved ? [] : reconstructedField.items;
      fieldItemsByField.set(field, reconstructedItems);

      if (notObserved) {
        fieldScores[field] = computeFieldScore(true, getGtItems(charRecord, field), []);
        continue;
      }

      const gtItems = getGtItems(charRecord, field);
      process.stdout.write(`    [${field}] comparing ${reconstructedItems.length} items vs ${gtItems.length} GT…`);

      const comparatorOutputs = await Promise.all(
        config.comparators.map(async (comp) => {
          const compUserMsg = buildComparatorUserMessage(field, gtItems, reconstructedItems);
          const output = await callComparator(client, comp.model, comparatorSystemPrompt, compUserMsg, `${comp.label}:${alias}:${field}`);
          return { model: comp.model, scores: output.item_scores };
        }),
      );

      const itemScores = buildItemScores(reconstructedItems, comparatorOutputs);
      fieldScores[field] = computeFieldScore(false, gtItems, itemScores);
      process.stdout.write(" done\n");
    }

    // Fill missing configured fields (not in reconstruction) as not_observed
    for (const field of config.fields) {
      if (!fieldScores[field]) {
        fieldScores[field] = computeFieldScore(true, getGtItems(charRecord, field), []);
      }
    }
    // Fill non-configured fields as not_observed for type completeness
    for (const field of PROFILE_FIELDS) {
      if (!fieldScores[field]) {
        fieldScores[field] = computeFieldScore(true, [], []);
      }
    }

    reconstructedByAlias.set(alias, fieldItemsByField);

    charResults.push({
      alias,
      real_name: realName,
      difficulty_tier: charRecord.difficultyTier,
      varying_axis: charRecord.varyingAxis,
      field_scores: fieldScores as Record<ProfileField, FieldScore>,
      character_score: computeCharacterScore(fieldScores as Record<ProfileField, FieldScore>),
    });
  }

  // ── Pair differentiation ──────────────────────────────────────────────────
  let pairDiff: PairDifferentiationResult | null = null;

  const charRecords = result.characters.map((c) => characters.find((r) => r.id === c.id)!);
  const pairA = charRecords.find((c) => c.similarTo && charRecords.some((d) => d.id === c.similarTo));

  if (pairA && pairA.varyingAxis) {
    const pairB = charRecords.find((c) => c.id === pairA.similarTo)!;
    const varyingAxis = pairA.varyingAxis as ProfileField;
    if (config.fields.includes(varyingAxis)) {
      const aliasA = result.characters.find((c) => c.id === pairA.id)!.name;
      const aliasB = result.characters.find((c) => c.id === pairB.id)!.name;
      const itemsA = reconstructedByAlias.get(aliasA)?.get(varyingAxis) ?? [];
      const itemsB = reconstructedByAlias.get(aliasB)?.get(varyingAxis) ?? [];
      const gtA = getGtItems(pairA, varyingAxis);
      const gtB = getGtItems(pairB, varyingAxis);

      const A_on_A = charResults.find((c) => c.alias === aliasA)?.field_scores[varyingAxis]?.recall ?? 0;
      const B_on_B = charResults.find((c) => c.alias === aliasB)?.field_scores[varyingAxis]?.recall ?? 0;

      // Cross comparisons: A's reconstruction vs B's GT, B's reconstruction vs A's GT
      let A_on_B = 0;
      let B_on_A = 0;

      if (itemsA.length > 0 && gtB.length > 0) {
        process.stdout.write(`  [pair diff] A_on_B cross comparison…`);
        const crossOutputsAonB = await Promise.all(
          config.comparators.map(async (comp) => {
            const msg = buildComparatorUserMessage(varyingAxis, gtB, itemsA);
            const out = await callComparator(client, comp.model, comparatorSystemPrompt, msg, `${comp.label}:cross-A-on-B`);
            return { model: comp.model, scores: out.item_scores };
          }),
        );
        const crossScoresA = buildItemScores(itemsA, crossOutputsAonB);
        A_on_B = gtB.length > 0 ? crossScoresA.filter((s) => s.score === 1).length / gtB.length : 0;
        process.stdout.write(" done\n");
      }

      if (itemsB.length > 0 && gtA.length > 0) {
        process.stdout.write(`  [pair diff] B_on_A cross comparison…`);
        const crossOutputsBonA = await Promise.all(
          config.comparators.map(async (comp) => {
            const msg = buildComparatorUserMessage(varyingAxis, gtA, itemsB);
            const out = await callComparator(client, comp.model, comparatorSystemPrompt, msg, `${comp.label}:cross-B-on-A`);
            return { model: comp.model, scores: out.item_scores };
          }),
        );
        const crossScoresB = buildItemScores(itemsB, crossOutputsBonA);
        B_on_A = gtA.length > 0 ? crossScoresB.filter((s) => s.score === 1).length / gtA.length : 0;
        process.stdout.write(" done\n");
      }

      pairDiff = computePairDiff(
        [pairA.id, pairB.id],
        varyingAxis,
        A_on_A,
        B_on_B,
        A_on_B,
        B_on_A,
        scenarioActivatesAxis(scenario),
      );
    }
  }

  return {
    conversation_file: fileName,
    scenario_id: result.scenario_id,
    scenario_title: result.scenario_title,
    scenario_difficulty: scenario.difficulty_level,
    scenario_stress_axes: scenario.stress_axes,
    characters: charResults,
    pair_differentiation: pairDiff,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add evaluation/reconstruct/index.ts
git commit -m "feat(eval): add persona reconstruction per-conversation orchestration"
```

---

## Task 8: Main Pass + Entry Point + Example Config

**Files:**
- Create: `evaluation/reconstruct/pass.ts`
- Create: `evaluation/reconstruct_persona.ts`
- Create: `evaluation/configs/reconstruct-persona.yaml`

- [ ] **Step 1: Create `evaluation/reconstruct/pass.ts`**

```typescript
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadReconstructConfig } from "./config";
import { runReconstructionForConversation } from "./index";
import { initReconstructOutputDir, writeReconstructResults, writeSummary } from "./writer";
import { computeSummary } from "./scoring";
import type { CharacterRecord, ScenarioRecord } from "../runner/config";
import type { ConversationResult } from "../runner/conversation";
import type { ConversationReconstructionResult } from "./types";

import rawCharacters from "../dataset/characters.yaml";
import rawScenarios from "../dataset/scenarios.yaml";

const ALL_CHARACTERS = rawCharacters as CharacterRecord[];
const ALL_SCENARIOS = rawScenarios as ScenarioRecord[];

export async function runReconstructionPass(configPath: string): Promise<void> {
  const rawConfigText = readFileSync(configPath, "utf-8");
  const config = loadReconstructConfig(rawConfigText);
  const apiKey = process.env["LLM_API_KEY"]!;

  const outputDir = initReconstructOutputDir(config.datasetDir, config.outputName, rawConfigText);

  try {
    const conversationsDir = join(config.datasetDir, "conversations");
    const files = readdirSync(conversationsDir).filter((f) => f.endsWith(".yaml")).sort();

    if (files.length === 0) {
      throw new Error(`No conversation YAML files found in ${conversationsDir}`);
    }

    const allResults: ConversationReconstructionResult[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const raw = readFileSync(join(conversationsDir, file), "utf-8");
      const result = parseYaml(raw) as ConversationResult;

      if (!result.messages || result.messages.length === 0) {
        console.log(`[${i + 1}/${files.length}] ${file} — skipped (failed conversation)`);
        continue;
      }

      const scenario = ALL_SCENARIOS.find((s) => s.id === result.scenario_id);
      if (!scenario) throw new Error(`Scenario "${result.scenario_id}" not found (from ${file})`);

      const characters = result.characters.map((c) => {
        const found = ALL_CHARACTERS.find((r) => r.id === c.id);
        if (!found) throw new Error(`Character "${c.id}" not found (from ${file})`);
        return found;
      });

      console.log(`[${i + 1}/${files.length}] ${result.scenario_id} · ${result.characters.map((c) => c.name).join(" + ")}`);

      const convResult = await runReconstructionForConversation(
        result,
        file,
        scenario,
        characters,
        config,
        apiKey,
      );
      allResults.push(convResult);
    }

    writeReconstructResults(outputDir, allResults);
    writeSummary(outputDir, computeSummary(allResults, config.comparators.map((c) => c.model)));

    console.log(`\nDone. Results written to ${outputDir}/`);
  } catch (err) {
    rmSync(outputDir, { recursive: true, force: true });
    console.error(`\nReconstruction failed — removed incomplete output: ${outputDir}`);
    throw err;
  }
}
```

- [ ] **Step 2: Create `evaluation/reconstruct_persona.ts`**

```typescript
import { runReconstructionPass } from "./reconstruct/pass";

const configPath = process.argv[2];
if (!configPath) {
  console.error("Usage: bun evaluation/reconstruct_persona.ts <config.yaml>");
  process.exit(1);
}

await runReconstructionPass(configPath);
```

- [ ] **Step 3: Create `evaluation/configs/reconstruct-persona.yaml`**

```yaml
# Persona Reconstruction — Example Config
# Run: bun evaluation/reconstruct_persona.ts evaluation/configs/reconstruct-persona.yaml
# Required env: LLM_API_KEY
#
# NOTE: pair differentiation is most meaningful when both pair members (char_009/010,
# char_011/012, char_013/014, char_015/016) appear under the same scenario_id.

dataset_dir: "dataset-001"
output_name: "reconstruct-run-001"
base_url: "https://openrouter.ai/api"

reconstructor:
  model: "mistralai/mistral-nemo"

comparators:
  - model: "mistralai/mistral-nemo"
  - model: "google/gemma-2-9b-it"

# fields: optional — defaults to all 6 behavioural fields
# fields:
#   - personalityTraits
#   - speechPatterns
#   - values
#   - fears
#   - goals
#   - copingStyle
```

- [ ] **Step 4: Run full typecheck**

```bash
bun run typecheck 2>&1 | grep -E "error|Error" | head -20
```

Expected: 0 errors. Fix any type errors before proceeding.

- [ ] **Step 5: Run all eval tests**

```bash
bun test evaluation/ 2>&1 | tail -8
```

Expected: all pass including the two new test files.

- [ ] **Step 6: Commit**

```bash
git add evaluation/reconstruct/pass.ts evaluation/reconstruct_persona.ts evaluation/configs/reconstruct-persona.yaml
git commit -m "feat(eval): add persona reconstruction pass, entry point, and example config"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** types.ts covers all types from spec. Config matches spec YAML format. Output matches spec `reconstruction_result.yaml` and `summary.yaml`. Pair differentiation uses 4-directional comparison with threshold 0.5. `not_observed` is propagated correctly. `inter_comparator_agreement` is computed and reported. `scenario_activates_axis` is derived from `difficulty_level !== "baseline"`.
- [x] **No placeholders:** all steps have complete code.
- [x] **Type consistency:** `ProfileField`, `FieldScore`, `CharacterResult`, `PairDifferentiationResult`, `ConversationReconstructionResult` are defined in Task 1 and used consistently across all tasks. `computeSummary` references `ReconstructionSummary` exported from `scoring.ts`. `buildItemScores` internal type matches `ComparatorOutput.item_scores` shape.
- [x] **Imports verified:** `reconstructAliasMap` imported from `../judge/alias` (existing). `CharacterRecord`, `ScenarioRecord` from `../runner/config` (existing). `ConversationResult` from `../runner/conversation` (existing). All new imports are within the `reconstruct/` directory.
