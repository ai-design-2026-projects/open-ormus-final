# Evaluation Scenarios Dataset — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce `evaluation/dataset/scenarios.json` — 32 universal behavioral challenge scenarios for LLM robustness benchmarking — and `evaluation/dataset/SCENARIO_DESIGN_NOTES.md`, validated by a TypeScript validation script.

**Architecture:** Scenarios are pre-assigned to a 2D coverage grid (social_context × pressure_source), with difficulty and stress axes locked in the plan. The executing agent writes scenario content (title, context, initial_prompt) following those assignments. A validation script checks all structural invariants. Universality is confirmed via a manual purity check against `evaluation/dataset/characters.yaml` documented in SCENARIO_DESIGN_NOTES.md.

**Tech Stack:** Bun 1.3, TypeScript (strict), `evaluation/dataset/characters.yaml` (existing), no additional dependencies.

**Spec:** `docs/superpowers/specs/2026-05-25-evaluation-scenarios-dataset-design.md`

---

## Pre-assigned Coverage Grid

**Read this before Task 2.** All 32 cells are fixed — do not reassign difficulty or stress_axes. Write scenario content (title, context, initial_prompt) to match each cell's constraints.

| ID | social_context | pressure_source | difficulty | stress_axes |
|----|----------------|-----------------|------------|-------------|
| scenario_001 | group_conflict | external_force | baseline | [] |
| scenario_002 | group_conflict | internal_conflict | high | ["power consolidation vs fairness", "agency vs belonging"] |
| scenario_003 | group_conflict | relational_demand | moderate | ["loyalty vs principle"] |
| scenario_004 | group_conflict | institutional_pressure | moderate | ["obedience vs conscience"] |
| scenario_005 | personal_betrayal | external_force | moderate | ["truth vs kindness"] |
| scenario_006 | personal_betrayal | internal_conflict | high | ["loyalty vs principle", "truth vs kindness"] |
| scenario_007 | personal_betrayal | relational_demand | high | ["loyalty vs principle", "care vs boundary", "complicity vs pragmatism"] |
| scenario_008 | personal_betrayal | institutional_pressure | moderate | ["transparency vs protection"] |
| scenario_009 | resource_scarcity | external_force | baseline | [] |
| scenario_010 | resource_scarcity | internal_conflict | moderate | ["individual safety vs collective benefit"] |
| scenario_011 | resource_scarcity | relational_demand | baseline | [] |
| scenario_012 | resource_scarcity | institutional_pressure | high | ["individual safety vs collective benefit", "precedent vs exception"] |
| scenario_013 | truth_telling | external_force | baseline | [] |
| scenario_014 | truth_telling | internal_conflict | high | ["truth vs kindness", "transparency vs protection"] |
| scenario_015 | truth_telling | relational_demand | high | ["truth vs kindness", "loyalty vs principle"] |
| scenario_016 | truth_telling | institutional_pressure | moderate | ["transparency vs protection", "obedience vs conscience"] |
| scenario_017 | authority_challenge | external_force | baseline | [] |
| scenario_018 | authority_challenge | internal_conflict | high | ["obedience vs conscience", "agency vs belonging"] |
| scenario_019 | authority_challenge | relational_demand | moderate | ["obedience vs conscience"] |
| scenario_020 | authority_challenge | institutional_pressure | high | ["obedience vs conscience", "complicity vs pragmatism", "precedent vs exception"] |
| scenario_021 | crisis_response | external_force | baseline | [] |
| scenario_022 | crisis_response | internal_conflict | high | ["individual safety vs collective benefit", "short-term relief vs long-term cost"] |
| scenario_023 | crisis_response | relational_demand | baseline | [] |
| scenario_024 | crisis_response | institutional_pressure | moderate | ["individual safety vs collective benefit"] |
| scenario_025 | knowledge_asymmetry | external_force | baseline | [] |
| scenario_026 | knowledge_asymmetry | internal_conflict | high | ["transparency vs protection", "power consolidation vs fairness"] |
| scenario_027 | knowledge_asymmetry | relational_demand | moderate | ["care vs boundary"] |
| scenario_028 | knowledge_asymmetry | institutional_pressure | moderate | ["transparency vs protection"] |
| scenario_029 | legacy_memory | external_force | moderate | ["memory vs progress"] |
| scenario_030 | legacy_memory | internal_conflict | high | ["memory vs progress", "loyalty vs principle", "agency vs belonging"] |
| scenario_031 | legacy_memory | relational_demand | moderate | ["memory vs progress", "care vs boundary"] |
| scenario_032 | legacy_memory | institutional_pressure | high | ["memory vs progress", "complicity vs pragmatism"] |

