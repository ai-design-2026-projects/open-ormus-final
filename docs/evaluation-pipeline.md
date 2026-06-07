# Evaluation Pipeline

## Overview

The evaluation measures whether an LLM playing fictional characters actually behaves like them. It runs three independent passes against pre-generated conversation datasets.

**Entry points:**
```bash
bun evaluation/generate_dataset.ts <config.yaml>   # generate conversations first
bun evaluation/run_pipeline.ts <dataset-name>       # run all three passes in parallel
```

Results land in `$EVAL_RESULTS_PATH/<dataset>/<eval-XX>/`.

---

## Phase 0 — Dataset Generation

`generate_dataset.ts` reads `evaluation/configs/generate-dataset.yaml`, which defines runs across scenario/character pairings. For each run, it calls the LLM once per character turn using:

- **System prompt:** `packages/shared/conversation/prompts/character-roleplay.hbs`
- **Context:** full running conversation history

Characters appear under **aliases** throughout — real names are never in the transcript. This alias masking is essential for the Judge Guessing pass to work.

Each completed conversation is saved to `<dataset>/conversations/NNN.yaml` as a list of messages:
```
turn, character_id, character_name (alias), emotion, intensity, subtext, content
```

---

## Phase 1 — Run Pipeline

`run_pipeline.ts` fires all three passes via `Promise.allSettled()`. They share the same conversation files but make independent LLM calls and write to separate output directories. All three run concurrently.

---

## Pass 1 — Judge Guessing (`evaluation/judge/`)

**Question:** Given only aliases, can a judge LLM correctly match each alias to its real character?

### Input
- All conversation YAMLs (alias-masked transcripts)
- `evaluation/dataset/characters.yaml` — character profiles

### Steps per conversation

1. Extract the aliases used in the conversation
2. Shuffle character profiles **deterministically** (seeded by scenario ID — prevents position bias, ensures reproducibility)
3. For each of up to 3 judge models:
   - Render `judge/prompts/system.hbs` — behavioral matching instructions with a 3-tier evidence hierarchy: exact language → speech signature → value in action
   - Render `judge/prompts/user.hbs` — scenario context, full transcript, shuffled profiles, real names list, aliases to assign
   - Call LLM → parse JSON → validate against `JudgeOutputSchema` (Zod)
   - Mark each `alias → real_name` assignment correct or incorrect

### Output
`eval-XX/judge_guessing/guessing_result.yaml` — per-scenario array with each judge's assignments and an `all_correct` boolean.

---

## Pass 2 — Reconstruct Persona (`evaluation/reconstruct/`)

**Question:** Can a reconstructor LLM infer a character's profile from what they say in a segment? Does fidelity degrade across segments?

### Input
Same conversation files, segmented into N equal-length windows by `evaluation/shared/segmenter.ts`.

### Step A — Reconstruct

Render `reconstructor-system.hbs` + `reconstructor-user.hbs` (alias, scenario, segment transcript, field definitions). Call LLM → get per-field inferred items.

For each of the 6 fields (`personalityTraits`, `speechPatterns`, `values`, `fears`, `goals`, `copingStyle`) the reconstructor returns either:

```json
{ "not_observed": false, "items": ["channels fear into immediate action", "..."] }
```
or, if the transcript contains no evidence for that field:
```json
{ "not_observed": true, "items": [] }
```

**`not_observed` is not a failure.** It means the story simply didn't show that trait in this segment. `not_observed: true` segments are **excluded from every average and slope calculation** — they do not penalise the score. The system prompt is explicit: *"not_observed means the evidence is absent — not that the character lacks this trait. Use it freely."*

If the reconstructor emits items with `not_observed: false` but those items have no textual basis, the comparator will score them down.

### Step B — Compare

For each field, for each comparator model:
- Render `comparator-system.hbs` + `comparator-user.hbs` (field name, ground-truth items, reconstructed items)
- Call LLM → each reconstructed item is scored:

| Label | Score |
|---|---|
| `match` | +1 |
| `no_match` | 0 |
| `contradiction` | −1 |

