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
import { ComparatorItemSchema, ComparatorOutputSchema } from "../types";
import type { ItemScore, FieldScore, CharacterResult, ConversationReconstructionResult } from "../types";

describe("ComparatorItemSchema", () => {
  it("parses a full item with reconstructed_item present", () => {
    const result = ComparatorItemSchema.parse({
      reconstructed_item: "defiant",
      score: "match",
      justification: "matches the ground truth",
    });
    expect(result.reconstructed_item).toBe("defiant");
    expect(result.score).toBe("match");
  });

  it("parses successfully when reconstructed_item is absent (defaults to empty string)", () => {
    const result = ComparatorItemSchema.parse({
      score: "no_match",
      justification: "not found in ground truth",
    });
    expect(result.reconstructed_item).toBe("");
    expect(result.score).toBe("no_match");
  });

  it("rejects an invalid score label", () => {
    expect(() =>
      ComparatorItemSchema.parse({ score: "wrong", justification: "j" }),
    ).toThrow();
  });

  it("ComparatorOutputSchema parses item_scores without reconstructed_item fields", () => {
    const result = ComparatorOutputSchema.parse({
      item_scores: [
        { score: "match", justification: "j1" },
        { score: "no_match", justification: "j2" },
      ],
    });
    expect(result.item_scores).toHaveLength(2);
    expect(result.item_scores[0]!.reconstructed_item).toBe("");
  });
});

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
      { model: "m1", scores: [{ reconstructed_item: "brave", score: "match", justification: "j1" }, { reconstructed_item: "reckless", score: "no_match", justification: "j2" }] },
      { model: "m2", scores: [{ reconstructed_item: "brave", score: "match", justification: "j3" }, { reconstructed_item: "reckless", score: "contradiction", justification: "j4" }] },
    ];
    const result = buildItemScores(items, outputs);
    expect(result[0]!.score).toBe(1);
    expect(result[0]!.comparator_agreement).toBe(1.0);
    expect(result[1]!.score).toBe(0);
  });

  it("returns one ItemScore per reconstructed item regardless of comparator count", () => {
    const result = buildItemScores(["a", "b", "c"], []);
    expect(result).toHaveLength(3);
  });

  it("defaults missing comparator scores to no_match (score 0) without throwing", () => {
    const items = ["a", "b", "c"];
    const outputs = [
      { model: "m1", scores: [{ reconstructed_item: "a", score: "match", justification: "j" }] },
    ];
    const result = buildItemScores(items, outputs);
    expect(result).toHaveLength(3);
    expect(result[0]!.score).toBe(1);
    expect(result[1]!.score).toBe(0);
    expect(result[2]!.score).toBe(0);
  });

  it("picks justification from the comparator that agrees with majority", () => {
    const items = ["brave"];
    const outputs = [
      { model: "m1", scores: [{ reconstructed_item: "brave", score: "match", justification: "from-m1" }] },
      { model: "m2", scores: [{ reconstructed_item: "brave", score: "no_match", justification: "from-m2" }] },
      { model: "m3", scores: [{ reconstructed_item: "brave", score: "match", justification: "from-m3" }] },
    ];
    const result = buildItemScores(items, outputs);
    expect(result[0]!.score).toBe(1);
    expect(result[0]!.justification).toMatch(/from-m[13]/);
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
