# Context Drift Evaluation Pass

**Date:** 2026-06-05
**Status:** Approved

---

## Context

The evaluation pipeline has three completed passes:

1. **Runner** — generates conversation YAMLs from characters × scenarios using the production `generateTurn()` function.
2. **Judge/Guessing** — tests whether characters are distinguishable (anonymized aliases).
3. **Persona Reconstruction** — tests how much personality signal survives generation, blind to the scenario.

This spec defines the fourth pass: **Context Drift**. Given a conversation transcript, a judge panel evaluates both whether the scenario's intended stress axes were engaged, and whether each character's response to that pressure was consistent with their personality sheet. The evaluation is repeated across configurable time segments to detect temporal drift.

**What this measures:** whether a scenario successfully activates its intended tension over the course of a conversation, and whether characters respond to that tension in a personality-consistent way — tracked over time to detect degradation, recovery, or flat disengagement.

---

## What This Does NOT Measure

- Whether characters expressed their traits in general (that is Pass 3 — Reconstruction).
- Character distinguishability (Pass 2 — Judge/Guessing).
- Individual model capability in isolation.
- Frontend, database, or auth — this is an offline batch pass.

---

## Distinction from Pass 3 (Persona Reconstruction)

| | Pass 3 — Reconstruct | Pass 4 — Context Drift |
|---|---|---|
| Scenario known to judge? | No (scenario-blind by design) | Yes |
| Character sheets known? | No | Yes |
| Measures | Trait expression (did traits appear?) | Scenario-triggered behaviour (did the scenario activate the right response?) |
| Output | F1 per field per character | Engagement + alignment scores per segment |
| Diagnostic value | Character prompting quality | Scenario design quality |

These passes are complementary. Their outputs are designed to be cross-referenced:

| Pass 3 ↓ \ Pass 4 → | High drift score | Low drift score |
|---|---|---|
| **High** | Traits expressed AND scenario engaged | Traits expressed but scenario ignored |
| **Low** | Scenario engaged but personality weak | Both failed |

---

## Primary Signal: Total Drift

The most actionable output is `total_drift` per scenario: the difference between the first and last segment score. A negative delta means the scenario lost grip as the conversation progressed. Zero means flat disengagement throughout (a scenario design problem, not drift). Positive means engagement built over time.

Secondary signals:
- `by_character` drift — which character archetypes are most prone to drifting
- `mean_drift_per_delta` — average drop per segment boundary (distinguishes sudden collapse from gradual degradation)
- `low_confidence` flags — segments where fewer than 2 judges agreed

---

## Architecture

Mirrors the existing pass structure file-for-file:

```
evaluation/
  context_drift.ts                  # CLI entry: bun evaluation/context_drift.ts <config>
  drift/
    config.ts                       # loadDriftConfig(), ValidatedDriftConfig
    prompt.ts                       # buildJudgeSystemPrompt(), buildJudgeUserPrompt()
    schema.ts                       # JSON schema for judge structured output
    types.ts                        # Zod schemas + TypeScript types
    call.ts                         # callJudge() — MAX_RETRIES=3
    segment.ts                      # splitIntoSegments(turns, n) → TurnMessage[][]
    scoring.ts                      # labelToScore(), majorityVote(), computeDrift()
    pass.ts                         # runDriftPass()
    writer.ts                       # initOutputDir(), writeConversationResult(), writeSummary()
    index.ts                        # per-conversation drift loop
    __tests__/
      segment.test.ts
      scoring.test.ts
  configs/
    context-drift.yaml              # example config
```

Output path: `evaluation/results/{dataset_dir}/context_drift/{output_name}/`

Existing code reused:
- `runner/config.ts` → `CharacterRecord`, `ScenarioRecord`, `TurnMessage` types
- `reconstruct/call.ts` → retry pattern, structured output via `response_format`, error logging

---

## Config YAML

```yaml
# Run: bun evaluation/context_drift.ts evaluation/configs/context-drift.yaml
# Required env: LLM_API_KEY

dataset_dir: "dataset-001"
output_name: "drift-run-001"
base_url: "https://openrouter.ai/api"
segments: 3                         # must be ≥ 2; produces segments-1 drift deltas

judges:                             # 2–3 models recommended; majority vote
  - model: "gemini/gemini-2.5-flash"
  - model: "gemini/gemini-2.5-pro"
  - model: "mistralai/mistral-nemo"
```

Config validation:
- `segments ≥ 2`
- `judges.length ≥ 1`
- `dataset_dir` exists with a `conversations/` subdirectory
- `context_drift/{output_name}` does not already exist (no overwrite)
- `LLM_API_KEY` is set

---

## Judge Call Structure

**One call per segment per judge** = `segments × judges` calls per conversation (9 for the default 3 × 3 config).

Each call receives the scenario, all character sheets, and the segment transcript — everything in a single focused prompt. The judge evaluates both dimensions simultaneously because scenario engagement and personality alignment are not independent: you cannot assess whether a character responded correctly to a scenario without knowing both the scenario's stress and the character's sheet.