Multiple comparator models vote per item; **strict majority** (> 50%) wins. Ties default to `no_match` (0).

`contradiction` (−1) is distinct from `no_match` (0): it signals the reconstructor actively hallucinated something that conflicts with the ground truth, rather than merely missing it.

### Step C — Field score (precision / recall / F1)

```
precision = matched / observed_count        (penalises hallucination)
recall    = matched / gt_count              (penalises omission)
F1        = 2 × precision × recall / (precision + recall)
```

`matched` = items scored +1 after majority vote. `contradiction` items lower precision (they are in `observed_count` but not `matched`) but do not directly enter the F1 formula — they are tracked separately in `contradicted`.

`not_observed: true` fields produce `f1: 0` in the raw struct but are **filtered out** before any mean or slope is computed.

### Step D — Drift metrics (across segments)

- **`gt_divergence_slope`**: OLS linear regression of F1 scores across observed segments. A negative slope means fidelity drops as the conversation progresses. Computed only when ≥ 2 segments have non-null F1.
- **`internal_consistency`**: F1 computed by treating the first-segment reconstructed items as "ground truth" and comparing against the last-segment items. Measures how much the character's expressed identity shifts end-to-end.

(`evaluation/reconstruct/scoring.ts:computeSlope`, `computeFieldDriftScore`)

### Output
`eval-XX/reconstruct_persona/conversations/NNN.yaml` — per-character metrics per segment.
`eval-XX/reconstruct_persona/summary.yaml` — dataset-level aggregates.

---

## Pass 3 — Context Drift (`evaluation/drift/`)

**Question:** Does the scenario stay on-topic and do characters stay in character as the conversation progresses?

### Input
Same conversation files, same segmentation.

### Steps per segment

1. Render `drift/prompts/system.hbs` + `drift/prompts/user.hbs`:
   - System: engagement tier definitions, alignment tier definitions
   - User: scenario metadata (stress axes, social context, pressure source, opening prompt), character profiles, prior messages as context, current segment
2. For each of up to 3 judge models (in parallel via `Promise.allSettled()`): call LLM → get:
   ```json
   {
     "scenario_engagement": "active" | "touched" | "absent",
     "character_alignments": [
       { "character_id": "...", "label": "consistent" | "neutral" | "contradicts" }
     ]
   }
   ```
3. **Majority vote** — strict majority (> 50%). Ties default to `touched` / `neutral`.

### Label → score mapping

| Label | Score |
|---|---|
| `active` / `consistent` | 1.0 |
| `touched` / `neutral` | 0.5 |
| `absent` / `contradicts` | 0.0 |

**What the labels mean:**
- **Engagement — `active`:** the scenario's core tension is clearly enacted. `touched`: theme is present but peripheral. `absent`: the scene has drifted away from the scenario premise.
- **Alignment — `consistent`:** the character's behaviour reflects their documented personality. `neutral`: behaviour is plausible but uncharacteristic. `contradicts`: behaviour violates the character's core traits.

### Drift calculation

**Total drift = last segment score − first segment score.**

Thresholds (hardcoded in `evaluation/shared/constants.ts`):

| Range | Verdict |
|---|---|
| total < −0.25 | `degrading` |
| total > +0.25 | `improving` |
| −0.25 to +0.25 | `stable` |

Examples (2 segments):

| Segment 1 | Segment 2 | Delta | Verdict |
|---|---|---|---|
| `active` (1.0) | `absent` (0.0) | −1.0 | **degrading** |
| `touched` (0.5) | `active` (1.0) | +0.5 | **improving** |
| `active` (1.0) | `active` (1.0) | 0.0 | **stable** |
| `active` (1.0) | `touched` (0.5) | −0.5 | **degrading** |

With more than 2 segments, per-step deltas are stored, but the **verdict** is always based on total start-to-end movement (`last − first`). Intermediate steps are stored for inspection but do not affect the verdict.

Verdict is computed independently for scenario engagement and for each character's alignment.

