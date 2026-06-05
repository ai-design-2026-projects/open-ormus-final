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
  field_scores: Record<ProfileField, FieldScore>;
  character_score: CharacterScore;
};

export type ConversationReconstructionResult = {
  conversation_file: string;
  scenario_id: string;
  scenario_title: string;
  scenario_difficulty: string;
  scenario_stress_axes: string[];
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
  rawConfigText: string;
};
