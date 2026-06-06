# Persona Drift Evaluation — Design Spec

**Date:** 2026-06-05
**Branch:** worktree-feature-eval-persona-drift
**Status:** Approved for implementation

---

## Problem

The existing persona reconstruction evaluation (`evaluation/reconstruct/`) treats each
conversation as a flat bag of evidence. The reconstructor receives the full transcript and
aggregates traits across all turns. This masks drift: if a character is principled in turns
1–6 but compliant in turns 7–12, the full-pass reconstructor picks up "principled" from the
early turns and reports it as a trait — hiding the behavioural change entirely.

Drift detection requires isolated segments: the reconstructor must receive *only* the turns
in a given time window, not the full context.

---

## Goal

Add a drift evaluation pass that captures:

1. **GT-divergence trend** — how a character's fidelity to their ground-truth profile changes
   across the conversation (does it fall, hold, or recover?).
2. **Internal consistency** — how much the character's end-of-conversation behaviour matches
   their beginning, independent of the ground truth.

---

## Non-goals

- No new LLM prompts. The drift pass reuses the existing reconstructor and comparator verbatim.
- No changes to the existing `reconstruct/` pass or its output format.
- No UI changes.

---

## Module layout

New module `evaluation/drift/`, parallel to `evaluation/reconstruct/`.
Shared call and prompt logic is imported from `reconstruct/` — not duplicated.

```
evaluation/
  drift/
    types.ts          — drift-specific output types
    config.ts         — config loading (reconstruct config + segments param)
    segmenter.ts      — splits conversation messages into N isolated windows
    scoring.ts        — slope computation, internal consistency scoring
    index.ts          — per-conversation orchestration
    pass.ts           — top-level pass runner
    writer.ts         — output YAML writer
    __tests__/
      segmenter.test.ts
      scoring.test.ts
  drift_persona.ts    — CLI entry point
```

Reused from `evaluation/reconstruct/` without modification:
- `call.ts` — `callReconstructor`, `callComparator`
- `prompt.ts` — all four prompt builders
- `scoring.ts` — `buildItemScores`, `computeFieldScore`
- `types.ts` — `FieldScore`, `ReconstructorOutput`, `ItemScore`

Reused from `evaluation/judge/`:
- `alias.ts` — `reconstructAliasMap`

---

## Config

One new field added to the existing YAML config shape: `segments`.

```yaml
dataset_dir: run_001
output_name: drift_v1
base_url: http://localhost:11434
reconstructor:
  model: llama3-70b
comparators:
  - model: llama3-70b
segments: 3           # min 2, max 6, default 3
fields:
  - personalityTraits
  - speechPatterns
  - values
  - fears
  - goals
  - copingStyle
```

Validation rules (in `config.ts`):
- `segments` must be an integer between 2 and 6 inclusive.
- If `total_messages_in_conversation < segments * 2`, emit a per-conversation warning to
  stdout but do not abort. Mark thin segments in output via `message_count`.

---

## Segmentation

`segmenter.ts` splits `ConversationMessage[]` (all characters, all turns) into N equal slices
by total message count.

- Slice size: `Math.floor(messages.length / N)` messages per segment.
- Last segment absorbs any remainder.
- Each segment contains all speakers for that time window — conversational context matters
  for reconstruction. The reconstructor is still asked to analyse only the target alias,
  exactly as in the existing pass.
- Each segment records `turn_range: [first_turn, last_turn]` (inclusive, 1-based) for
  traceability in the output.

---

## Per-segment reconstruction

For every character × segment:

1. Call the reconstructor with only that segment's messages. Same system prompt and user
   message builder as the existing pass (`buildReconstructorUserMessage`).
2. For each observed field, call the comparator against ground truth. Same prompt
   (`buildComparatorUserMessage`), same `buildItemScores` → `computeFieldScore` pipeline.
3. Record the resulting `FieldScore` per field.

This produces `SegmentResult[]` per character — the raw time series of GT-fidelity scores.

---

## Drift metrics

### 1. GT-divergence slope (per field)

- Collect the F1 scores from segments where the field was observed (`not_observed = false`).
- If fewer than 2 segments were observed for this field: `gt_divergence_slope = null`.
  A single data point cannot define a trend.
- If 2 or more observed segments: fit a line using ordinary least squares.
  - x = segment index (0-based, only observed segments)
  - y = F1 score for that segment
  - `gt_divergence_slope` = the fitted slope coefficient.
- **Negative slope** → fidelity to GT is falling as the conversation progresses (drift).
- **Positive slope** → fidelity is recovering, or early segments lacked sufficient evidence.
- `mean_gt_divergence_slope` per character = average slope across all fields with non-null
  slopes. Null if no field had sufficient observed segments.

### 2. Internal consistency (per field)

- Take the reconstructed items from `segments[0]` and `segments[N-1]` for this field.
- If either endpoint is `not_observed`: `internal_consistency = null`.
  Absence of evidence is not zero consistency — the distinction must be preserved.
- Otherwise: run the comparator treating `segments[0]` items as ground truth and
  `segments[N-1]` items as the reconstructed set. This reuses `buildComparatorUserMessage`
  and `computeFieldScore` unchanged.
- The resulting `FieldScore` expresses:
  - **High F1** → character behaved consistently with themselves across the conversation.
  - **Low F1 + high `contradicted`** → character reversed their behaviour.
  - **Low F1 + low `contradicted`** → character's late behaviour diverged without
    explicit contradiction (different topic, different register).