(`evaluation/drift/scoring.ts:computeVerdict`, `computeDriftDeltas`)

### Output
`eval-XX/context_drift/conversation_results.yaml`
`eval-XX/context_drift/summary.yaml`

---

## Shared LLM Call (`evaluation/shared/call.ts`)

Every pass funnels through `callWithRetry<T>()`:

1. `new OpenAI({ baseURL: LLM_BASE_URL + "/v1", apiKey: LLM_API_KEY })`
2. `client.chat.completions.create()` with:
   - `stream: true`, `stream_options: { include_usage: true }`
   - `temperature: 0`
   - `response_format: { type: "json_object" }`
   - `extra_headers: { "HTTP-Referer": "https://openormus.app", "X-Title": "OpenOrmus" }`
3. Collect streamed chunks; extract usage (`inputTokens`, `outputTokens`, `reasoningTokens`, `cachedTokens`) and the `x-generation-id` header
4. Parse the accumulated string as JSON, validate against the pass-specific Zod schema
5. On failure (JSON parse error, empty response, schema mismatch): retry up to 3 times with detailed error context appended
6. Return `{ result: T, usage: RawUsageMeta }`

Usage is immediately handed to `CostTracker.record()`, keyed by `conversationId + segmentIdx + role`. After each pass completes, `tracker.flush()` writes `eval-XX/costs/<pass>.yaml`.

---

## Output Directory Structure

```
$EVAL_RESULTS_PATH/
└── <dataset>/
    ├── conversations/
    │   └── NNN.yaml               alias-masked ConversationResult
    └── eval-XX/
        ├── judge_guessing/
        │   └── guessing_result.yaml
        ├── reconstruct_persona/
        │   ├── conversations/
        │   │   └── NNN.yaml       ConversationReconstructionResult
        │   └── summary.yaml
        ├── context_drift/
        │   ├── conversation_results.yaml
        │   └── summary.yaml
        └── costs/
            ├── judge_guessing.yaml
            ├── reconstruct_persona.yaml
            └── context_drift.yaml
```

---

## Call Sequence

```
bun evaluation/run_pipeline.ts dataset-v2
    │
    └─ Promise.allSettled([
         ┌─ runJudgingPass() ──────────────────────────────────────┐
         │  per conversation:                                       │
         │    shuffle profiles (seeded by scenario_id)             │
         │    per judge model:                                      │
         │      render system.hbs + user.hbs                       │
         │      callWithRetry() → parse JudgeOutputSchema          │
         │      score alias→real_name assignments                  │
         │  writeGuessingResult()  ·  tracker.flush()              │
         └─────────────────────────────────────────────────────────┘
         ┌─ runReconstructionPass() ───────────────────────────────┐
         │  per conversation:                                       │
         │    segmentConversation(messages, N)                      │
         │    per character:                                        │
         │      per segment:                                        │
         │        callWithRetry() → parse ReconstructorOutput      │
         │        per field:                                        │
         │          per comparator model:                           │
         │            callWithRetry() → parse ComparatorOutput     │
         │          majority vote → match/no_match/contradiction    │
         │          computeFieldScore() → precision/recall/F1      │
         │      computeFieldDriftScore() → slope, consistency      │
         │  writeReconstructResults()  ·  tracker.flush()          │
         └─────────────────────────────────────────────────────────┘
         ┌─ runDriftPass() ────────────────────────────────────────┐
         │  per conversation:                                       │
         │    segmentConversation(messages, N)                      │
         │    per segment:                                          │
         │      render system.hbs + user.hbs                       │
         │      per judge model (parallel):                         │
         │        callWithRetry() → parse DriftJudgeOutput         │
         │      majorityVoteEngagement() → active/touched/absent   │
         │      majorityVoteAlignment()  → consistent/neutral/…    │
         │    computeDriftDeltas() → last−first → verdict          │
         │  writeConversationResults()  ·  tracker.flush()         │
         └─────────────────────────────────────────────────────────┘
       ])
```
