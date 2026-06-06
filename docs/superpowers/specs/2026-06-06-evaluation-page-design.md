# Evaluation Page — Design Spec

**Date:** 2026-06-06
**Branch:** worktree-feature-evaluation-page

---

## Overview

A read-only internal dashboard at `/evaluation` for inspecting evaluation pipeline results. Access is restricted to a configurable email allowlist. The page covers all four evaluation passes (Generate, Judge, Reconstruct, Drift) through a tabbed layout, plus a static Dataset reference tab and a collapsible config panel.

---

## 1. Pipeline Output Restructure

### Current structure
Each pass writes independently under its own named sub-folder:
```
evaluation/results/<dataset_dir>/
  conversations/001.yaml
  judge_guessing/judge-run-001/guessing_result.yaml
  reconstruct_persona/reconstruct-run-001/conversations/001.yaml
  context_drift/drift-run-001/conversation_results.yaml
```

### New structure
All four passes for a single evaluation run live under one `eval-XX` directory:
```
evaluation/results/<dataset_dir>/
  eval-01/
    meta.yaml
    conversations/001.yaml
    judge_guessing/guessing_result.yaml
    reconstruct_persona/conversations/001.yaml
    reconstruct_persona/summary.yaml
    context_drift/conversation_results.yaml
    context_drift/summary.yaml
```

### `meta.yaml` shape
Written at the start of each eval run:
```yaml
eval_name: eval-01
created_at: 2026-06-06T14:32:00Z
dataset_dir: dataset-001
dataset_created_at: 2026-06-01T10:00:00Z
passes:
  generate:
    model: xiaomi/mimo-v2-flash
    turn_strategy: ROUND_ROBIN
    runs: 7
  judge:
    judges: 3
    model: mistral-nemo
  reconstruct:
    reconstructor: mistral-nemo
    comparators: [mistral-nemo, gemma-2-9b-it]
    segments: 3
  drift:
    judges: 3
    models: [mistral-nemo, mistral-nemo, gemma-2-9b-it]
    segments: 3
```

### CLI changes
- Each entry point (`generate_dataset.ts`, `judge_guessing.ts`, `reconstruct_persona.ts`, `context_drift.ts`) gains an `--eval-name` flag
- Default: `eval-01`; auto-increments if the directory already exists
- `output_name` field is removed from all YAML configs — it is now a runtime argument only

---

## 2. Environment Variables

Two new env vars added to `.env.example` and `.env.local`:

```
EVAL_ALLOWED_EMAILS=ebelord32@gmail.com,other@email.com
EVAL_RESULTS_PATH=/absolute/path/to/evaluation/results
```

`EVAL_RESULTS_PATH` defaults to `../evaluation/results` relative to `frontend/` if not set.

---

## 3. Access Control

- `/evaluation` is a Next.js server component
- On render: calls `supabase.auth.getUser()`, checks the returned email against `EVAL_ALLOWED_EMAILS` (split on `,`, trimmed)
- If the user is not authenticated or not in the list: calls Next.js `notFound()` — returns a 404 with no redirect and no indication the page exists
- The nav link to `/evaluation` is conditionally rendered server-side and hidden for non-allowed users
- No new Prisma model or DB change required

---

## 4. Data Access

### API routes (under `frontend/app/api/evaluation/`)

**`GET /api/evaluation/datasets`**
Returns all dataset directories, each with its list of eval sets and `meta.yaml` content:
```json
[
  {
    "dataset": "dataset-001",
    "evals": [
      { "name": "eval-01", "meta": { ... } },
      { "name": "eval-02", "meta": { ... } }
    ]
  }
]
```

**`GET /api/evaluation/[dataset]/[evalName]/[pass]`**
Returns parsed YAML for the requested pass. `pass` is one of: `conversations`, `judge_guessing`, `reconstruct_persona`, `context_drift`.

Both routes:
- Check the email allowlist before returning data
- Parse YAML using the `yaml` package (already installed at `yaml@2.9.0`)
- Return 404 if the path does not exist on disk

### Filesystem access
Next.js server components and route handlers use Node.js `fs` to read files. Paths are constructed from `EVAL_RESULTS_PATH`. This is valid in App Router (Node runtime, not Edge).

---

## 5. Page Layout

```
┌─────────────────────────────────────────────────────┐
│  Dataset: [dataset-001 ▾]   Eval: [eval-01 · Jun 6 ▾] │
├─────────────────────────────────────────────────────┤
│  ▼ Config  (collapsible panel)                      │
│    Dataset creation: model, strategies, runs        │
│    Eval run: judge models, reconstructor, segments  │
│    Timestamps: generated at, eval run at            │
├─────────────────────────────────────────────────────┤
│  Dataset │ Generate │ Judge │ Reconstruct │ Drift   │
├─────────────────────────────────────────────────────┤
│  (tab content)                                      │
└─────────────────────────────────────────────────────┘
```