### System prompt

```
You are evaluating a roleplay conversation segment.

Your task:
1. Score how actively this segment engages the scenario's intended stress axes.
2. For each character, score whether their response to the scenario's pressure
   is consistent with their personality sheet.

Return only valid JSON matching the provided schema. Include a concise reasoning
field for each score.
```

### User prompt (per segment)

```
## Scenario
stress_axes: [loyalty_vs_principle, truth_vs_kindness]
social_context: personal_betrayal
pressure_source: relational_demand
initial_prompt: "..."

## Characters

kael_veth — Rebel
  personalityTraits: [...]
  values: [...]
  fears: [...]
  goals: [...]
  copingStyle: [...]
  speechPatterns: [...]

mira_dun — Fatalist
  ...

## Conversation (turns 6–10 of 15)
[kael_veth]: "..."
[mira_dun]: "..."
...

## Task
Score scenario_engagement for this segment, then score personality_alignment
for each character listed above.
```

### Output schema (validated with Zod)

```typescript
{
  scenario_engagement: "active" | "touched" | "absent",
  reasoning: string,
  character_alignment: Array<{
    character_id: string,           // must match a character_id from the prompt
    label: "consistent" | "neutral" | "contradicts",
    reasoning: string
  }>
}
```

---

## Segmentation

`splitIntoSegments(turns, n)`:
- Divides the turn array into `n` segments of equal size (`Math.floor(turns.length / n)` turns each)
- Remainder turns go into the last segment
- Minimum turns per segment: 1 (enforced; if `turns.length < segments`, validation fails at config load with a clear error)

---

## Scoring

**Label → numeric:**

| Label | Score |
|---|---|
| `active` / `consistent` | 1.0 |
| `touched` / `neutral` | 0.5 |
| `absent` / `contradicts` | 0.0 |

**Majority vote:** 3 judges → label with ≥ 2 votes wins. If all three differ (tie): use the middle label (`touched` / `neutral`). Confidence = agreeing votes / total valid votes.

**Drift delta:** `score(segment[i]) − score(segment[i−1])`, range −1.0 to +1.0

**Total drift:** `score(last segment) − score(first segment)`

**Verdict thresholds:**
- `degrading`: total drift < −0.25
- `stable`: −0.25 ≤ total drift ≤ +0.25
- `improving`: total drift > +0.25

---

## Error Handling

Mirrors `evaluation/reconstruct/call.ts`:
- Retry each judge call up to 3 times on JSON parse failure or schema validation failure
- If a judge exhausts retries: mark result as `null`, exclude from vote
- If fewer than 2 judges succeed for a segment: include result with `low_confidence: true`; flag in summary
- All failures logged to `debug/drift/YYYYMMDD_HHMMSS_<uuid>_log.json` (minimum fields: `session_id`, `component`, `event`, `timestamp`)

---

## Key Types

```typescript
type EngagementLabel = "active" | "touched" | "absent"
type AlignmentLabel = "consistent" | "neutral" | "contradicts"

type JudgeOutput = {
  scenario_engagement: EngagementLabel
  reasoning: string
  character_alignment: Array<{
    character_id: string
    label: AlignmentLabel
    reasoning: string
  }>
}

type SegmentScore = {
  index: number                        // 1-based
  turn_range: [number, number]         // inclusive
  scenario_engagement: {
    label: EngagementLabel
    votes: EngagementLabel[]
    confidence: number
    score: number                      // label → numeric
  }
  personality_alignment: Array<{
    character_id: string
    archetype: string
    label: AlignmentLabel
    votes: AlignmentLabel[]
    confidence: number
    score: number
  }>
  low_confidence: boolean
}

type DriftDelta = {
  from_segment: number
  to_segment: number
  scenario_engagement_delta: number
  character_deltas: Array<{
    character_id: string
    delta: number
  }>
}

type ConversationDriftResult = {
  conversation_file: string
  scenario_id: string
  scenario_title: string
  stress_axes: string[]
  segments: SegmentScore[]
  drift: {
    scenario_engagement: {
      deltas: DriftDelta[]
      total: number
      verdict: "degrading" | "stable" | "improving"
    }
    personality_alignment: Array<{
      character_id: string
      archetype: string
      deltas: number[]
      total: number
      verdict: "degrading" | "stable" | "improving"
    }>
  }
}

type ScenarioDriftSummary = {
  scenario_id: string
  scenario_title: string
  stress_axes: string[]
  total_conversations: number
  scenario_engagement: {
    by_segment: Array<{
      index: number
      active: number
      touched: number
      absent: number
      mean_score: number
    }>
    mean_drift_per_delta: number
    total_drift: number
    verdict: "degrading" | "stable" | "improving"
  }
  personality_alignment: {
    by_segment: Array<{ index: number; mean_score: number }>
    total_drift: number
    verdict: "degrading" | "stable" | "improving"
    by_character: Array<{
      character_id: string
      archetype: string
      mean_total_drift: number
      verdict: "degrading" | "stable" | "improving"
    }>
  }
  low_confidence_conversations: number  // count flagged with low_confidence
}
```

