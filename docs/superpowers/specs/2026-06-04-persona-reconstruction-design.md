# Persona Reconstruction Evaluation Pass

**Date:** 2026-06-04
**Status:** Approved

---

## Context

The evaluation pipeline has two completed steps:

1. **Runner** (`evaluation/run.ts`) — generates conversation YAMLs from 16 characters × 32 scenarios using the production `generateTurn()` function.
2. **Judge/Guessing** (`evaluation/judge_guessing.ts`) — LLM judges read transcripts (aliases only) and guess which alias maps to which character. Tests whether characters are *distinguishable*.

This spec defines the third step: **Persona Reconstruction**. Given a conversation transcript, one or more "reconstructor" LLMs infer the character's personality profile. A multi-model "comparator" panel then scores each reconstructed item against the ground-truth profile.

**What this measures:** how much personality signal survives the full pipeline — `profile → generation → behaviour → reconstruction`. This is a test of the architecture's end-to-end fidelity, not a standalone capability test.

---

## What This Does NOT Measure

- Whether the character profile is accurate or well-written (the GT is treated as authoritative).
- Whether the LLM can recall the profile from memory (reconstruction is blind — no GT shown).
- Individual model capability in isolation (the score reflects the combined quality of generation model + prompt format + profile richness).

---

## Primary Metric: Contradiction Rate

The most diagnostically important signal is not how much of the profile was recovered, but how much of the reconstructed behaviour **actively contradicts** the profile. Low recall can mean the scenario didn't activate a trait — that's expected. Active contradiction means the model made the character behave in ways incompatible with who they are.

Secondary metrics (precision, recall, F1 per field) provide diagnostic detail about which failure mode is occurring.

---

## Fields in Scope

Six behavioural fields — the ones observable in conversation:

| Field | Rationale |
|---|---|
| `personalityTraits` | Directly manifests in how characters respond |
| `speechPatterns` | Observable in every message |
| `values` | Revealed by choices under pressure |
| `fears` | Surface when scenarios create relevant threat |
| `goals` | Revealed by what characters pursue or resist |
| `copingStyle` | Visible under stress scenarios |

Excluded fields:
- `notableQuotes` — verbatim quotes may appear because the generation model was given them; scoring them would measure prompt leakage, not fidelity.
- `abilities`, `backstory`, `relationships`, `knowledgeScope` — not reliably observable in 4–6 turn conversations.

---

## Two-Phase Pipeline

### Phase 1: Reconstruction

The reconstructor LLM receives:
- Scenario `title` + `context` (not `initial_prompt` — to avoid anchoring on the opening trigger)
- Conversation transcript containing only `character_name` (alias), `emotion`, `intensity`, `content` — `reasoning` and `subtext` are stripped (they are internally-generated states, not observable behaviour)
- The alias of the character to reconstruct
- The names and one-line definitions of the 6 fields

Output: structured JSON. For each field, either an array of reconstructed items or `not_observed: true` if the transcript contains no sufficient evidence. The model is instructed not to hallucinate items not grounded in the transcript.

One reconstructor call per character per conversation.

### Phase 2: Comparison

The comparator panel receives the GT items for a field and the reconstructed items for that field, plus the field definition. For each reconstructed item it returns a score and mandatory justification:

- `1` — semantic match (paraphrase counts; the comparator is explicitly instructed to treat paraphrase as correct)
- `0` — no match
- `-1` — active contradiction

The config accepts multiple comparator models. Results use **majority vote**. `inter_comparator_agreement` (fraction of items where all comparators agree) is reported in the summary — values below 0.75 indicate the results should be interpreted with caution.

One comparator call per `(character, field)` pair where `not_observed = false`.

---

## Pair Differentiation Analysis

The dataset contains 4 similar pairs — characters identical on all fields except one `varyingAxis`. These are the most controlled test in the evaluation: all confounds are equal, only one variable differs.

For conversations that include a similar pair (identifiable via `CharacterRecord.similarTo`), the comparator runs in 4 directions on the `varyingAxis` field:

```
A_on_A: reconstruction of A  →  GT of A on varyingAxis   (should be high)
B_on_B: reconstruction of B  →  GT of B on varyingAxis   (should be high)
A_on_B: reconstruction of A  →  GT of B on varyingAxis   (should be low)
B_on_A: reconstruction of B  →  GT of A on varyingAxis   (should be low)
```

A pair is **differentiated** when (default threshold = 0.5):

```
(A_on_A > 0.5 AND B_on_B > 0.5)
AND (A_on_B < 0.5 AND B_on_A < 0.5)
```

