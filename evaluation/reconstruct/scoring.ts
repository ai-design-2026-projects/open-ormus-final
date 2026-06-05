import { PROFILE_FIELDS } from "./types";
import type {
  ProfileField,
  ItemScore,
  FieldScore,
  CharacterScore,
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
  };
}