---

## Output Files

### `conversation_results.yaml`

Array of `ConversationDriftResult` — one entry per conversation file processed.

```yaml
- conversation_file: "001.yaml"
  scenario_id: "scenario_012"
  scenario_title: "The Betrayal at the Gate"
  stress_axes: ["loyalty_vs_principle", "truth_vs_kindness"]

  segments:
    - index: 1
      turn_range: [1, 5]
      scenario_engagement:
        label: "active"
        votes: ["active", "active", "touched"]
        confidence: 0.67
        score: 1.0
      personality_alignment:
        - character_id: "kael_veth"
          archetype: "Rebel"
          label: "consistent"
          votes: ["consistent", "consistent", "neutral"]
          confidence: 0.67
          score: 1.0
        - character_id: "mira_dun"
          archetype: "Fatalist"
          label: "contradicts"
          votes: ["contradicts", "neutral", "contradicts"]
          confidence: 0.67
          score: 0.0
      low_confidence: false

    - index: 2
      turn_range: [6, 10]
      scenario_engagement:
        label: "touched"
        score: 0.5
        ...
      personality_alignment:
        ...

    - index: 3
      turn_range: [11, 15]
      scenario_engagement:
        label: "absent"
        score: 0.0
        ...

  drift:
    scenario_engagement:
      deltas:
        - from_segment: 1
          to_segment: 2
          scenario_engagement_delta: -0.5
        - from_segment: 2
          to_segment: 3
          scenario_engagement_delta: -0.5
      total: -1.0
      verdict: "degrading"
    personality_alignment:
      - character_id: "kael_veth"
        archetype: "Rebel"
        deltas: [-0.5, 0.0]
        total: -0.5
        verdict: "degrading"
      - character_id: "mira_dun"
        archetype: "Fatalist"
        deltas: [0.5, 0.0]
        total: 0.5
        verdict: "improving"   # was contradicts at seg 1, recovered
```

### `summary.yaml`

Array of `ScenarioDriftSummary` — one entry per unique `scenario_id` across all processed conversations.

```yaml
- scenario_id: "scenario_012"
  scenario_title: "The Betrayal at the Gate"
  stress_axes: ["loyalty_vs_principle", "truth_vs_kindness"]
  total_conversations: 8

  scenario_engagement:
    by_segment:
      - index: 1
        active: 6
        touched: 2
        absent: 0
        mean_score: 0.875
      - index: 2
        active: 3
        touched: 4
        absent: 1
        mean_score: 0.625
      - index: 3
        active: 1
        touched: 3
        absent: 4
        mean_score: 0.3125
    mean_drift_per_delta: -0.28
    total_drift: -0.56
    verdict: "degrading"

  personality_alignment:
    by_segment:
      - index: 1
        mean_score: 0.87
      - index: 2
        mean_score: 0.63
      - index: 3
        mean_score: 0.44
    total_drift: -0.43
    verdict: "degrading"
    by_character:
      - character_id: "kael_veth"
        archetype: "Rebel"
        mean_total_drift: -0.10
        verdict: "stable"
      - character_id: "mira_dun"
        archetype: "Fatalist"
        mean_total_drift: -0.70
        verdict: "degrading"

  low_confidence_conversations: 1
```

---

## Diagnostic Reading

| Signal | Likely cause |
|---|---|
| `total_drift` negative for scenario_engagement | Scenario loses grip as context fills — scenario design or turn count problem |
| `total_drift` ≈ 0 AND `mean_score` < 0.5 throughout | Scenario never activated its stress — scenario prompt too weak |
| `total_drift` negative for a specific character | That character's personality breaks down under prolonged context |
| Large gap between character drift rates in same scenario | Some archetypes are more context-stable than others |
| High `low_confidence_conversations` count | Judge models disagree frequently — review prompt or reduce segments |
| `improving` verdict | Scenario takes several turns to establish — normal for high-difficulty scenarios |

---

## Tests

```
evaluation/drift/__tests__/
  segment.test.ts    — splitIntoSegments: equal split, remainder to last, turns < segments error
  scoring.test.ts    — labelToScore, majorityVote (tie, nulls, 2/3, 3/3), computeDrift, verdict thresholds
```

Integration: mock judge calls in `pass.test.ts` to verify full orchestration produces correct `ConversationDriftResult` shape.

---

## Verification

```bash
# Type check
bun run typecheck

# Unit tests
bun test --cwd evaluation

# End-to-end (requires LLM_API_KEY and completed runner output)
bun evaluation/context_drift.ts evaluation/configs/context-drift.yaml

# Check outputs
ls evaluation/results/<dataset_dir>/context_drift/<output_name>/
# Expected: config.yaml, conversation_results.yaml, summary.yaml

# Verify drift deltas are present
grep "total_drift" evaluation/results/.../summary.yaml
```
