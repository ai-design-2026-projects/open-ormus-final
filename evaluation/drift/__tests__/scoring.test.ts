import { describe, it, expect } from "bun:test";
import {
  labelToScore,
  majorityVoteEngagement,
  majorityVoteAlignment,
  computeVerdict,
  computeDriftDeltas,
  computeScenarioSummaries,
} from "../scoring";
import type { SegmentScore } from "../types";

const makeSegment = (
  engScore: number,
  charScores: Array<{ id: string; score: number }>,
  idx: number,
): SegmentScore => ({
  index: idx,
  turn_range: [1, 5],
  low_confidence: false,
  scenario_engagement: {
    label: engScore === 1 ? "active" : engScore === 0.5 ? "touched" : "absent",
    votes: [],
    confidence: 1,
    score: engScore,
  },
  personality_alignment: charScores.map(({ id, score }) => ({
    character_id: id,
    archetype: "Rebel",
    label: score === 1 ? "consistent" : score === 0.5 ? "neutral" : "contradicts",
    votes: [],
    confidence: 1,
    score,
  })),
});

describe("labelToScore", () => {
  it("active → 1.0", () => expect(labelToScore("active")).toBe(1.0));
  it("touched → 0.5", () => expect(labelToScore("touched")).toBe(0.5));
  it("absent → 0.0", () => expect(labelToScore("absent")).toBe(0.0));
  it("consistent → 1.0", () => expect(labelToScore("consistent")).toBe(1.0));
  it("neutral → 0.5", () => expect(labelToScore("neutral")).toBe(0.5));
  it("contradicts → 0.0", () => expect(labelToScore("contradicts")).toBe(0.0));
});

describe("majorityVoteEngagement", () => {
  it("returns majority label with confidence", () => {
    const result = majorityVoteEngagement(["active", "active", "touched"]);
    expect(result.label).toBe("active");
    expect(result.confidence).toBeCloseTo(2 / 3);
    expect(result.score).toBeCloseTo((1 + 1 + 0.5) / 3); // mean of vote scores
  });

  it("tie → touched (middle label)", () => {
    const result = majorityVoteEngagement(["active", "touched", "absent"]);
    expect(result.label).toBe("touched");
  });

  it("unanimous absent", () => {
    const result = majorityVoteEngagement(["absent", "absent", "absent"]);
    expect(result.label).toBe("absent");
    expect(result.confidence).toBe(1.0);
  });

  it("single vote returns that label", () => {
    expect(majorityVoteEngagement(["active"]).label).toBe("active");
  });

  it("empty → touched with confidence 0", () => {
    const r = majorityVoteEngagement([]);
    expect(r.label).toBe("touched");
    expect(r.confidence).toBe(0);
  });
});

describe("majorityVoteAlignment", () => {
  it("returns majority label", () => {
    const r = majorityVoteAlignment(["consistent", "consistent", "neutral"]);
    expect(r.label).toBe("consistent");
    expect(r.confidence).toBeCloseTo(2 / 3);
    expect(r.score).toBeCloseTo((1 + 1 + 0.5) / 3); // mean of vote scores
  });

  it("tie → neutral (middle label)", () => {
    const r = majorityVoteAlignment(["consistent", "neutral", "contradicts"]);
    expect(r.label).toBe("neutral");
  });

  it("contradicts majority", () => {
    const r = majorityVoteAlignment(["contradicts", "contradicts", "neutral"]);
    expect(r.label).toBe("contradicts");
    expect(r.score).toBeCloseTo((0 + 0 + 0.5) / 3); // mean of vote scores
  });
});

describe("computeVerdict", () => {
  it("degrading when total < -0.25", () => expect(computeVerdict(-0.5)).toBe("degrading"));
  it("improving when total > 0.25", () => expect(computeVerdict(0.5)).toBe("improving"));
  it("stable within -0.25 to 0.25", () => {
    expect(computeVerdict(0)).toBe("stable");
    expect(computeVerdict(-0.25)).toBe("stable");
    expect(computeVerdict(0.25)).toBe("stable");
  });
});

describe("computeDriftDeltas", () => {
  it("computes deltas and total for two segments", () => {
    const segments = [
      makeSegment(1.0, [{ id: "char_a", score: 1.0 }], 1),
      makeSegment(0.5, [{ id: "char_a", score: 0.5 }], 2),
    ];
    const { scenarioDrift, charDrifts } = computeDriftDeltas(segments);
    expect(scenarioDrift.deltas).toHaveLength(1);
    expect(scenarioDrift.deltas[0]!.scenario_engagement_delta).toBeCloseTo(-0.5);
    expect(scenarioDrift.total).toBeCloseTo(-0.5);
    expect(scenarioDrift.verdict).toBe("degrading");
    expect(charDrifts[0]!.total).toBeCloseTo(-0.5);
    expect(charDrifts[0]!.verdict).toBe("degrading");
  });

  it("three segments produce two deltas", () => {
    const segments = [
      makeSegment(1.0, [{ id: "char_a", score: 1.0 }], 1),
      makeSegment(0.5, [{ id: "char_a", score: 0.5 }], 2),
      makeSegment(0.0, [{ id: "char_a", score: 0.0 }], 3),
    ];
    const { scenarioDrift } = computeDriftDeltas(segments);
    expect(scenarioDrift.deltas).toHaveLength(2);
    expect(scenarioDrift.total).toBeCloseTo(-1.0);
  });
});

