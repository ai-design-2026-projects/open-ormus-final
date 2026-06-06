# Context Drift Evaluation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Pass 4 of the evaluation pipeline — a CLI tool that scores each conversation in configurable time segments to detect whether the scenario's stress axes were engaged and whether characters responded in personality-consistent ways, then aggregates results per scenario.

**Architecture:** Follows the existing `evaluation/reconstruct/` file-for-file structure. One judge call per segment per judge model (9 calls for 3×3 default). Majority-vote on two dimensions — `scenario_engagement` and `personality_alignment` per character — then computes drift deltas between consecutive segments. Results aggregate into a per-scenario summary.

**Tech Stack:** Bun, TypeScript strict, OpenAI SDK, Zod v4, yaml, existing `evaluation/runner/` types.

---

## File Map

| File | Responsibility |
|---|---|
| `evaluation/drift/types.ts` | All Zod schemas + TS types |
| `evaluation/drift/segment.ts` | Split message array into N equal slices |
| `evaluation/drift/scoring.ts` | Label→score, majority vote, drift delta, verdict, scenario summaries |
| `evaluation/drift/config.ts` | YAML loader + Zod validator for drift config |
| `evaluation/drift/schema.ts` | JSON schema for OpenAI `response_format` |
| `evaluation/drift/prompt.ts` | System + user message builders |
| `evaluation/drift/call.ts` | `callJudge()` with MAX_RETRIES=3 |
| `evaluation/drift/index.ts` | Per-conversation loop: segment → judge → vote → drift |
| `evaluation/drift/writer.ts` | Write per-conversation YAML + summary YAML |
| `evaluation/drift/pass.ts` | Orchestrator: read files → loop → write |
| `evaluation/context_drift.ts` | CLI entry point |
| `evaluation/configs/context-drift.yaml` | Example config |
| `evaluation/drift/__tests__/segment.test.ts` | Segment splitter tests |
| `evaluation/drift/__tests__/scoring.test.ts` | Scoring + summary tests |
| `evaluation/drift/__tests__/config.test.ts` | Config loader tests |
| `evaluation/drift/__tests__/prompt.test.ts` | Prompt builder tests |

---

## Task 1: Types

**Files:**
- Create: `evaluation/drift/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// evaluation/drift/types.ts
import { z } from "zod";

export const ENGAGEMENT_LABELS = ["active", "touched", "absent"] as const;
export const ALIGNMENT_LABELS = ["consistent", "neutral", "contradicts"] as const;

export type EngagementLabel = (typeof ENGAGEMENT_LABELS)[number];
export type AlignmentLabel = (typeof ALIGNMENT_LABELS)[number];
export type Verdict = "degrading" | "stable" | "improving";

// ── Judge LLM output ──────────────────────────────────────────────────────────

export const JudgeOutputSchema = z.object({
  scenario_engagement: z.enum(ENGAGEMENT_LABELS),
  reasoning: z.string().min(1),
  character_alignment: z.array(
    z.object({
      character_id: z.string().min(1),
      label: z.enum(ALIGNMENT_LABELS),
      reasoning: z.string().min(1),
    }),
  ),
});
export type JudgeOutput = z.infer<typeof JudgeOutputSchema>;

// ── Per-segment scored result ─────────────────────────────────────────────────

export type EngagementScore = {
  label: EngagementLabel;
  votes: EngagementLabel[];
  confidence: number;
  score: number;
};

export type CharacterAlignmentScore = {
  character_id: string;
  archetype: string;
  label: AlignmentLabel;
  votes: AlignmentLabel[];
  confidence: number;
  score: number;
};

export type SegmentScore = {
  index: number;
  turn_range: [number, number];
  scenario_engagement: EngagementScore;
  personality_alignment: CharacterAlignmentScore[];
  low_confidence: boolean;
};

// ── Drift ─────────────────────────────────────────────────────────────────────

export type DriftDelta = {
  from_segment: number;
  to_segment: number;
  scenario_engagement_delta: number;
  character_deltas: Array<{ character_id: string; delta: number }>;
};

export type ScenarioEngagementDrift = {
  deltas: DriftDelta[];
  total: number;
  verdict: Verdict;
};

export type CharacterDrift = {
  character_id: string;
  archetype: string;
  deltas: number[];
  total: number;
  verdict: Verdict;
};

export type ConversationDriftResult = {
  conversation_file: string;
  scenario_id: string;
  scenario_title: string;
  stress_axes: string[];
  segments: SegmentScore[];
  drift: {
    scenario_engagement: ScenarioEngagementDrift;
    personality_alignment: CharacterDrift[];
  };
};

// ── Config ────────────────────────────────────────────────────────────────────

export type JudgeConfig = {
  label: string;
  model: string;
};

export type ValidatedDriftConfig = {
  datasetDir: string;
  outputName: string;
  baseUrl: string;
  segments: number;
  judges: JudgeConfig[];
  rawConfigText: string;
};

// ── Summary ───────────────────────────────────────────────────────────────────

export type SegmentAggregate = {
  index: number;
  active: number;
  touched: number;
  absent: number;
  mean_score: number;
};

export type CharacterDriftSummary = {
  character_id: string;
  archetype: string;
  mean_total_drift: number;
  verdict: Verdict;
};

export type ScenarioDriftSummary = {
  scenario_id: string;
  scenario_title: string;
  stress_axes: string[];
  total_conversations: number;
  scenario_engagement: {
    by_segment: SegmentAggregate[];
    mean_drift_per_delta: number;
    total_drift: number;
    verdict: Verdict;
  };
  personality_alignment: {
    by_segment: Array<{ index: number; mean_score: number }>;
    total_drift: number;
    verdict: Verdict;
    by_character: CharacterDriftSummary[];
  };
  low_confidence_conversations: number;
};
```

