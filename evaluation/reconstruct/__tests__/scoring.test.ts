import { describe, it, expect } from "bun:test";
import {
  majorityVote,
  computeAgreement,
  buildItemScores,
  computeFieldScore,
  computeCharacterScore,
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