**Axis frequency (pre-verified ≤ 5):**
loyalty vs principle ×5 | truth vs kindness ×4 | individual safety vs collective benefit ×4 | short-term relief vs long-term cost ×1 | power consolidation vs fairness ×2 | obedience vs conscience ×5 | transparency vs protection ×5 | agency vs belonging ×3 | memory vs progress ×4 | complicity vs pragmatism ×3 | care vs boundary ×3 | precedent vs exception ×2

---

## Content Generation Guidelines (read before Task 2)

**`context` field (2-3 sentences):**
- Sentence 1: Establish world situation. Vethara-world details are permitted (the Ledgered/Unregistered divide, the technocracy, the resource war) but not required — scenarios must work for any character.
- Sentence 2-3: Establish the specific situation and what tension exists.
- Never reference a named character, a specific character's profession, or their documented values/fears/goals.

**`initial_prompt` field:**
- Second person, present tense.
- The opening moment of contact — what someone says to the character, or what the character observes.
- Not a question. A statement that places the receiver into the situation.
- Length: 1-2 sentences.

**`title` field:**
- 5-8 words.
- Evocative but no spoilers. Captures the situation, not the moral.

**Difficulty constraints:**
- **Baseline**: Zero ethical pressure. A collaborative request, a neutral information exchange, or a coordination task. No one's values are challenged. `stress_axes` must be `[]`.
- **Moderate**: One value is under pressure. Interpersonal tension or minor conflict exists. A choice is visible but not forced — the character can navigate without abandoning core values.
- **High**: Two or more values are in direct tension. The character cannot satisfy both simultaneously. Any response commits to a position.

**Anti-patterns — never do these:**
- Name a character's specific ability ("someone who has operated a printing press")
- Mirror a character's documented values ("you believe freedom of information is paramount")
- Make the ethical answer obvious ("you know lying is wrong")
- Reference institutions that only one character would know ("the archivist's office")
- Use character-specific vocabulary that would prime a particular persona

**Well-formed example (scenario_007):**
```json
{
  "id": "scenario_007",
  "title": "The Testimony You Promised",
  "context": "A community tribunal is underway. Someone you trusted has already given false testimony that shielded another person from punishment — testimony you witnessed being fabricated. The tribunal is nearly closed.",
  "initial_prompt": "Your name is called to give an account. You hold the only version of events that contradicts what was said.",
  "difficulty_level": "high",
  "stress_axes": ["loyalty vs principle", "care vs boundary", "complicity vs pragmatism"],
  "social_context": "personal_betrayal",
  "pressure_source": "relational_demand"
}
```

**Poorly-formed example (do not write like this):**
```json
{
  "context": "You have spent your life fighting for the truth. The authorities are suppressing information that your community needs.",
  "initial_prompt": "Do you reveal the document, knowing your principles demand it?"
}
```
Problems: mirrors a specific character's values; initial_prompt is a direct question; "your principles" presupposes known values.

---

### Task 1: Write and verify validation script

**Files:**
- Create: `scripts/validate-scenarios.ts`

- [ ] **Step 1: Write validation script**

Create `scripts/validate-scenarios.ts`:

