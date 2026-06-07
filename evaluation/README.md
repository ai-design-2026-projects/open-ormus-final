# Evaluation Pipeline

The evaluation pipeline measures **LLM behavioural fidelity end-to-end**: given a character profile, does the production `generateTurn()` function preserve personality signal through the full chain of `profile → generation → behaviour → analysis`?

It runs entirely offline. No database, no auth. You need only `LLM_API_KEY` and `LLM_BASE_URL` in your `.env`.

---

## Dataset

The dataset lives in `evaluation/dataset/` and is **static** — it defines the ground truth.

| File              | Contents                                                   |
| ----------------- | ---------------------------------------------------------- |
| `characters.yaml` | 16 fictional characters across two tiers                   |
| `scenarios.yaml`  | 32 social scenarios with stress axes and difficulty levels |

### Characters

**Tier 1 — 8 Distinctive Archetypes** (char_001–008): placed on a 2D grid of moral axis × agency axis. Each occupies a unique coordinate (e.g. Rebel = Idealist × High Agency, Fatalist = Cynic × Low Agency). Maximally separated in personality space.

**Tier 2 — 4 Similar Pairs** (char_009–016): each pair shares every field except one `varyingAxis`. These are the benchmark's sharpest test — a model that collapses to average behaviour fails to distinguish pair members on their single axis of difference.

| Pair       | IDs                 | varyingAxis    |
| ---------- | ------------------- | -------------- |
| Officials  | char_009 / char_010 | speechPatterns |
| Survivors  | char_011 / char_012 | copingStyle    |
| Reformers  | char_013 / char_014 | fears          |
| Caregivers | char_015 / char_016 | goals          |

All characters are set in **Vethara**, a fictional island city-state. The fictional setting eliminates LLM training-data contamination.

### Scenarios

32 scenarios across three difficulty levels (`baseline`, `moderate`, `high`) and multiple stress axes (e.g. `power consolidation vs fairness`, `obedience vs conscience`). Each scenario has a `social_context` and a `pressure_source` tag, and a list of `stress_axes` that pair-differentiation analysis uses to determine whether a scenario is likely to activate a pair's `varyingAxis`.

---

## Pipeline

The four passes run in sequence. Each pass reads the output of the previous one.

```
generate_dataset.ts  →  judge_guessing.ts  →  reconstruct_persona.ts  →  context_drift.ts
       ↓                      ↓                        ↓                        ↓
  conversations/          judge_guessing/        reconstruct_persona/       context_drift/
```

All passes use `Promise.all` — conversations are processed in parallel within each pass.

**Step 1 — Generate the dataset:**

```bash
bun evaluation/generate_dataset.ts evaluation/configs/generate-dataset.yaml
```

**Step 2 — Run all evaluation passes:**

```bash
bun evaluation/run_pipeline.ts <dataset-name>
```

The pipeline scans `EVAL_RESULTS_PATH/<dataset-name>/` for the first `eval-XX` directory and runs judge → reconstruct → drift on it.

Individual passes can also be run separately. Each pass reads `eval_name` from its YAML config — see the Config Reference below.

---

### Pass 1 — Generate Dataset

**Entry point:** `evaluation/generate_dataset.ts`
**What it measures:** nothing — it generates the conversation corpus that the other passes evaluate.

Calls the production `generateTurn()` function for each configured run (character × scenario pairing). Output is a set of conversation YAML files in `evaluation/results/<output_dir>/conversations/`.

**Command:**

```bash
bun evaluation/generate_dataset.ts evaluation/configs/generate-dataset.yaml
```

**Key config fields:**

```yaml
output_dir: "dataset-v1" # name of the dataset; passed as dataset_dir to passes 2–4
default_model:
  "..." # generation model — use a capable, instruction-following model;
  # this is the most quality-sensitive step in the pipeline
runs:
  - scenario: scenario_020
    characters: [char_001, char_007]
    turns: 4
    turn_strategy: ROUND_ROBIN # or ORCHESTRATOR (≥3 characters)
```

