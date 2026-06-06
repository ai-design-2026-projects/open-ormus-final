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

type ComparatorItemOutput = { reconstructed_item: string; score: string; justification: string };
type ComparatorOutput = { model: string; scores: ComparatorItemOutput[] };

function labelToScore(label: string): 1 | 0 | -1 {
  if (label === "match") return 1;
  if (label === "contradiction") return -1;
  return 0;
}

export function buildItemScores(
  reconstructedItems: string[],
  comparatorOutputs: ComparatorOutput[],
): ItemScore[] {
  return reconstructedItems.map((item, idx) => {
    const comparatorScores = comparatorOutputs.map((c) => {
      const score = labelToScore(c.scores[idx]?.score ?? "no_match");
      return { model: c.model, score };
    });
    const allScores = comparatorScores.map((c) => c.score);
    const score = majorityVote(allScores);
    const justification =
      comparatorOutputs.find((c) => labelToScore(c.scores[idx]?.score ?? "no_match") === score)
        ?.scores[idx]?.justification ?? "";

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