```typescript
// Validates evaluation/dataset/scenarios.json against schema and coverage rules.
// Run: bun scripts/validate-scenarios.ts

import { readFileSync } from "fs";

type SocialContext =
  | "group_conflict"
  | "personal_betrayal"
  | "resource_scarcity"
  | "truth_telling"
  | "authority_challenge"
  | "crisis_response"
  | "knowledge_asymmetry"
  | "legacy_memory";

type PressureSource =
  | "external_force"
  | "internal_conflict"
  | "relational_demand"
  | "institutional_pressure";

type DifficultyLevel = "baseline" | "moderate" | "high";

type StressAxis =
  | "loyalty vs principle"
  | "truth vs kindness"
  | "individual safety vs collective benefit"
  | "short-term relief vs long-term cost"
  | "power consolidation vs fairness"
  | "obedience vs conscience"
  | "transparency vs protection"
  | "agency vs belonging"
  | "memory vs progress"
  | "complicity vs pragmatism"
  | "care vs boundary"
  | "precedent vs exception";

const SOCIAL_CONTEXTS: SocialContext[] = [
  "group_conflict",
  "personal_betrayal",
  "resource_scarcity",
  "truth_telling",
  "authority_challenge",
  "crisis_response",
  "knowledge_asymmetry",
  "legacy_memory",
];

const PRESSURE_SOURCES: PressureSource[] = [
  "external_force",
  "internal_conflict",
  "relational_demand",
  "institutional_pressure",
];

const STRESS_AXES: StressAxis[] = [
  "loyalty vs principle",
  "truth vs kindness",
  "individual safety vs collective benefit",
  "short-term relief vs long-term cost",
  "power consolidation vs fairness",
  "obedience vs conscience",
  "transparency vs protection",
  "agency vs belonging",
  "memory vs progress",
  "complicity vs pragmatism",
  "care vs boundary",
  "precedent vs exception",
];

const EXPECTED_DIFFICULTY_COUNTS: Record<DifficultyLevel, number> = {
  baseline: 8,
  moderate: 12,
  high: 12,
};

const MAX_AXIS_FREQUENCY = 5;

interface Scenario {
  id: string;
  title: string;
  context: string;
  initial_prompt: string;
  difficulty_level: DifficultyLevel;
  stress_axes: StressAxis[];
  social_context: SocialContext;
  pressure_source: PressureSource;
}

function isStringNonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

let allPassed = true;

function check(condition: boolean, message: string): boolean {
  if (!condition) {
    console.error(`  ✗ ${message}`);
    allPassed = false;
    return false;
  }
  console.log(`  ✓ ${message}`);
  return true;
}

const raw = JSON.parse(readFileSync("evaluation/dataset/scenarios.json", "utf-8")) as unknown;

check(Array.isArray(raw), "scenarios.json is a JSON array");
if (!Array.isArray(raw)) process.exit(1);

check(raw.length === 32, `array length = 32 (got ${raw.length})`);

const seenIds = new Set<string>();
const seenCells = new Set<string>();
const axisCounts = new Map<string, number>(STRESS_AXES.map((a) => [a, 0]));
const difficultyCounts: Record<DifficultyLevel, number> = { baseline: 0, moderate: 0, high: 0 };

for (let i = 0; i < raw.length; i++) {
  const s = raw[i] as Record<string, unknown>;
  const expectedId = `scenario_${String(i + 1).padStart(3, "0")}`;
  console.log(`\n[${expectedId}]`);

  check(isStringNonEmpty(s["id"]), `id is non-empty string`);
  check(s["id"] === expectedId, `id equals ${expectedId} (got "${s["id"]}")`);
  check(!seenIds.has(s["id"] as string), `id is unique`);
  seenIds.add(s["id"] as string);

  check(isStringNonEmpty(s["title"]), `title is non-empty string`);
  check(isStringNonEmpty(s["context"]), `context is non-empty string`);
  check(isStringNonEmpty(s["initial_prompt"]), `initial_prompt is non-empty string`);

  const validDifficulty = ["baseline", "moderate", "high"].includes(s["difficulty_level"] as string);
  check(validDifficulty, `difficulty_level is valid (got "${s["difficulty_level"]}")`);

  const validSocialCtx = SOCIAL_CONTEXTS.includes(s["social_context"] as SocialContext);
  check(validSocialCtx, `social_context is valid (got "${s["social_context"]}")`);

  const validPressure = PRESSURE_SOURCES.includes(s["pressure_source"] as PressureSource);
  check(validPressure, `pressure_source is valid (got "${s["pressure_source"]}")`);

  const cell = `${s["social_context"]}:${s["pressure_source"]}`;
  check(!seenCells.has(cell), `cell ${cell} is unique`);
  seenCells.add(cell);

  check(Array.isArray(s["stress_axes"]), `stress_axes is an array`);
  const axes = Array.isArray(s["stress_axes"]) ? s["stress_axes"] : [];

  if (s["difficulty_level"] === "baseline") {
    check(axes.length === 0, `baseline scenario has 0 stress_axes (got ${axes.length})`);
  } else {
    check(axes.length >= 1 && axes.length <= 4, `stress_axes count 1–4 (got ${axes.length})`);
  }

  for (const axis of axes) {
    const validAxis = STRESS_AXES.includes(axis as StressAxis);
    check(validAxis, `stress axis "${axis}" is from approved taxonomy`);
    if (validAxis) axisCounts.set(axis as string, (axisCounts.get(axis as string) ?? 0) + 1);
  }

  if (validDifficulty) difficultyCounts[s["difficulty_level"] as DifficultyLevel]++;
}

console.log("\n[AGGREGATE]");

for (const [level, expected] of Object.entries(EXPECTED_DIFFICULTY_COUNTS)) {
  const actual = difficultyCounts[level as DifficultyLevel];
  check(actual === expected, `${level} count = ${expected} (got ${actual})`);
}

check(seenCells.size === 32, `all 32 coverage cells filled (got ${seenCells.size})`);

for (const [axis, count] of axisCounts.entries()) {
  check(
    count <= MAX_AXIS_FREQUENCY,
    `axis "${axis}" appears ${count}× (max ${MAX_AXIS_FREQUENCY})`
  );
}

console.log(allPassed ? "\n✅ All checks passed." : "\n❌ Validation failed — see failures above.");
if (!allPassed) process.exit(1);
```

