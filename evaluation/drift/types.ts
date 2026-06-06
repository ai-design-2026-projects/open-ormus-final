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

export type DriftJudgeConfig = {
  label: string;
  model: string;
};

export type ValidatedDriftConfig = {
  evalDir: string;
  baseUrl: string;
  segments: number;
  judges: DriftJudgeConfig[];
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