- [ ] **Step 2: Verify typecheck passes**

Run from repo root: `bun run typecheck`
Expected: no errors (types file has no runtime logic)

- [ ] **Step 3: Commit**

```bash
git add evaluation/drift/types.ts
git commit -m "feat(eval/drift): add types and Zod schemas"
```

---

## Task 2: Segment Splitter

**Files:**
- Create: `evaluation/drift/segment.ts`
- Create: `evaluation/drift/__tests__/segment.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// evaluation/drift/__tests__/segment.test.ts
import { describe, it, expect } from "bun:test";
import { splitIntoSegments } from "../segment";

const makeMessages = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    character_name: `char_${i}`,
    content: `msg_${i}`,
    emotion: "neutral",
    intensity: "low",
    reasoning: "",
    subtext: "",
  })) as any[];

describe("splitIntoSegments", () => {
  it("splits 9 messages into 3 equal segments of 3", () => {
    const result = splitIntoSegments(makeMessages(9), 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toHaveLength(3);
    expect(result[1]).toHaveLength(3);
    expect(result[2]).toHaveLength(3);
  });

  it("puts remainder in last segment (10 into 3)", () => {
    const result = splitIntoSegments(makeMessages(10), 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toHaveLength(3);
    expect(result[1]).toHaveLength(3);
    expect(result[2]).toHaveLength(4);
  });

  it("splits exactly into 2 segments", () => {
    const result = splitIntoSegments(makeMessages(6), 2);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(3);
    expect(result[1]).toHaveLength(3);
  });

  it("preserves message order", () => {
    const msgs = makeMessages(4);
    const result = splitIntoSegments(msgs, 2);
    expect(result[0]![0]!.content).toBe("msg_0");
    expect(result[1]![0]!.content).toBe("msg_2");
  });

  it("throws when messages.length < segments", () => {
    expect(() => splitIntoSegments(makeMessages(2), 3)).toThrow(
      "Cannot split 2 messages into 3 segments",
    );
  });

  it("throws when n < 2", () => {
    expect(() => splitIntoSegments(makeMessages(5), 1)).toThrow("segments must be ≥ 2");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test evaluation/drift/__tests__/segment.test.ts
```
Expected: FAIL — `Cannot find module '../segment'`

- [ ] **Step 3: Implement segment splitter**