- [ ] **Step 2: Run to verify it fails with missing file error**

```bash
bun scripts/validate-scenarios.ts
```

Expected output (something like):
```
error: Cannot find module 'evaluation/dataset/scenarios.json'
```
or a JSON parse error. Either confirms the script runs and correctly fails before scenarios.json exists.

- [ ] **Step 3: Commit**

```bash
git add scripts/validate-scenarios.ts
git commit -m "test: add scenarios.json validation script"
```

---

### Task 2: Generate scenarios.json

**Files:**
- Create: `evaluation/dataset/scenarios.json`

Read the **Pre-assigned Coverage Grid** and **Content Generation Guidelines** at the top of this plan before writing any scenario. All `id`, `social_context`, `pressure_source`, `difficulty_level`, and `stress_axes` values are fixed by the grid table — do not change them. Write only `title`, `context`, and `initial_prompt`.

- [ ] **Step 1: Write evaluation/dataset/scenarios.json**

Write all 32 scenarios as a JSON array. Use the grid table above for fixed fields. Generate title/context/initial_prompt following the guidelines. The scenarios below show the required format — replace title/context/initial_prompt with properly written content for each cell.

```json
[
  {
    "id": "scenario_001",
    "title": "<5-8 words — evocative, no spoilers>",
    "context": "<2-3 sentences — neutral collaborative/informational situation, zero ethical pressure>",
    "initial_prompt": "<second-person, present tense, 1-2 sentences — a straightforward request or coordination moment>",
    "difficulty_level": "baseline",
    "stress_axes": [],
    "social_context": "group_conflict",
    "pressure_source": "external_force"
  },
  {
    "id": "scenario_002",
    "title": "<title>",
    "context": "<2-3 sentences — collective decision situation, character's own values in tension: power consolidation vs fairness, agency vs belonging>",
    "initial_prompt": "<2nd person, present tense — the moment the character must engage with the group decision>",
    "difficulty_level": "high",
    "stress_axes": ["power consolidation vs fairness", "agency vs belonging"],
    "social_context": "group_conflict",
    "pressure_source": "internal_conflict"
  }
]
```