The threshold is not configurable in v1 — 0.5 is the natural midpoint of the recall scale and avoids introducing an additional free parameter.

This catches four failure modes:
1. **Generic profiles** — both reconstructions are too vague to match either GT (low diagonal)
2. **Model collapse** — both reconstructions match only one character's GT (asymmetric diagonal)
3. **Cross-contamination** — each reconstruction correctly captures its own GT but also matches the other's (high diagonal AND high cross)
4. **Correct differentiation** — high diagonal, low cross

No extra LLM call is needed. The 4 directions are additional comparator calls on the same `varyingAxis` field, reusing the exact same comparator infrastructure.

**Scenario constraint:** pair differentiation is only meaningful when both pair members ran on the same `scenario_id`. The config loader does not enforce this (pair members may be in separate conversations), but the summary reports `scenario_activates_axis: bool` to indicate whether the scenario's `stress_axes` align with the `varyingAxis`. Results where this is false should be interpreted as "axis not activated", not as system failure.

---

## Architecture

Mirrors the judge system file-for-file:

```
evaluation/
  reconstruct_persona.ts              # entry point
  reconstruct/
    config.ts                         # loadReconstructConfig(), ValidatedReconstructConfig
    prompt.ts                         # buildReconstructorPrompt(), buildComparatorPrompt()
    schema.ts                         # JSON schemas for OpenAI structured output
    types.ts                          # Zod schemas + TypeScript types
    call.ts                           # callReconstructor(), callComparator() — MAX_RETRIES=3
    scoring.ts                        # computeFieldScore(), computeCharacterScore(), computePairDiff()
    pass.ts                           # runReconstructionPass()
    writer.ts                         # initOutputDir(), writeResults(), writeSummary()
    __tests__/
      config.test.ts
      scoring.test.ts
```

Output path: `evaluation/results/{dataset_dir}/reconstruct_persona/{output_name}/`

Existing code reused verbatim:
- `judge/alias.ts` → `reconstructAliasMap()`
- `judge/call.ts` → retry pattern, error logging, structured output via `response_format`
- `judge/pass.ts` → file iteration loop, `try/catch → rmSync` cleanup on failure
- `runner/config.ts` → `CharacterRecord`, `ScenarioRecord` types

---

## Config YAML

```yaml
# Run: bun evaluation/reconstruct_persona.ts evaluation/configs/reconstruct-persona.yaml
# Required env: LLM_API_KEY

dataset_dir: "dataset-001"
output_name: "reconstruct-run-001"
base_url: "https://openrouter.ai/api"

reconstructor:
  model: "mistralai/mistral-nemo"

comparators:                    # 2–3 models; majority vote; agreement reported
  - model: "mistralai/mistral-nemo"
  - model: "google/gemma-2-9b-it"

fields:                         # optional — defaults to all 6 behavioural fields
  - personalityTraits
  - speechPatterns
  - values
  - fears
  - goals
  - copingStyle
```

Config validation (mirrors `loadJudgeConfig`):
- `dataset_dir` exists with a `conversations/` subdirectory
- `reconstruct_persona/{output_name}` does not already exist (no overwrite)
- `LLM_API_KEY` is set
- At least 1 comparator model

---

## Key Types

```typescript
type ProfileField = "personalityTraits" | "speechPatterns" | "values" | "fears" | "goals" | "copingStyle"

type ReconstructedField =
  | { not_observed: true }
  | { not_observed: false; items: string[] }

type ReconstructedProfile = Record<ProfileField, ReconstructedField>

type ItemScore = {
  reconstructed_item: string
  score: 1 | 0 | -1
  justification: string
  comparator_scores: Array<{ model: string; score: 1 | 0 | -1 }>
}

type FieldScore = {
  not_observed: boolean
  observed_count: number
  gt_count: number
  matched: number
  contradicted: number
  precision: number
  recall: number
  f1: number
  comparator_agreement: number
  item_scores: ItemScore[]
}

type CharacterResult = {
  alias: string
  real_name: string
  difficulty_tier: string
  varying_axis: string | null
  field_scores: Record<ProfileField, FieldScore>
  character_score: {
    mean_f1: number
    mean_precision: number
    mean_recall: number
    contradiction_count: number
    fields_not_observed: ProfileField[]
  }
}

type PairDifferentiationResult = {
  pair_ids: [string, string]
  varying_axis: string
  scenario_activates_axis: boolean
  A_on_A: number
  B_on_B: number
  A_on_B: number
  B_on_A: number
  differentiated: boolean
}
```

---

## Output Files

### `reconstruction_result.yaml`

Array of per-conversation results:

```yaml
- conversation_file: "001.yaml"
  scenario_id: "scenario_020"
  scenario_title: "The Policy You Must Sign"
  scenario_difficulty: "high"
  scenario_stress_axes: ["power consolidation vs fairness", "obedience vs conscience"]
  characters:
    - alias: "Alex"
      real_name: "Corrith Velan"
      difficulty_tier: "similar_pair"
      varying_axis: "speechPatterns"
      field_scores:
        speechPatterns:
          not_observed: false
          observed_count: 3
          gt_count: 3
          matched: 2
          contradicted: 0
          precision: 0.67
          recall: 0.67
          f1: 0.67
          comparator_agreement: 1.0
        fears:
          not_observed: true
      character_score:
        mean_f1: 0.64
        mean_precision: 0.72
        mean_recall: 0.58
        contradiction_count: 0
        fields_not_observed: ["fears"]
  pair_differentiation:
    pair_ids: ["char_009", "char_010"]
    varying_axis: "speechPatterns"
    scenario_activates_axis: true
    A_on_A: 0.67
    B_on_B: 0.80
    A_on_B: 0.10
    B_on_A: 0.15
    differentiated: true
```

### `summary.yaml`

```yaml
total_conversations: 7
total_characters_evaluated: 14
comparator_models: ["mistralai/mistral-nemo", "google/gemma-2-9b-it"]
mean_inter_comparator_agreement: 0.84

field_aggregates:
  personalityTraits: { mean_f1: 0.61, mean_precision: 0.74, mean_recall: 0.52, mean_contradicted: 0.08 }
  speechPatterns:    { mean_f1: 0.73, mean_precision: 0.81, mean_recall: 0.66, mean_contradicted: 0.03 }
  values:            { mean_f1: 0.68, mean_precision: 0.76, mean_recall: 0.61, mean_contradicted: 0.05 }
  fears:             { mean_f1: 0.44, mean_precision: 0.70, mean_recall: 0.32, mean_contradicted: 0.02 }
  goals:             { mean_f1: 0.59, mean_precision: 0.75, mean_recall: 0.49, mean_contradicted: 0.04 }
  copingStyle:       { mean_f1: 0.51, mean_precision: 0.68, mean_recall: 0.40, mean_contradicted: 0.06 }

by_difficulty:
  baseline:  { count: 4, mean_f1: 0.71, mean_contradiction_rate: 0.02 }
  moderate:  { count: 6, mean_f1: 0.60, mean_contradiction_rate: 0.05 }
  high:      { count: 4, mean_f1: 0.52, mean_contradiction_rate: 0.09 }

by_tier:
  distinctive:  { count: 8, mean_f1: 0.68, mean_contradiction_rate: 0.04 }
  similar_pair: { count: 6, mean_f1: 0.55, mean_contradiction_rate: 0.07 }

pair_differentiation:
  total_pairs_evaluated: 3
  pairs_differentiated: 2
  accuracy: 0.667
  by_pair:
    - pair_ids: ["char_009", "char_010"]
      varying_axis: "speechPatterns"
      differentiated: true
    - pair_ids: ["char_011", "char_012"]
      varying_axis: "copingStyle"
      differentiated: false
    - pair_ids: ["char_013", "char_014"]
      varying_axis: "fears"
      differentiated: true
```

---

## Diagnostic Reading of Metrics

| Signal | Likely cause |
|---|---|
| High `contradiction_rate` on a field | System prompt doesn't sufficiently constrain the model on that trait |
| Low `recall` + high `not_observed` rate | Scenario didn't activate the trait — expected, not a failure |
| Low `precision` | Reconstructor hallucinates traits not grounded in the transcript |
| Large gap `baseline` → `high` difficulty | Model loses coherence under scenario pressure |
| Large gap `distinctive` → `similar_pair` | Model collapses subtle personality distinctions |
| Low `pair_differentiation_accuracy` | Model doesn't preserve the varying axis between pair members |
| `inter_comparator_agreement` < 0.75 | Comparator judgments are unstable on this field type; results should be interpreted with caution |

---

## Verification

```bash
# Type check
bun run typecheck

# Unit tests
bun test --cwd evaluation

# End-to-end (requires LLM_API_KEY and completed runner output)
bun evaluation/reconstruct_persona.ts evaluation/configs/reconstruct-persona.yaml

# Check outputs
ls evaluation/results/<dataset_dir>/reconstruct_persona/<output_name>/
# Expected: config.yaml, reconstruction_result.yaml, summary.yaml

# Verify pair differentiation appears for pair-containing conversations
grep "pair_differentiation" evaluation/results/.../reconstruction_result.yaml
```