```typescript
// evaluation/drift/segment.ts
import type { ConversationMessage } from "../runner/conversation";

export function splitIntoSegments(
  messages: ConversationMessage[],
  n: number,
): ConversationMessage[][] {
  if (n < 2) throw new Error(`segments must be ≥ 2, got ${n}`);
  if (messages.length < n) {
    throw new Error(
      `Cannot split ${messages.length} messages into ${n} segments (need at least ${n} turns)`,
    );
  }

  const segmentSize = Math.floor(messages.length / n);
  const segments: ConversationMessage[][] = [];

  for (let i = 0; i < n; i++) {
    const start = i * segmentSize;
    const end = i === n - 1 ? messages.length : (i + 1) * segmentSize;
    segments.push(messages.slice(start, end));
  }

  return segments;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test evaluation/drift/__tests__/segment.test.ts
```
Expected: 6 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add evaluation/drift/segment.ts evaluation/drift/__tests__/segment.test.ts
git commit -m "feat(eval/drift): add segment splitter with tests"
```

---

## Task 3: Scoring Utilities

**Files:**
- Create: `evaluation/drift/scoring.ts`
- Create: `evaluation/drift/__tests__/scoring.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// evaluation/drift/__tests__/scoring.test.ts
import { describe, it, expect } from "bun:test";
import {
  labelToScore,
  majorityVoteEngagement,
  majorityVoteAlignment,
  computeVerdict,
  computeDriftDeltas,
} from "../scoring";
import type { SegmentScore } from "../types";

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
    expect(result.score).toBe(1.0);
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
  });

  it("tie → neutral (middle label)", () => {
    const r = majorityVoteAlignment(["consistent", "neutral", "contradicts"]);
    expect(r.label).toBe("neutral");
  });

  it("contradicts majority", () => {
    const r = majorityVoteAlignment(["contradicts", "contradicts", "neutral"]);
    expect(r.label).toBe("contradicts");
    expect(r.score).toBe(0.0);
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test evaluation/drift/__tests__/scoring.test.ts
```
Expected: FAIL — `Cannot find module '../scoring'`

- [ ] **Step 3: Implement scoring utilities**

```typescript
// evaluation/drift/scoring.ts
import {
  ENGAGEMENT_LABELS,
  ALIGNMENT_LABELS,
} from "./types";
import type {
  EngagementLabel,
  AlignmentLabel,
  Verdict,
  SegmentScore,
  DriftDelta,
  ScenarioEngagementDrift,
  CharacterDrift,
  ConversationDriftResult,
  SegmentAggregate,
  CharacterDriftSummary,
  ScenarioDriftSummary,
} from "./types";

export function labelToScore(label: EngagementLabel | AlignmentLabel): number {
  if (label === "active" || label === "consistent") return 1.0;
  if (label === "touched" || label === "neutral") return 0.5;
  return 0.0;
}

export function majorityVoteEngagement(votes: EngagementLabel[]): {
  label: EngagementLabel;
  confidence: number;
  score: number;
} {
  const valid = votes.filter((v): v is EngagementLabel =>
    (ENGAGEMENT_LABELS as readonly string[]).includes(v),
  );
  if (valid.length === 0) return { label: "touched", confidence: 0, score: 0.5 };

  const counts = { active: 0, touched: 0, absent: 0 } as Record<EngagementLabel, number>;
  for (const v of valid) counts[v]++;

  const half = valid.length / 2;
  let label: EngagementLabel = "touched";
  if (counts.active > half) label = "active";
  else if (counts.absent > half) label = "absent";

  return { label, confidence: counts[label] / valid.length, score: labelToScore(label) };
}

export function majorityVoteAlignment(votes: AlignmentLabel[]): {
  label: AlignmentLabel;
  confidence: number;
  score: number;
} {
  const valid = votes.filter((v): v is AlignmentLabel =>
    (ALIGNMENT_LABELS as readonly string[]).includes(v),
  );
  if (valid.length === 0) return { label: "neutral", confidence: 0, score: 0.5 };

  const counts = { consistent: 0, neutral: 0, contradicts: 0 } as Record<AlignmentLabel, number>;
  for (const v of valid) counts[v]++;

  const half = valid.length / 2;
  let label: AlignmentLabel = "neutral";
  if (counts.consistent > half) label = "consistent";
  else if (counts.contradicts > half) label = "contradicts";

  return { label, confidence: counts[label] / valid.length, score: labelToScore(label) };
}

export function computeVerdict(totalDrift: number): Verdict {
  if (totalDrift < -0.25) return "degrading";
  if (totalDrift > 0.25) return "improving";
  return "stable";
}

export function computeDriftDeltas(segments: SegmentScore[]): {
  scenarioDrift: ScenarioEngagementDrift;
  charDrifts: CharacterDrift[];
} {
  const deltas: DriftDelta[] = [];

  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1]!;
    const curr = segments[i]!;
    const engDelta = curr.scenario_engagement.score - prev.scenario_engagement.score;
    const charDeltas = curr.personality_alignment.map((ca) => {
      const prevChar = prev.personality_alignment.find((p) => p.character_id === ca.character_id);
      return {
        character_id: ca.character_id,
        delta: ca.score - (prevChar?.score ?? ca.score),
      };
    });
    deltas.push({
      from_segment: prev.index,
      to_segment: curr.index,
      scenario_engagement_delta: engDelta,
      character_deltas: charDeltas,
    });
  }

  const first = segments[0]!;
  const last = segments[segments.length - 1]!;
  const engTotal = last.scenario_engagement.score - first.scenario_engagement.score;

  const charIds = first.personality_alignment.map((c) => c.character_id);
  const charDrifts: CharacterDrift[] = charIds.map((id) => {
    const charDeltas = deltas.map(
      (d) => d.character_deltas.find((cd) => cd.character_id === id)?.delta ?? 0,
    );
    const firstScore =
      first.personality_alignment.find((c) => c.character_id === id)?.score ?? 0.5;
    const lastScore =
      last.personality_alignment.find((c) => c.character_id === id)?.score ?? 0.5;
    const total = lastScore - firstScore;
    const archetype =
      first.personality_alignment.find((c) => c.character_id === id)?.archetype ?? "";
    return {
      character_id: id,
      archetype,
      deltas: charDeltas,
      total,
      verdict: computeVerdict(total),
    };
  });

  return {
    scenarioDrift: { deltas, total: engTotal, verdict: computeVerdict(engTotal) },
    charDrifts,
  };
}

// ── Scenario summary aggregation ──────────────────────────────────────────────

