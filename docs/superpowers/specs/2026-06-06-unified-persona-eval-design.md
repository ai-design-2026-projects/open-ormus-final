# Unified Persona Evaluation — Design Spec

**Date:** 2026-06-06
**Branch:** worktree-feature-eval-persona-drift
**Status:** Approved for implementation

---

## Problem

`evaluation/reconstruct/` and `evaluation/drift/` measure the same thing via the same inner
loop (callReconstructor → callComparator → buildItemScores → computeFieldScore). The only
difference is that drift wraps that loop in a segment iteration. The duplication is real:
`getGtItems` is copy-pasted, `pass.ts` is line-for-line identical, `config.ts` differs by
one field, and `drift/` imports most of its logic from `reconstruct/` anyway.

The direction of dependency already points to `reconstruct/` as the canonical module.
`segments: 1` (full transcript) is a degenerate case of `segments: N`.

---

## Goal

Merge `evaluation/drift/` into `evaluation/reconstruct/`. One module, one CLI, one output
schema. `segments` becomes an optional config field (default 1). Existing configs for both
passes work without modification.

---

## Non-goals

- No changes to `evaluation/judge/`, `evaluation/runner/`, or `packages/shared/`.
- No UI changes.
- No migration of existing result files on disk.

---

## Module structure

### Deleted

```
evaluation/drift/                  — entire directory
evaluation/drift_persona.ts
```

### Added to `evaluation/reconstruct/`

```
segmenter.ts                       — moved from drift/segmenter.ts (current state, no further changes)
__tests__/segmenter.test.ts        — moved from drift/__tests__/segmenter.test.ts (current state)
```

### Modified in `evaluation/reconstruct/`

| File | Change |
|------|--------|
| `types.ts` | Add `SegmentResult`, `FieldDriftScore`; replace `CharacterResult` with unified shape; add `segment_count` to `ConversationReconstructionResult`; add `segments` to `ValidatedReconstructConfig`; remove `CharacterScore` |
| `config.ts` | Add optional `segments` field (int ≥ 1, no upper bound, default 1) |
| `index.ts` | Wrap inner loop in segment loop; add slope + IC computation; remove `computeCharacterScore` call; hard-error on thin conversations |
| `scoring.ts` | Absorb `computeSlope`, `computeFieldDriftScore` from drift; unify `computeSummary` |
| `writer.ts` | Switch to per-conversation files in `conversations/` subdir |
| `pass.ts` | Update types only |

### CLI

`reconstruct_persona.ts` — unchanged. `drift_persona.ts` — deleted.

---

## Config

One new optional field added to the existing YAML shape:

```yaml
segments: 3    # optional; integer ≥ 1; default 1
               # omitting it = full-transcript mode (current reconstruct behaviour)
```

Validation:
- `segments` must be a positive integer (min 1, no upper bound).
- Per-conversation hard error (not a warning): if `messages.length < segments * 2`,
  the pass fails on that conversation with a clear error message.

Existing reconstruct configs (no `segments` field) and existing drift configs
(`segments: 2` or `segments: 3`) both work without modification.

---

## Output types

### `CharacterResult` (unified, replaces both shapes)

```typescript
type CharacterResult = {
  alias: string;
  real_name: string;
  difficulty_tier: string;
  segments: SegmentResult[];                            // length 1 when segments=1
  field_drift: Record<ProfileField, FieldDriftScore>;  // slopes null when segments=1
  mean_gt_divergence_slope: number | null;             // null when segments=1
  mean_internal_consistency_f1: number | null;         // null when segments=1
  // character_score removed — use segments[*].field_scores for raw data
};
```

### `ConversationReconstructionResult`

```typescript
type ConversationReconstructionResult = {
  conversation_file: string;
  scenario_id: string;
  scenario_title: string;          // kept from reconstruct (was absent in drift)
  scenario_difficulty: string;
  scenario_stress_axes: string[];  // kept from reconstruct (was absent in drift)
  segment_count: number;           // new
  characters: CharacterResult[];
};
```

`SegmentResult` and `FieldDriftScore` move from `drift/types.ts` into `reconstruct/types.ts`
unchanged.

`CharacterScore` is removed. Nothing computes or consumes it after the merge.

---

## Summary

```typescript
type ReconstructionSummary = {
  total_conversations: number;
  total_characters_evaluated: number;
  segment_count: number;
  comparator_models: string[];
  mean_inter_comparator_agreement: number;
  field_aggregates: Record<ProfileField, {
    mean_f1: number | null;                     // avg across all character×segment observations
    mean_gt_divergence_slope: number | null;    // null when segments=1
    mean_internal_consistency_f1: number | null;
    drifting_fraction: number;                  // 0 when segments=1
  }>;
  by_difficulty: Record<string, {
    count: number;
    mean_gt_divergence_slope: number | null;
    mean_internal_consistency_f1: number | null;
  }>;
  by_tier: Record<string, {
    count: number;
    mean_gt_divergence_slope: number | null;
    mean_internal_consistency_f1: number | null;
  }>;
  most_drifting: Array<{                        // empty list when segments=1
    conversation_file: string;
    alias: string;
    real_name: string;
    mean_gt_divergence_slope: number;
    mean_internal_consistency_f1: number | null;
  }>;
};
```

`mean_f1` in `field_aggregates` when segments>1: averaged across all character×segment
observations for that field (flattened across all conversations and segments). This replaces
the old per-character aggregate from `reconstruct`.

---

## Output directory structure

```
evaluation/results/<dataset_dir>/reconstruct_persona/<output_name>/
  config.yaml
  summary.yaml
  conversations/
    001.yaml
    002.yaml
    ...
```

Per-conversation files (drift layout) replace the old single `reconstruction_result.yaml`.

---

## Thin-conversation error

Replaces `warnIfThin`. In `index.ts`, before segmenting:

```typescript
if (strippedMessages.length < config.segments * 2) {
  throw new Error(
    `${fileName}: not enough messages for ${config.segments} segments ` +
    `(${strippedMessages.length} messages, need at least ${config.segments * 2})`
  );
}
```

The error propagates to `pass.ts` which cleans up the output dir and re-throws,
aborting the entire run. A thin conversation is a config/dataset mismatch — it
should be fixed, not silently skipped.

---

## Tests

### Moved unchanged
- `drift/__tests__/segmenter.test.ts` → `reconstruct/__tests__/segmenter.test.ts`

### Deleted from `reconstruct/__tests__/scoring.test.ts`
- `computeCharacterScore` describe block — function is removed

### Merged into `reconstruct/__tests__/scoring.test.ts`
- All slope and `computeFieldDriftScore` tests from `drift/__tests__/scoring.test.ts`
- New: `computeSummary` with segments=1 — verify `gt_divergence_slope=null`,
  `internal_consistency=null`, `drifting_fraction=0`, `most_drifting=[]`
- New: `computeSummary` with segments=3 — verify slopes populated

### Updated
- `reconstruct/__tests__/` existing tests updated for new `CharacterResult` shape:
  no `character_score`, has `segments[]` and `field_drift`

### New
- Hard-error test: conversation with `messages.length < segments * 2` throws with a
  clear message identifying the file and the counts