Changing the dataset selector reloads all tabs and the config panel. Changing the eval set selector reloads the results tabs (Generate through Drift) and the config panel; Dataset tab is unchanged (it reads from `evaluation/dataset/`, not the eval run).

---

## 6. Tabs

### 6.1 Dataset tab (first tab)
Static reference data from `evaluation/dataset/characters.yaml` and `evaluation/dataset/scenarios.yaml`. Does not update when the eval set changes.

- **Character grid**: one card per character showing name and archetype; expandable to reveal full sheet fields (personalityTraits, speechPatterns, etc.)
- **Scenario list**: title + stress axes + context summary; collapsible rows

### 6.2 Generate tab
Two-panel layout:

- **Left panel**: searchable list of conversations. Each item shows scenario title + character names. Filter input searches by scenario title or character name. ~15–20 items visible at once.
- **Right panel**: full transcript of the selected conversation rendered in screenplay style, reusing the existing `screenplay-block.tsx` component from `frontend/app/preview/_components/`.

### 6.3 Judge tab

**Header strip**
- Overall accuracy % across all judges and conversations
- Weighted random baseline: `total_conversations / total_characters_identified`
  - Rationale: a random guesser always gets exactly 1 character right per conversation regardless of cast size; dividing by total characters gives the expected random accuracy weighted by identification opportunities
- Above-baseline delta: `accuracy - weighted_baseline`

**Per-judge accuracy bars**
- One horizontal bar per judge, labelled with model name and accuracy %
- Dashed red vertical line at the weighted baseline
- Bars to the right of the line are above random; bars to the left are at or below random

**Character confusion table**
- Rows = real character names
- Columns: correct count, wrong count, most common wrong guess
- Identifies which characters are systematically confused with each other

**Expandable drilldown**
- Click a character row to see which specific conversations the judges got wrong
- Shows judge label, alias assigned, real name guessed, reason given

### 6.4 Reconstruct tab

**Header strip**
- Overall mean F1 across all characters and fields
- Legend/tooltip explaining the three metrics:
  - **Precision**: of traits the reconstructor claimed, what % matched ground truth (measures hallucination)
  - **Recall**: of ground truth traits, what % were identified (measures completeness)
  - **F1**: harmonic mean — the balanced score, penalises both hallucination and omission

**Per-character cards**
- One card per character showing name, archetype, difficulty tier
- Field breakdown table inside each card: field name | F1 | Precision | Recall
- 3-point sparkline (Recharts) showing F1 per segment — the drift slope visualised as a line
  - Positive slope → character becomes more legible over time
  - Negative slope → persona degrades
  - Flat → consistent throughout
- Slope badge alongside sparkline: "improving ↑ / stable → / degrading ↓" with colour (green/grey/red)

**Expandable drilldown**
- Click a character card to see per-conversation F1 scores
- Shows which scenarios produced the best and worst reconstruction

### 6.5 Drift tab

**Header strip**
- Verdict distribution for scenario engagement: `N degrading · N stable · N improving`
- Verdict distribution for personality alignment: same format
- These are counts across all conversations in the eval set

**Per-conversation cards**
- Scenario title + stress axes shown prominently (context for interpreting drift)
- Two 3-point sparklines side by side (Recharts):
  - Engagement trajectory: `active=1 / touched=0.5 / absent=0` per segment
  - Alignment trajectory: `consistent=1 / neutral=0.5 / contradicts=0` per segment
- Verdict badge for each dimension (degrading/stable/improving)

No deeper drilldown — segment-level data is the finest grain already shown.

---

## 7. Charts

**Library:** Recharts — requires `bun add recharts` approval before implementation.

Used for:
- Horizontal accuracy bars (Judge tab)
- 3-point sparklines for F1 drift (Reconstruct tab)
- 3-point sparklines for engagement/alignment (Drift tab)

Plain HTML/CSS tables are used for the character confusion matrix and field breakdown tables — no chart library needed there.

---

## 8. File Structure

```
frontend/app/
  evaluation/
    page.tsx                    ← server component, auth check, dataset/eval selectors
    _components/
      config-panel.tsx          ← collapsible config/meta display
      dataset-tab.tsx           ← character grid + scenario list
      generate-tab.tsx          ← two-panel conversation viewer
      judge-tab.tsx             ← accuracy bars + confusion table
      reconstruct-tab.tsx       ← per-character cards + sparklines
      drift-tab.tsx             ← per-conversation cards + sparklines
      sparkline.tsx             ← shared 3-point Recharts wrapper

frontend/app/api/evaluation/
  datasets/route.ts
  [dataset]/[evalName]/[pass]/route.ts
```

---

## 9. Out of Scope

- Triggering pipeline runs from the UI (read-only for now)
- Comparing two eval sets side by side
- Authentication beyond the email allowlist (no role model, no DB table)
- Exporting results to CSV/PDF