export function computeScenarioSummaries(
  results: ConversationDriftResult[],
): ScenarioDriftSummary[] {
  const byScenario = new Map<string, ConversationDriftResult[]>();
  for (const r of results) {
    if (!byScenario.has(r.scenario_id)) byScenario.set(r.scenario_id, []);
    byScenario.get(r.scenario_id)!.push(r);
  }

  return Array.from(byScenario.entries()).map(([scenarioId, convs]) => {
    const totalSegments = convs[0]!.segments.length;
    const lowConfidenceCount = convs.filter((c) => c.segments.some((s) => s.low_confidence)).length;

    const engagementBySegment: SegmentAggregate[] = [];
    for (let i = 0; i < totalSegments; i++) {
      const labels = convs.map((c) => c.segments[i]!.scenario_engagement.label);
      const scores = convs.map((c) => c.segments[i]!.scenario_engagement.score);
      engagementBySegment.push({
        index: i + 1,
        active: labels.filter((l) => l === "active").length,
        touched: labels.filter((l) => l === "touched").length,
        absent: labels.filter((l) => l === "absent").length,
        mean_score: scores.reduce((s, v) => s + v, 0) / scores.length,
      });
    }

    const engScores = engagementBySegment.map((s) => s.mean_score);
    const engTotal = engScores[engScores.length - 1]! - engScores[0]!;
    const engMeanPerDelta =
      totalSegments > 1
        ? engScores.slice(1).reduce((s, v, i) => s + (v - engScores[i]!), 0) / (totalSegments - 1)
        : 0;

    const alignBySegment = Array.from({ length: totalSegments }, (_, i) => {
      const segScores = convs.flatMap((c) =>
        c.segments[i]!.personality_alignment.map((a) => a.score),
      );
      return {
        index: i + 1,
        mean_score: segScores.length ? segScores.reduce((s, v) => s + v, 0) / segScores.length : 0,
      };
    });

    const alignScores = alignBySegment.map((s) => s.mean_score);
    const alignTotal = alignScores[alignScores.length - 1]! - alignScores[0]!;

    const charIds = [
      ...new Set(convs.flatMap((c) => c.drift.personality_alignment.map((d) => d.character_id))),
    ];
    const byCharacter: CharacterDriftSummary[] = charIds.map((charId) => {
      const charDrifts = convs
        .flatMap((c) => c.drift.personality_alignment)
        .filter((d) => d.character_id === charId);
      const meanTotal = charDrifts.reduce((s, d) => s + d.total, 0) / charDrifts.length;
      return {
        character_id: charId,
        archetype: charDrifts[0]!.archetype,
        mean_total_drift: meanTotal,
        verdict: computeVerdict(meanTotal),
      };
    });

    return {
      scenario_id: scenarioId,
      scenario_title: convs[0]!.scenario_title,
      stress_axes: convs[0]!.stress_axes,
      total_conversations: convs.length,
      scenario_engagement: {
        by_segment: engagementBySegment,
        mean_drift_per_delta: engMeanPerDelta,
        total_drift: engTotal,
        verdict: computeVerdict(engTotal),
      },
      personality_alignment: {
        by_segment: alignBySegment,
        total_drift: alignTotal,
        verdict: computeVerdict(alignTotal),
        by_character: byCharacter,
      },
      low_confidence_conversations: lowConfidenceCount,
    };
  });
}
```

- [ ] **Step 4: Run tests**

```bash
bun test evaluation/drift/__tests__/scoring.test.ts
```
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add evaluation/drift/scoring.ts evaluation/drift/__tests__/scoring.test.ts
git commit -m "feat(eval/drift): add scoring utilities and summary aggregation"
```

---

## Task 4: Config Loader

**Files:**
- Create: `evaluation/drift/config.ts`
- Create: `evaluation/drift/__tests__/config.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// evaluation/drift/__tests__/config.test.ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadDriftConfig } from "../config";

const TMP = join(import.meta.dir, "__tmp__");
const CONVS = join(TMP, "dataset-001", "conversations");

beforeAll(() => {
  mkdirSync(CONVS, { recursive: true });
  process.env["LLM_API_KEY"] = "test-key";
});

afterAll(() => {
  rmdirSync(TMP, { recursive: true });
  delete process.env["LLM_API_KEY"];
});

const validYaml = `
dataset_dir: "dataset-001"
output_name: "drift-run-001"
base_url: "http://localhost:11434/v1"
segments: 3
judges:
  - model: "model-a"
  - model: "model-b"