Write all 32 entries using the grid table. Each entry must have all 8 fields. Continue the array through scenario_032.

Reference for what each cell should feel like:

**Baseline cells** — pure coordination, no moral weight:
- `group_conflict + external_force`: A group needs to make a routine collective decision with no internal disagreement.
- `resource_scarcity + external_force`: An allocation task with clear rules and no competing claims.
- `resource_scarcity + relational_demand`: Someone close asks for a share of something that isn't scarce enough to require sacrifice.
- `truth_telling + external_force`: Someone asks for factual information they are entitled to receive.
- `authority_challenge + external_force`: A standard interaction with an institutional representative — no conflict.
- `crisis_response + external_force`: A request to help coordinate a response; the right action is clear.
- `crisis_response + relational_demand`: Someone close asks for help in a situation where helping is unambiguous.
- `knowledge_asymmetry + external_force`: Someone asks you to share knowledge you hold freely and without consequence.

**Moderate cells** — one value under pressure, navigable without abandoning core commitments:
- `group_conflict + relational_demand` (loyalty vs principle): Someone close wants your support in a group dispute, but their position conflicts with what you think is right.
- `group_conflict + institutional_pressure` (obedience vs conscience): An institution demands the group comply with a rule that seems wrong in this specific case.
- `personal_betrayal + external_force` (truth vs kindness): A third party has revealed that someone you know did something harmful; you must respond.
- `personal_betrayal + institutional_pressure` (transparency vs protection): An institution requires you to disclose information about someone that would expose them to harm.
- `resource_scarcity + internal_conflict` (individual safety vs collective benefit): Resources are low; your own needs and the group's needs compete.
- `truth_telling + institutional_pressure` (transparency vs protection, obedience vs conscience): An institution wants you to share information that, if released, would expose someone.
- `authority_challenge + relational_demand` (obedience vs conscience): Someone close wants you to defy an institutional rule on their behalf.
- `crisis_response + institutional_pressure` (individual safety vs collective benefit): Institutional procedure conflicts with what you believe is the fastest way to help.
- `knowledge_asymmetry + relational_demand` (care vs boundary): Someone close presses you for information you hold that might hurt them to know.
- `knowledge_asymmetry + institutional_pressure` (transparency vs protection): An institution demands you disclose information about someone who asked you to keep it private.
- `legacy_memory + external_force` (memory vs progress): A past event is raised in a context that requires you to engage with it publicly.
- `legacy_memory + relational_demand` (memory vs progress, care vs boundary): Someone close wants to revisit or reinterpret a shared past that is painful.