- `mean_internal_consistency_f1` per character = average F1 across fields with non-null
  internal consistency. Null if no field had both endpoints observed.

**Critical invariant throughout:** `null` = no signal (insufficient evidence).
`0` = measured and bad. Any aggregation or display layer must preserve this distinction.

---

## Output types

```typescript
// One result per conversation file processed
type ConversationDriftResult = {
  conversation_file: string;       // e.g. "conv_001.yaml" — for traceability
  scenario_id: string;
  scenario_difficulty: string;     // for grouping in summary
  segment_count: number;           // N used in this run

  characters: CharacterDriftResult[];
};

// One result per character in the conversation
type CharacterDriftResult = {
  alias: string;                   // name used in the transcript
  real_name: string;               // resolved from alias map
  difficulty_tier: string;         // tier-1 archetype / tier-2 pair

  // Raw time series — one entry per segment, in chronological order
  // Primary evidence; all derived metrics below come from this
  segments: SegmentResult[];

  // Derived per-field metrics
  field_drift: Record<ProfileField, FieldDriftScore>;

  // Aggregated across all fields with sufficient signal
  // null when no field had enough observed segments to compute a slope
  mean_gt_divergence_slope: number | null;

  // null when no field had both endpoints observed
  mean_internal_consistency_f1: number | null;
};

// Atomic unit — one segment × one character
type SegmentResult = {
  segment_index: number;           // 0-based; segment 0 is earliest
  turn_range: [number, number];    // [first_turn, last_turn], 1-based, inclusive
  message_count: number;           // total messages in segment (all characters)

  // Per-field scores vs ground truth for this segment only
  // Same FieldScore shape as the existing reconstruction pass
  field_scores: Record<ProfileField, FieldScore>;
};

// Drift metrics for a single field across the segment time series
type FieldDriftScore = {
  // F1 vs GT for each segment in order
  // null at a given index means field was not_observed in that segment
  segment_f1s: Array<number | null>;

  // Indices of segments where the field was observed (not_observed = false)
  observed_segments: number[];

  // Linear regression slope over observed-segment F1s
  // Negative = drifting from GT; positive = recovering or evidence accumulating
  // null when fewer than 2 segments were observed
  gt_divergence_slope: number | null;

  // Comparator score of seg[N-1] items vs seg[0] items (seg[0] treated as GT)
  // High F1 = consistent; low F1 + high contradicted = behavioural reversal
  // null when either endpoint was not_observed
  internal_consistency: FieldScore | null;
};
```

---

## Summary output

Aggregated over all conversations and characters. Written alongside per-conversation files.

```typescript
type DriftSummary = {
  total_conversations: number;
  total_characters_evaluated: number;
  segment_count: number;
  comparator_models: string[];

  // Per-field aggregates across all characters with non-null values
  field_aggregates: Record<ProfileField, {
    mean_gt_divergence_slope: number | null;
    mean_internal_consistency_f1: number | null;
    // Fraction of characters with non-null slope where slope was negative (actively drifting)
    // Denominator = characters with non-null slope for this field, not all characters
    drifting_fraction: number;
  }>;

  // Grouped by scenario difficulty
  by_difficulty: Record<string, {
    count: number;
    mean_gt_divergence_slope: number | null;
    mean_internal_consistency_f1: number | null;
  }>;

  // Grouped by character tier
  by_tier: Record<string, {
    count: number;
    mean_gt_divergence_slope: number | null;
    mean_internal_consistency_f1: number | null;
  }>;

  // Top drifting characters — sorted by most negative mean_gt_divergence_slope
  // Only includes characters with non-null mean_gt_divergence_slope
  most_drifting: Array<{
    conversation_file: string;
    alias: string;
    real_name: string;
    mean_gt_divergence_slope: number;   // never null in this list
    mean_internal_consistency_f1: number | null;
  }>;
};
```

---

## Output directory structure

Mirrors `reconstruct/` output layout:

```
evaluation/results/<dataset_dir>/drift_persona/<output_name>/
  config.yaml                    — copy of the config used for this run
  summary.yaml                   — DriftSummary
  conversations/
    conv_001.yaml                — ConversationDriftResult
    conv_002.yaml
    ...
```

---

## Edge cases

| Situation | Behaviour |
|-----------|-----------|
| Conversation has fewer messages than `segments * 2` | Warn to stdout; proceed; thin segments visible via `message_count` |
| Field not_observed in all segments | `gt_divergence_slope = null`, `internal_consistency = null` — excluded from means |
| Field observed in exactly 1 segment | `gt_divergence_slope = null`; internal consistency still computed if both endpoints observed |
| Only 2 segments configured | Slope reduces to `F1(seg[1]) - F1(seg[0])` (exact two-point difference); this is valid |
| Conversation already failed (no messages) | Skip, same as existing reconstruct pass |

---

## Testing

`segmenter.test.ts`:
- N=2: verifies equal split, last segment absorbs remainder
- N=3: verifies turn ranges are non-overlapping and cover all messages
- N=6 on a 5-message conversation: verifies warning condition is detectable

`scoring.test.ts`:
- Slope with all observed segments: verifies OLS result
- Slope with some null segments: verifies nulls are excluded from x/y before fitting
- Slope with 1 observed segment: returns null
- Internal consistency with both endpoints observed: returns FieldScore
- Internal consistency with one endpoint null: returns null
- `null` vs `0` distinction preserved in all aggregations