`;

describe("loadDriftConfig", () => {
  it("parses a valid config", () => {
    const cfg = loadDriftConfig(validYaml, TMP);
    expect(cfg.segments).toBe(3);
    expect(cfg.judges).toHaveLength(2);
    expect(cfg.judges[0]!.label).toBe("judge_1");
    expect(cfg.judges[1]!.model).toBe("model-b");
    expect(cfg.baseUrl).toBe("http://localhost:11434/v1");
  });

  it("throws when segments < 2", () => {
    const yaml = validYaml.replace("segments: 3", "segments: 1");
    expect(() => loadDriftConfig(yaml, TMP)).toThrow("segments must be ≥ 2");
  });

  it("throws when judges array is empty", () => {
    const yaml = validYaml.replace(
      "judges:\n  - model: \"model-a\"\n  - model: \"model-b\"",
      "judges: []",
    );
    expect(() => loadDriftConfig(yaml, TMP)).toThrow();
  });

  it("throws when conversations dir does not exist", () => {
    const yaml = validYaml.replace("dataset-001", "nonexistent-dir");
    expect(() => loadDriftConfig(yaml, TMP)).toThrow("conversations directory not found");
  });

  it("throws when output_name directory already exists", () => {
    mkdirSync(join(TMP, "dataset-001", "context_drift", "drift-run-001"), { recursive: true });
    expect(() => loadDriftConfig(validYaml, TMP)).toThrow("already exists");
    rmdirSync(join(TMP, "dataset-001", "context_drift", "drift-run-001"), { recursive: true });
  });

  it("throws when LLM_API_KEY is not set", () => {
    delete process.env["LLM_API_KEY"];
    expect(() => loadDriftConfig(validYaml, TMP)).toThrow("LLM_API_KEY");
    process.env["LLM_API_KEY"] = "test-key";
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test evaluation/drift/__tests__/config.test.ts
```
Expected: FAIL — `Cannot find module '../config'`

- [ ] **Step 3: Implement config loader**

```typescript
// evaluation/drift/config.ts
import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { existsSync } from "node:fs";
import { join } from "node:path";
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
  segments: z.number().int().min(2, "segments must be ≥ 2"),
  judges: z
    .array(z.object({ model: z.string().min(1) }))
    .min(1, "at least 1 judge required"),
});

export function loadDriftConfig(
  rawConfigText: string,
  resultsBasePath: string = join(process.cwd(), "evaluation", "results"),
): ValidatedDriftConfig {
  const parsed: unknown = parseYaml(rawConfigText);
  const input = DriftConfigSchema.parse(parsed);

  if (!process.env["LLM_API_KEY"]) throw new Error("LLM_API_KEY env var is not set");

  const datasetDir = join(resultsBasePath, input.dataset_dir);
  const conversationsDir = join(datasetDir, "conversations");

  if (!existsSync(conversationsDir)) {
    throw new Error(
      `Dataset conversations directory not found: ${conversationsDir}\nRun the generate step first.`,
    );
  }

  const outputDir = join(datasetDir, "context_drift", input.output_name);
  if (existsSync(outputDir)) {
    throw new Error(
      `Output directory already exists: ${outputDir}\nDelete it or choose a different output_name.`,
    );
  }

  return {
    datasetDir,
    outputName: input.output_name,
    baseUrl: input.base_url,
    segments: input.segments,
    judges: input.judges.map((j, i) => ({ label: `judge_${i + 1}`, model: j.model })),
    rawConfigText,
  };
}
```

- [ ] **Step 4: Run tests**

```bash
bun test evaluation/drift/__tests__/config.test.ts
```
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add evaluation/drift/config.ts evaluation/drift/__tests__/config.test.ts
git commit -m "feat(eval/drift): add config loader with validation"
```

---

## Task 5: JSON Schema + Judge Call

**Files:**
- Create: `evaluation/drift/schema.ts`
- Create: `evaluation/drift/call.ts`

- [ ] **Step 1: Create the JSON response format schema**

```typescript
// evaluation/drift/schema.ts
export const judgeResponseFormat = {
  type: "json_schema" as const,
  json_schema: {
    name: "drift_judge",
    strict: true,
    schema: {
      type: "object",
      properties: {
        scenario_engagement: {
          type: "string",
          enum: ["active", "touched", "absent"],
        },
        reasoning: { type: "string" },
        character_alignment: {
          type: "array",
          items: {
            type: "object",
            properties: {
              character_id: { type: "string" },
              label: { type: "string", enum: ["consistent", "neutral", "contradicts"] },
              reasoning: { type: "string" },
            },
            required: ["character_id", "label", "reasoning"],
            additionalProperties: false,
          },
        },
      },
      required: ["scenario_engagement", "reasoning", "character_alignment"],
      additionalProperties: false,
    },
  },
} as const;
```

- [ ] **Step 2: Create the judge call with retries**

```typescript
// evaluation/drift/call.ts
import OpenAI from "openai";
import { JudgeOutputSchema } from "./types";
import { judgeResponseFormat } from "./schema";
import type { JudgeOutput } from "./types";

const MAX_RETRIES = 3;