describe("computeScenarioSummaries", () => {
  const makeConvResult = (
    scenarioId: string,
    segScores: Array<{ eng: number; chars: Array<{ id: string; score: number }> }>,
  ) => {
    const segs = segScores.map(({ eng, chars }, i) =>
      makeSegment(eng, chars, i + 1),
    );
    const { scenarioDrift, charDrifts } = computeDriftDeltas(segs);
    return {
      conversation_file: `${scenarioId}-${Math.random()}.yaml`,
      scenario_id: scenarioId,
      scenario_title: `Title ${scenarioId}`,
      stress_axes: ["axis_a"],
      segments: segs,
      drift: { scenario_engagement: scenarioDrift, personality_alignment: charDrifts },
    };
  };

  it("groups conversations by scenario_id", () => {
    const results = [
      makeConvResult("s1", [{ eng: 1.0, chars: [{ id: "c1", score: 1.0 }] }, { eng: 0.5, chars: [{ id: "c1", score: 0.5 }] }]),
      makeConvResult("s2", [{ eng: 0.5, chars: [{ id: "c2", score: 0.5 }] }, { eng: 0.5, chars: [{ id: "c2", score: 0.5 }] }]),
    ];
    const summaries = computeScenarioSummaries(results);
    expect(summaries).toHaveLength(2);
  });

  it("computes correct total_drift for scenario_engagement", () => {
    const results = [
      makeConvResult("s1", [
        { eng: 1.0, chars: [{ id: "c1", score: 1.0 }] },
        { eng: 0.0, chars: [{ id: "c1", score: 0.0 }] },
      ]),
    ];
    const [summary] = computeScenarioSummaries(results);
    expect(summary!.scenario_engagement.total_drift).toBeCloseTo(-1.0);
    expect(summary!.scenario_engagement.verdict).toBe("degrading");
  });

  it("counts low_confidence_conversations correctly", () => {
    const conv1 = makeConvResult("s1", [
      { eng: 1.0, chars: [{ id: "c1", score: 1.0 }] },
      { eng: 0.5, chars: [{ id: "c1", score: 0.5 }] },
    ]);
    const conv2 = makeConvResult("s1", [
      { eng: 0.5, chars: [{ id: "c1", score: 0.5 }] },
      { eng: 0.5, chars: [{ id: "c1", score: 0.5 }] },
    ]);
    conv1.segments[0]!.low_confidence = true;
    const summaries = computeScenarioSummaries([conv1, conv2]);
    expect(summaries[0]!.low_confidence_conversations).toBe(1);
  });

  it("throws on empty segments array in computeDriftDeltas", () => {
    expect(() => computeDriftDeltas([])).toThrow("must not be empty");
  });

  it("throws when conversations have different segment counts", () => {
    const conv1 = makeConvResult("s1", [
      { eng: 1.0, chars: [{ id: "c1", score: 1.0 }] },
      { eng: 0.5, chars: [{ id: "c1", score: 0.5 }] },
    ]);
    const conv2 = makeConvResult("s1", [
      { eng: 0.5, chars: [{ id: "c1", score: 0.5 }] },
      { eng: 0.5, chars: [{ id: "c1", score: 0.5 }] },
      { eng: 0.0, chars: [{ id: "c1", score: 0.0 }] },
    ]);
    expect(() => computeScenarioSummaries([conv1, conv2])).toThrow("same number of segments");
  });

  it("computes by_segment aggregates correctly", () => {
    const results = [
      makeConvResult("s1", [
        { eng: 1.0, chars: [{ id: "c1", score: 1.0 }] },
        { eng: 0.5, chars: [{ id: "c1", score: 0.5 }] },
      ]),
      makeConvResult("s1", [
        { eng: 0.5, chars: [{ id: "c1", score: 0.5 }] },
        { eng: 0.0, chars: [{ id: "c1", score: 0.0 }] },
      ]),
    ];
    const [summary] = computeScenarioSummaries(results);
    // Segment 1: both convs have eng=1.0 and eng=0.5 → mean 0.75 and 0.25
    expect(summary!.scenario_engagement.by_segment[0]!.mean_score).toBeCloseTo(0.75);
    expect(summary!.scenario_engagement.by_segment[1]!.mean_score).toBeCloseTo(0.25);
    // Active/touched/absent counts for segment 1
    expect(summary!.scenario_engagement.by_segment[0]!.active).toBe(1);
    expect(summary!.scenario_engagement.by_segment[0]!.touched).toBe(1);
    expect(summary!.scenario_engagement.by_segment[0]!.absent).toBe(0);
  });

  it("computes mean_drift_per_delta correctly", () => {
    const results = [
      makeConvResult("s1", [
        { eng: 1.0, chars: [{ id: "c1", score: 1.0 }] },
        { eng: 0.5, chars: [{ id: "c1", score: 0.5 }] },
        { eng: 0.0, chars: [{ id: "c1", score: 0.0 }] },
      ]),
    ];
    const [summary] = computeScenarioSummaries(results);
    // Mean scores: [1.0, 0.5, 0.0] → deltas [-0.5, -0.5] → mean = -0.5
    expect(summary!.scenario_engagement.mean_drift_per_delta).toBeCloseTo(-0.5);
  });

  it("computes by_character drift correctly", () => {
    const results = [
      makeConvResult("s1", [
        { eng: 1.0, chars: [{ id: "c1", score: 1.0 }, { id: "c2", score: 0.5 }] },
        { eng: 0.5, chars: [{ id: "c1", score: 0.0 }, { id: "c2", score: 0.5 }] },
      ]),
    ];
    const [summary] = computeScenarioSummaries(results);
    const c1 = summary!.personality_alignment.by_character.find(c => c.character_id === "c1");
    const c2 = summary!.personality_alignment.by_character.find(c => c.character_id === "c2");
    expect(c1!.mean_total_drift).toBeCloseTo(-1.0);
    expect(c1!.verdict).toBe("degrading");
    expect(c2!.mean_total_drift).toBeCloseTo(0.0);
    expect(c2!.verdict).toBe("stable");
  });
});