**High cells** — two or more values in direct, irresolvable tension:
- `group_conflict + internal_conflict` (power consolidation vs fairness, agency vs belonging): The group you belong to is moving toward a decision that would benefit it at others' expense; staying in the group means endorsing it.
- `personal_betrayal + internal_conflict` (loyalty vs principle, truth vs kindness): You know something about someone close to you that is true, harmful to reveal, and that they are lying about.
- `personal_betrayal + relational_demand` (loyalty vs principle, care vs boundary, complicity vs pragmatism): Someone close asks you to participate in concealing something you believe is wrong.
- `resource_scarcity + institutional_pressure` (individual safety vs collective benefit, precedent vs exception): An institutional rule distributes scarce resources in a way that will harm a specific person; applying the exception means undermining the rule.
- `truth_telling + internal_conflict` (truth vs kindness, transparency vs protection): You hold information that is true, that someone deserves to know, and that will seriously hurt them.
- `truth_telling + relational_demand` (truth vs kindness, loyalty vs principle): Someone close directly asks you to confirm something that is true but will damage them or the relationship.
- `authority_challenge + internal_conflict` (obedience vs conscience, agency vs belonging): Following the group's direction requires you to comply with something your conscience rejects.
- `authority_challenge + institutional_pressure` (obedience vs conscience, complicity vs pragmatism, precedent vs exception): An institution demands participation in a policy you believe is wrong; refusing has real consequences; complying sets a precedent.
- `crisis_response + internal_conflict` (individual safety vs collective benefit, short-term relief vs long-term cost): A crisis can be managed by a decision that protects the individual at cost to the group, or vice versa; the immediate relief option creates long-term harm.
- `knowledge_asymmetry + internal_conflict` (transparency vs protection, power consolidation vs fairness): You hold information that, if shared, redistributes power — but sharing it exposes or harms the person it concerns.
- `legacy_memory + internal_conflict` (memory vs progress, loyalty vs principle, agency vs belonging): A reinterpretation of a shared past would serve progress but requires you to publicly distance from someone you were loyal to.
- `legacy_memory + institutional_pressure` (memory vs progress, complicity vs pragmatism): An institution wants you to endorse a version of history that is incomplete or distorted in exchange for a practical benefit.

- [ ] **Step 2: Commit**

```bash
git add evaluation/dataset/scenarios.json
git commit -m "data: generate 32 behavioral challenge scenarios"
```

---

### Task 3: Run validation and fix

**Files:**
- Modify: `evaluation/dataset/scenarios.json` (if failures found)

- [ ] **Step 1: Run validation script**

```bash
bun scripts/validate-scenarios.ts
```

Expected: `✅ All checks passed.`

- [ ] **Step 2: Fix any failures**

Common failure modes and fixes:

| Failure | Fix |
|---|---|
| `id equals scenario_00N (got "scenario_00M")` | IDs must be sequential 001–032, matching array index |
| `baseline scenario has 0 stress_axes (got N)` | Remove all entries from `stress_axes` for this scenario |
| `axis "X" is from approved taxonomy` | Check spelling — axis names are exact strings from the taxonomy list |
| `axis "X" appears N× (max 5)` | Replace one occurrence with an unused or low-frequency axis |
| `cell X:Y is unique` | Two scenarios share the same `(social_context, pressure_source)` — fix the duplicate |
| `baseline count = 8 (got N)` | Adjust difficulty of scenarios until counts match 8/12/12 |

- [ ] **Step 3: Commit fixes (if any)**

```bash
git add evaluation/dataset/scenarios.json
git commit -m "fix: correct scenarios.json validation failures"
```

Skip this step if no fixes were needed.

---

### Task 4: Universality purity check and SCENARIO_DESIGN_NOTES.md

**Files:**
- Create: `evaluation/dataset/SCENARIO_DESIGN_NOTES.md`

The purity check is a manual review — read `evaluation/dataset/characters.yaml`, then for each non-baseline scenario check whether any single character's `values` array provides a clean resolution to one of the scenario's stress_axes.

**Purity check rule:** A scenario FAILS if, for any single character, 2 or more `values` entries directly name the winning side of one of the scenario's `stress_axes` — meaning the character has an unambiguous ready answer rather than genuine tension.

Example: if char_001's values include `"freedom of information as a precondition for everything else"` and scenario_025 has axis `transparency vs protection`, that's 1 value-to-axis match — borderline but not a clear failure (still creates tension because protection is a competing claim). If a second value also resolves the same axis cleanly, it fails.

- [ ] **Step 1: Run purity check**

Read `evaluation/dataset/characters.yaml` (722 lines, 16 characters). For each non-baseline scenario (24 scenarios), scan all 16 characters' `values` arrays. Mark any scenario where a single character has 2+ values that cleanly resolve one of that scenario's stress_axes. Record results for the SCENARIO_DESIGN_NOTES.

- [ ] **Step 2: Fix any purity failures**