**Output:** `evaluation/results/<output_dir>/conversations/001.yaml`, `002.yaml`, …

---

### Pass 2 — Judge / Guessing

**Entry point:** `evaluation/judge_guessing.ts`
**What it measures:** **distinguishability** — can a judge LLM tell which alias maps to which character from the transcript alone? Characters are anonymised to random aliases before the judge sees them.

A panel of 1–3 judge models reads each conversation and guesses the alias → character mapping. Agreement across models is reported as `inter_judge_agreement`. Low accuracy means characters are not sufficiently distinct in their generated behaviour.

**Command:**

```bash
bun evaluation/judge_guessing.ts evaluation/configs/judge-guessing.yaml [eval-name]
```

`eval-name` is an optional second argument that identifies which evaluation run to write into (defaults to `"eval-01"`). It must match the `eval-name` used when the dataset was generated.

**Key config fields:**

```yaml
dataset_dir: "dataset-v1"
judges:
  - model: "..." # use a diverse panel — models from different families reduce correlated errors;
  - model: "..." # each judge reads the same transcript independently
  - model: "..."
```

**Output:** `evaluation/results/<dataset_dir>/<eval-name>/judge_guessing/guessing_result.yaml`

---

### Pass 3 — Persona Reconstruction (+ optional Drift)

**Entry point:** `evaluation/reconstruct_persona.ts`
**What it measures:** **fidelity** — how much personality signal survives generation. A reconstructor LLM infers the character's profile from the transcript (blind — no ground truth shown). A comparator panel scores each reconstructed item against the ground-truth profile.

**Primary metric:** `contradiction_rate` — not how much was recovered, but how much actively contradicts the profile. Low recall can mean the scenario didn't activate a trait (expected). Active contradiction means the model broke character.

**Six fields in scope:** `personalityTraits`, `speechPatterns`, `values`, `fears`, `goals`, `copingStyle`. Fields like `notableQuotes` and `backstory` are excluded (not reliably observable in short conversations).

**Pair differentiation:** for similar-pair conversations, the comparator runs in 4 directions on the `varyingAxis` field (A-on-A, B-on-B, A-on-B, B-on-A). A pair is _differentiated_ when diagonal scores > 0.5 and cross scores < 0.5.

**Drift mode:** set `segments: N` (N ≥ 2) to split each conversation into N time windows and reconstruct each window independently. This surfaces temporal drift — whether a character's fidelity holds, degrades, or recovers over the conversation. Without `segments`, the full transcript is used (equivalent to `segments: 1`).

**Command:**

```bash
bun evaluation/reconstruct_persona.ts evaluation/configs/reconstruct-persona.yaml [eval-name]
```

`eval-name` is an optional second argument (defaults to `"eval-01"`). Must match the run to evaluate.

**Key config fields:**

```yaml
dataset_dir: "dataset-v1"
reconstructor:
  model: "..." # strong reasoning/summarisation model — infers personality from transcript alone
comparators:
  - model: "..." # use a different family from the reconstructor to avoid self-grading bias
  - model: "..."
# segments: optional — splits each transcript into N time windows for temporal drift detection;
#           omit for full-transcript mode
# fields: optional — defaults to all 6 behavioural fields
```

**Output:** `evaluation/results/<dataset_dir>/<eval-name>/reconstruct_persona/`

- `conversations/` — per-conversation result files
- `summary.yaml` — aggregated metrics by field, difficulty, tier, and pair

---

### Pass 4 — Context Drift

**Entry point:** `evaluation/context_drift.ts`
**What it measures:** **scenario engagement** — did the scenario successfully activate its intended stress axes over the conversation, and did each character respond to that pressure in a personality-consistent way? Tracked across configurable time segments to detect engagement drift.

This is **complementary to Pass 3**, not redundant. Pass 3 is scenario-blind (judges don't know what scenario the character was in). Pass 4 is scenario-aware (judges explicitly evaluate whether the scenario's pressure was felt and responded to correctly).