export async function callJudge(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userMessage: string,
  label: string,
): Promise<JudgeOutput> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model,
        temperature: 0,
        stream: false,
        response_format: judgeResponseFormat,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        extra_headers: { "HTTP-Referer": "https://openormus.app", "X-Title": "OpenOrmus" },
      });

      const raw = response.choices[0]?.message.content;
      if (!raw) throw new Error(`[${label}] empty response on attempt ${attempt}`);

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`[${label}] JSON parse failed. Raw:\n${raw}`);
      }

      return JudgeOutputSchema.parse(parsed);
    } catch (err) {
      lastError = err;
      process.stderr.write(
        `  [${label}] attempt ${attempt}/${MAX_RETRIES} failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  throw new Error(
    `[${label}] all ${MAX_RETRIES} attempts failed. Last: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}
```

- [ ] **Step 3: Verify typecheck**

```bash
bun run typecheck
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add evaluation/drift/schema.ts evaluation/drift/call.ts
git commit -m "feat(eval/drift): add JSON schema and judge call with retries"
```

---

## Task 6: Prompt Builders

**Files:**
- Create: `evaluation/drift/prompt.ts`
- Create: `evaluation/drift/__tests__/prompt.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// evaluation/drift/__tests__/prompt.test.ts
import { describe, it, expect } from "bun:test";
import { buildJudgeSystemPrompt, buildJudgeUserPrompt } from "../prompt";

const scenario = {
  id: "s1",
  title: "Test Betrayal",
  context: "A tense standoff",
  initial_prompt: "The gate is sealed.",
  difficulty_level: "high",
  stress_axes: ["loyalty_vs_principle", "truth_vs_kindness"],
  social_context: "personal_betrayal",
  pressure_source: "relational_demand",
} as any;

const characters = [
  {
    id: "char_001",
    name: "Kael Veth",
    archetype: "Rebel",
    record: {
      personalityTraits: ["defiant", "principled"],
      values: ["justice"],
      fears: ["conformity"],
      goals: ["overthrow tyranny"],
      copingStyle: ["direct confrontation"],
      speechPatterns: ["short declarative sentences"],
    } as any,
  },
];

const messages = [
  { character_name: "Kael Veth", content: "I refuse.", emotion: "anger", intensity: "high", reasoning: "", subtext: "" },
] as any[];

describe("buildJudgeSystemPrompt", () => {
  it("includes scoring instructions for both dimensions", () => {
    const prompt = buildJudgeSystemPrompt();
    expect(prompt).toContain("active");
    expect(prompt).toContain("touched");
    expect(prompt).toContain("absent");
    expect(prompt).toContain("consistent");
    expect(prompt).toContain("neutral");
    expect(prompt).toContain("contradicts");
    expect(prompt).toContain("character_id");
  });
});

describe("buildJudgeUserPrompt", () => {
  it("includes scenario stress_axes", () => {
    const prompt = buildJudgeUserPrompt(scenario, characters, messages, 1, 3, 1, 5);
    expect(prompt).toContain("loyalty_vs_principle");
    expect(prompt).toContain("personal_betrayal");
  });

  it("includes character id, name, and archetype", () => {
    const prompt = buildJudgeUserPrompt(scenario, characters, messages, 1, 3, 1, 5);
    expect(prompt).toContain("char_001");
    expect(prompt).toContain("Kael Veth");
    expect(prompt).toContain("Rebel");
  });

  it("includes character traits", () => {
    const prompt = buildJudgeUserPrompt(scenario, characters, messages, 1, 3, 1, 5);
    expect(prompt).toContain("defiant");
    expect(prompt).toContain("justice");
  });

  it("includes segment context and transcript", () => {
    const prompt = buildJudgeUserPrompt(scenario, characters, messages, 2, 3, 6, 10);
    expect(prompt).toContain("Segment 2 of 3");
    expect(prompt).toContain("turns 6");
    expect(prompt).toContain("I refuse.");
  });

  it("includes task instruction with character ids", () => {
    const prompt = buildJudgeUserPrompt(scenario, characters, messages, 1, 3, 1, 5);
    expect(prompt).toContain("char_001");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test evaluation/drift/__tests__/prompt.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement prompt builders**

```typescript
// evaluation/drift/prompt.ts
import type { ScenarioRecord } from "../runner/config";
import type { ConversationMessage } from "../runner/conversation";
import type { CharacterRecord } from "../runner/config";

export type PromptCharacter = {
  id: string;
  name: string;
  archetype: string;
  record: CharacterRecord;
};

export function buildJudgeSystemPrompt(): string {
  return `You are evaluating a roleplay conversation segment for scenario adherence and character consistency.

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

Return only valid JSON matching the provided schema. For each character in character_alignment, use the exact character_id shown in the Characters section. Include all listed characters.`;
}

export function buildJudgeUserPrompt(
  scenario: ScenarioRecord,
  characters: PromptCharacter[],
  segmentMessages: ConversationMessage[],
  segmentIndex: number,
  totalSegments: number,
  firstTurnNumber: number,
  lastTurnNumber: number,
): string {
  const parts: string[] = [];

  parts.push("## Scenario\n");
  parts.push(`stress_axes: [${scenario.stress_axes.join(", ")}]`);
  parts.push(`social_context: ${scenario.social_context}`);
  parts.push(`pressure_source: ${scenario.pressure_source}`);
  parts.push(`initial_prompt: "${scenario.initial_prompt}"\n`);

  parts.push("## Characters\n");
  for (const char of characters) {
    parts.push(`${char.name} (character_id: ${char.id}) — ${char.archetype}`);
    parts.push(`  personalityTraits: [${char.record.personalityTraits.join(", ")}]`);
    parts.push(`  values: [${char.record.values.join(", ")}]`);
    parts.push(`  fears: [${char.record.fears.join(", ")}]`);
    parts.push(`  goals: [${char.record.goals.join(", ")}]`);
    parts.push(`  copingStyle: [${char.record.copingStyle.join(", ")}]`);
    parts.push(`  speechPatterns: [${char.record.speechPatterns.join(", ")}]\n`);
  }

  parts.push(
    `## Conversation Segment ${segmentIndex} of ${totalSegments} (turns ${firstTurnNumber}–${lastTurnNumber})\n`,
  );
  for (const msg of segmentMessages) {
    parts.push(`[${msg.character_name}] (${msg.emotion}, ${msg.intensity}): ${msg.content}`);
  }
  parts.push("");

  parts.push(`## Task`);
  parts.push(
    `Score scenario_engagement for this segment, then score personality_alignment for each of: ${characters.map((c) => c.id).join(", ")}`,
  );

  return parts.join("\n");
}
```

- [ ] **Step 4: Run tests**

```bash
bun test evaluation/drift/__tests__/prompt.test.ts
```
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add evaluation/drift/prompt.ts evaluation/drift/__tests__/prompt.test.ts
git commit -m "feat(eval/drift): add prompt builders with tests"
```

---

## Task 7: Per-Conversation Loop

**Files:**
- Create: `evaluation/drift/index.ts`

- [ ] **Step 1: Implement the per-conversation loop**

```typescript
// evaluation/drift/index.ts
import OpenAI from "openai";
import { splitIntoSegments } from "./segment";
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
import type { CharacterRecord, ScenarioRecord } from "../runner/config";
import type { ConversationResult } from "../runner/conversation";

export async function runDriftForConversation(
  result: ConversationResult,
  fileName: string,
  scenario: ScenarioRecord,
  characters: CharacterRecord[],
  config: ValidatedDriftConfig,
  apiKey: string,
): Promise<ConversationDriftResult> {
  const client = new OpenAI({ baseURL: `${config.baseUrl}/v1`, apiKey });

  // Map alias → CharacterRecord for prompt building
  const aliasToRecord = new Map<string, CharacterRecord>();
  for (const convChar of result.characters) {
    const record = characters.find((c) => c.id === convChar.id);
    if (!record) throw new Error(`Character "${convChar.id}" not found in dataset (${fileName})`);
    aliasToRecord.set(convChar.name, record);
  }

  // Build prompt character list with real names
  const promptCharacters = result.characters.map((convChar) => {
    const record = aliasToRecord.get(convChar.name)!;
    return { id: convChar.id, name: record.name, archetype: record.archetype, record };
  });

  // Strip reasoning/subtext — only observable behaviour
  const messages = result.messages.map((m) => ({ ...m, reasoning: "", subtext: "" }));

  // Replace aliases with real names in transcript
  const realNameMessages = messages.map((m) => ({
    ...m,
    character_name:
      aliasToRecord.get(m.character_name)?.name ?? m.character_name,
  }));

  const segments = splitIntoSegments(realNameMessages, config.segments);
  const systemPrompt = buildJudgeSystemPrompt();
  const segmentScores: SegmentScore[] = [];
  let turnOffset = 0;

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const segMessages = segments[segIdx]!;
    const firstTurn = turnOffset + 1;
    const lastTurn = turnOffset + segMessages.length;
    turnOffset += segMessages.length;

    const userPrompt = buildJudgeUserPrompt(
      scenario,
      promptCharacters,
      segMessages,
      segIdx + 1,
      segments.length,
      firstTurn,
      lastTurn,
    );

    process.stdout.write(`  [seg ${segIdx + 1}/${segments.length}] judging…`);

    // Call all judges in parallel
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

    const successfulOutputs = judgeResults
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof callJudge>>> =>
        r.status === "fulfilled",
      )
      .map((r) => r.value);

    const failCount = judgeResults.filter((r) => r.status === "rejected").length;
    const lowConfidence = successfulOutputs.length < 2;

    if (successfulOutputs.length === 0) {
      throw new Error(
        `All judges failed for segment ${segIdx + 1} in ${fileName}`,
      );
    }

    // Vote on scenario_engagement
    const engVotes = successfulOutputs.map((o) => o.scenario_engagement as EngagementLabel);
    const engResult = majorityVoteEngagement(engVotes);

    // Vote on personality_alignment per character
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

- [ ] **Step 2: Verify typecheck**

```bash
bun run typecheck
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add evaluation/drift/index.ts
git commit -m "feat(eval/drift): add per-conversation loop"
```

---

## Task 8: Writer

**Files:**
- Create: `evaluation/drift/writer.ts`

- [ ] **Step 1: Implement writer**

```typescript
// evaluation/drift/writer.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import type { ConversationDriftResult, ScenarioDriftSummary } from "./types";

export function initDriftOutputDir(
  datasetDir: string,
  outputName: string,
  rawConfigText: string,
): string {
  const outputDir = join(datasetDir, "context_drift", outputName);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "config.yaml"), rawConfigText, "utf-8");
  return outputDir;
}

export function writeConversationResults(
  outputDir: string,
  results: ConversationDriftResult[],
): void {
  writeFileSync(join(outputDir, "conversation_results.yaml"), stringify(results), "utf-8");
}

export function writeSummary(outputDir: string, summaries: ScenarioDriftSummary[]): void {
  writeFileSync(join(outputDir, "summary.yaml"), stringify(summaries), "utf-8");
}
```

- [ ] **Step 2: Commit**

```bash
git add evaluation/drift/writer.ts
git commit -m "feat(eval/drift): add writer"
```

---

## Task 9: Pass Orchestrator + CLI Entry

**Files:**
- Create: `evaluation/drift/pass.ts`
- Create: `evaluation/context_drift.ts`
- Create: `evaluation/configs/context-drift.yaml`

- [ ] **Step 1: Implement the pass orchestrator**

```typescript
// evaluation/drift/pass.ts
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadDriftConfig } from "./config";
import { runDriftForConversation } from "./index";
import { initDriftOutputDir, writeConversationResults, writeSummary } from "./writer";
import { computeScenarioSummaries } from "./scoring";
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
        console.log(`[${i + 1}/${files.length}] ${file} — skipped (no messages)`);
        continue;
      }

      if (result.messages.length < config.segments) {
        console.log(
          `[${i + 1}/${files.length}] ${file} — skipped (${result.messages.length} turns < ${config.segments} segments)`,
        );
        continue;
      }

      const scenario = ALL_SCENARIOS.find((s) => s.id === result.scenario_id);
      if (!scenario) throw new Error(`Scenario "${result.scenario_id}" not found (${file})`);

      const characters = result.characters.map((c) => {
        const found = ALL_CHARACTERS.find((r) => r.id === c.id);
        if (!found) throw new Error(`Character "${c.id}" not found (${file})`);
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

    if (allResults.length === 0) {
      throw new Error("No conversations were successfully processed.");
    }

    writeConversationResults(outputDir, allResults);
    writeSummary(outputDir, computeScenarioSummaries(allResults));

    console.log(`\nDone. ${allResults.length} conversations processed. Results: ${outputDir}/`);
  } catch (err) {
    rmSync(outputDir, { recursive: true, force: true });
    console.error(`\nDrift pass failed — removed incomplete output: ${outputDir}`);
    throw err;
  }
}
```

- [ ] **Step 2: Create the CLI entry point**

```typescript
// evaluation/context_drift.ts
import { runDriftPass } from "./drift/pass";

