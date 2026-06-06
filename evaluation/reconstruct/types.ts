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
  score: z.enum(["match", "no_match", "contradiction"]),
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