|                          | Pass 3 — Reconstruct        | Pass 4 — Context Drift             |
| ------------------------ | --------------------------- | ---------------------------------- |
| Scenario known to judge? | No                          | Yes                                |
| Character sheets known?  | No                          | Yes                                |
| Measures                 | Trait expression            | Scenario-triggered behaviour       |
| Output                   | F1 per field                | Engagement + alignment per segment |
| Diagnostic value         | Character prompting quality | Scenario design quality            |

Cross-referencing both passes:

| Pass 3 ↓ \ Pass 4 → | High engagement                       | Low engagement                        |
| ------------------- | ------------------------------------- | ------------------------------------- |
| **High fidelity**   | Traits expressed AND scenario engaged | Traits expressed but scenario ignored |
| **Low fidelity**    | Scenario engaged but personality weak | Both failed                           |

**Primary metric:** `total_drift` per scenario — difference between first and last segment score. Negative = scenario lost grip; zero = flat disengagement; positive = engagement built over time.

**Command:**

```bash
bun evaluation/context_drift.ts evaluation/configs/context-drift.yaml [eval-name]
```

`eval-name` is an optional second argument (defaults to `"eval-01"`). Must match the run to evaluate.

**Key config fields:**

```yaml
dataset_dir: "dataset-v1"
# segments: number of time windows to split each conversation into (must be ≥ 2);
#           more segments = finer drift granularity, higher cost
judges:
  - model: "..." # diverse panel, same guidance as Pass 2
  - model: "..."
  - model: "..."
```

**Output:** `evaluation/results/<dataset_dir>/<eval-name>/context_drift/`

---

## Results Directory Layout

```
evaluation/results/
└── dataset-v1/                    ← output_dir from generate config (= dataset_dir for passes 2–4)
    └── eval-01/                   ← auto-assigned by generate (eval-01, eval-02, …)
        │                            pass as second CLI arg to passes 2–4 to target this run
        ├── meta.yaml              ← created by generate, updated by each subsequent pass
        ├── generate-config.yaml   ← copy of the generate config
        ├── conversations/         ← written by generate
        │   ├── 001.yaml
        │   ├── 002.yaml
        │   └── ...
        ├── judge_guessing/        ← written by pass 2
        │   ├── config.yaml
        │   └── guessing_result.yaml
        ├── reconstruct_persona/   ← written by pass 3
        │   ├── config.yaml
        │   ├── conversations/
        │   │   ├── 001.yaml
        │   │   └── ...
        │   └── summary.yaml
        └── context_drift/         ← written by pass 4
            ├── config.yaml
            ├── conversation_results.yaml
            └── summary.yaml
```

The generate step auto-increments `eval-name` (eval-01, eval-02, …) so it never overwrites an existing run. Passes 2–4 fail if their output subdirectory already exists — delete it or use a different `eval-name`.

---

## Environment Variables

| Variable       | Required   | Description                                        |
| -------------- | ---------- | -------------------------------------------------- |
| `LLM_API_KEY`  | All passes | API key for the LLM provider                       |
| `LLM_BASE_URL` | All passes | Provider URL (e.g. `https://openrouter.ai/api/v1`) |

Both are read from `.env.local` at project root (Bun loads it automatically). Neither appears in config YAML files.

---

## Config Reference

| Entry point                                                  | Config(s)                  | Description                    |
| ------------------------------------------------------------ | -------------------------- | ------------------------------ |
| `bun evaluation/run_pipeline.ts`                             | all four (defaults)        | Runs all passes in sequence    |
| `bun evaluation/generate_dataset.ts <config>`                | `generate-dataset.yaml`    | Generate conversations         |
| `bun evaluation/judge_guessing.ts <config> [eval-name]`      | `judge-guessing.yaml`      | Judge guessing pass            |
| `bun evaluation/reconstruct_persona.ts <config> [eval-name]` | `reconstruct-persona.yaml` | Reconstruction pass            |
| `bun evaluation/reconstruct_persona.ts <config> [eval-name]` | `drift-check.yaml`         | Reconstruction in segment mode |
| `bun evaluation/context_drift.ts <config> [eval-name]`       | `context-drift.yaml`       | Context drift pass             |