const configPath = process.argv[2];
if (!configPath) {
  console.error("Usage: bun evaluation/context_drift.ts <config.yaml>");
  process.exit(1);
}

await runDriftPass(configPath);
```

- [ ] **Step 3: Create the example config**

```yaml
# Context Drift Evaluation — Example Config
# Run: bun evaluation/context_drift.ts evaluation/configs/context-drift.yaml
# Required env: LLM_API_KEY
#
# segments: number of equal time windows to split each conversation into.
# Must be ≥ 2. Each segment boundary produces one drift delta.
# Example: segments: 3 → early / mid / late windows → 2 deltas.

dataset_dir: "dataset-001"
output_name: "drift-run-001"
base_url: "https://openrouter.ai/api"
segments: 3

judges:
  - model: "mistralai/mistral-nemo"
  - model: "mistralai/mistral-nemo"
  - model: "google/gemma-2-9b-it"
```

Save to: `evaluation/configs/context-drift.yaml`

- [ ] **Step 4: Verify typecheck and all tests pass**

```bash
bun run typecheck
bun test evaluation/drift/
```
Expected: typecheck clean; all tests pass

- [ ] **Step 5: Commit**

```bash
git add evaluation/drift/pass.ts evaluation/context_drift.ts evaluation/configs/context-drift.yaml
git commit -m "feat(eval/drift): add pass orchestrator, CLI entry, and example config"
```

---

## Task 10: Final Verification

- [ ] **Step 1: Run full typecheck**

```bash
bun run typecheck
```
Expected: exit 0, no errors

- [ ] **Step 2: Run all evaluation tests**

```bash
bun test evaluation/
```
Expected: all tests pass (segment, scoring, config, prompt)

- [ ] **Step 3: Run mcp_server tests to check nothing regressed**

```bash
bun run --cwd mcp_server test
```
Expected: 37 pass, 0 fail

- [ ] **Step 4: Verify the new files are tracked**

```bash
git status
```
Expected: clean working tree (all files committed)

- [ ] **Step 5: Final commit if any loose files**

If any files remain unstaged:
```bash
git add -A
git commit -m "chore(eval/drift): final cleanup"
```
