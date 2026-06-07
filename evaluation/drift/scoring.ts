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
import { DRIFT_THRESHOLD_DEGRADING, DRIFT_THRESHOLD_IMPROVING } from "../shared/constants";

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
  if (totalDrift < DRIFT_THRESHOLD_DEGRADING) return "degrading";
  if (totalDrift > DRIFT_THRESHOLD_IMPROVING) return "improving";
  return "stable";
}

export function computeDriftDeltas(segments: SegmentScore[]): {
  scenarioDrift: ScenarioEngagementDrift;
  charDrifts: CharacterDrift[];
} {
  if (segments.length === 0) throw new Error("computeDriftDeltas: segments array must not be empty");
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
    const uniformSegments = convs.every(c => c.segments.length === totalSegments);
    if (!uniformSegments) {
      throw new Error(
        `computeScenarioSummaries: all conversations in scenario "${scenarioId}" must have the same number of segments`,
      );
    }
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