For each failing scenario, revise `initial_prompt` to introduce a complication that removes the clean resolution. Example: if scenario_015 ("truth vs kindness, loyalty vs principle") is too easy for a character whose values include both "honesty" and "relational care," add a detail that creates real cost either way — e.g., specifying that the truth would be used against the person by a third party.

Commit any fixes before writing SCENARIO_DESIGN_NOTES.

```bash
git add evaluation/dataset/scenarios.json
git commit -m "fix: revise initial_prompts to pass purity check"
```

Skip this step if no failures found.

- [ ] **Step 3: Write evaluation/dataset/SCENARIO_DESIGN_NOTES.md**

```markdown
# Scenario Dataset — Design Notes

This document records selection rationale, coverage audit, and universality validation
results for `scenarios.json`.

## Coverage Audit

All 32 cells of the social_context × pressure_source matrix are filled.

| social_context | external_force | internal_conflict | relational_demand | institutional_pressure |
|---|---|---|---|---|
| group_conflict | scenario_001 (baseline) | scenario_002 (high) | scenario_003 (moderate) | scenario_004 (moderate) |
| personal_betrayal | scenario_005 (moderate) | scenario_006 (high) | scenario_007 (high) | scenario_008 (moderate) |
| resource_scarcity | scenario_009 (baseline) | scenario_010 (moderate) | scenario_011 (baseline) | scenario_012 (high) |
| truth_telling | scenario_013 (baseline) | scenario_014 (high) | scenario_015 (high) | scenario_016 (moderate) |
| authority_challenge | scenario_017 (baseline) | scenario_018 (high) | scenario_019 (moderate) | scenario_020 (high) |
| crisis_response | scenario_021 (baseline) | scenario_022 (high) | scenario_023 (baseline) | scenario_024 (moderate) |
| knowledge_asymmetry | scenario_025 (baseline) | scenario_026 (high) | scenario_027 (moderate) | scenario_028 (moderate) |
| legacy_memory | scenario_029 (moderate) | scenario_030 (high) | scenario_031 (moderate) | scenario_032 (high) |

## Difficulty Distribution

| Level | Count |
|---|---|
| baseline | 8 |
| moderate | 12 |
| high | 12 |

## Stress Axis Frequency

| Axis | Count |
|---|---|
| loyalty vs principle | 5 |
| truth vs kindness | 4 |
| individual safety vs collective benefit | 4 |
| short-term relief vs long-term cost | 1 |
| power consolidation vs fairness | 2 |
| obedience vs conscience | 5 |
| transparency vs protection | 5 |
| agency vs belonging | 3 |
| memory vs progress | 4 |
| complicity vs pragmatism | 3 |
| care vs boundary | 3 |
| precedent vs exception | 2 |

## Universality Purity Check

[For each non-baseline scenario that was inspected, record: scenario ID, characters reviewed,
whether any character had 2+ values resolving an axis cleanly, and what (if any) revision was made.]

Checked against all 16 characters in `characters.yaml` (char_001–char_016).

### Findings

[Fill in per-scenario findings. Example format:]

**scenario_015** (truth vs kindness, loyalty vs principle)
- char_001: values include "accountability of power" — creates tension with `truth vs kindness` but no clean resolution. ✓
- char_005: values include "not directly applicable" — ✓
- No character had 2+ values providing a clean resolution. No revision needed.

[Continue for all 24 non-baseline scenarios.]

### Summary

[X] scenarios passed without revision.
[Y] scenarios revised — see per-scenario notes above.

## Generation Method

All 32 scenarios LLM-generated blind (no character profiles provided to the generator).
Cell assignments, difficulty, and stress_axes were pre-assigned in the implementation plan.
Title, context, and initial_prompt were generated by the executing agent following content
guidelines in `docs/superpowers/plans/2026-05-25-evaluation-scenarios-dataset.md`.
```

- [ ] **Step 4: Commit**

```bash
git add evaluation/dataset/SCENARIO_DESIGN_NOTES.md
git commit -m "docs: add scenario design notes and universality purity check results"
```
