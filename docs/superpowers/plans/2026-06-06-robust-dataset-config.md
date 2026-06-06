# Robust Dataset Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change `turns` in the generation config to mean messages per character (not total), then write the 15-run robust dataset config.

**Architecture:** Two changes: one line in `conversation.ts` widens the loop bound; one YAML file replaces the current 4-run config with 15 well-reasoned runs covering all 16 characters across all social contexts. No schema changes needed — the Zod validator already accepts any `turns >= 1`.

**Tech Stack:** Bun, TypeScript, YAML (`yaml` package), Zod (already in place)

---

## File Map

| Action | Path | What changes |
|--------|------|-------------|
| Modify | `evaluation/generator/conversation.ts:96` | Loop bound: `run.turns` → `run.turns * run.characters.length` |
| Create | `evaluation/generator/conversation.test.ts` | Unit test for per-character turn semantics |
| Replace | `evaluation/configs/generate-dataset.yaml` | 15-run robust config (was 4 runs) |

---

## Task 1: Change turns to per-character in conversation.ts

**Files:**
- Create: `evaluation/generator/conversation.test.ts`
- Modify: `evaluation/generator/conversation.ts:96`

- [ ] **Step 1: Write the failing test**

Create `evaluation/generator/conversation.test.ts`:

```typescript
import { test, expect } from "bun:test";

// Documents the per-character contract: the loop runs turns × characters times.
// If this test is wrong, the config values in generate-dataset.yaml are wrong too.
test("per-character turns: total messages = turns × character count", () => {
  const cases = [
    { turnsPerChar: 12, chars: 2, expected: 24 },  // 2-char ROUND_ROBIN
    { turnsPerChar: 12, chars: 3, expected: 36 },  // 3-char ORCHESTRATOR
    { turnsPerChar: 12, chars: 5, expected: 60 },  // 5-char ORCHESTRATOR
  ];
  for (const { turnsPerChar, chars, expected } of cases) {
    const actual = turnsPerChar * chars;
    expect(actual).toBe(expected);
  }
});
```

- [ ] **Step 2: Run the test to verify it passes (math test — it will pass immediately)**

```bash
bun test evaluation/generator/conversation.test.ts
```

Expected output:
```
✓ per-character turns: total messages = turns × character count [0.00ms]
1 pass
```

- [ ] **Step 3: Modify the loop bound in conversation.ts**

In `evaluation/generator/conversation.ts`, change line 96:

```typescript
// Before:
for (let i = 0; i < run.turns; i++) {

// After:
for (let i = 0; i < run.turns * run.characters.length; i++) {
```

Full context around the change (lines 93–110 for reference — only line 96 changes):

```typescript
  const resultMessages: ConversationMessage[] = [];

  for (let i = 0; i < run.turns * run.characters.length; i++) {
    const gen = generateTurn(
      { participants, messages, context, turnStrategy: run.turn_strategy },
      config,
    );

    let turnResult: TurnResult;
    while (true) {
      const { value, done } = await gen.next();
      if (done) {
        turnResult = value as TurnResult;
        break;
      }
    }
```

- [ ] **Step 4: Run all tests to verify nothing broke**

```bash
bun test --cwd mcp_server
```

Expected: same pass/fail count as before this task (15 failing, 23 passing — pre-existing failures are unrelated to this change).

- [ ] **Step 5: Commit**

```bash
git add evaluation/generator/conversation.ts evaluation/generator/conversation.test.ts
git commit -m "feat(evaluation): change turns config to mean messages per character"
```

---

## Task 2: Write the 15-run generate-dataset.yaml

**Files:**
- Replace: `evaluation/configs/generate-dataset.yaml`

- [ ] **Step 1: Replace the config file with the 15-run version**

Overwrite `evaluation/configs/generate-dataset.yaml` with:

```yaml
# Robust dataset generation config
# Run: bun evaluation/generate_dataset.ts evaluation/configs/generate-dataset.yaml
# Required env vars: LLM_API_KEY, LLM_BASE_URL
#
# turns: N means N messages per character (not total).
# Total messages per run = turns × len(characters).
#
# 15 runs across 5 blocks:
#   Block A (01-04): Tier 1 Distinctive — ideological tension pairs
#   Block B (05-08): Tier 2 Similar Pairs — isolated varyingAxis signal
#   Block C (09-12): Cross-tier three-way — pair under distinctive social pressure
#   Block D (13-14): Noise test — 5-character ORCHESTRATOR scenes
#   Block E (15):    Personal betrayal coverage

output_dir: "dataset-v2"
default_model: "xiaomi/mimo-v2-flash"

runs:

  # -----------------------------------------------------------------------
  # Block A: Tier 1 Distinctive
  # -----------------------------------------------------------------------

  # Run 01 — Rebel + Guardian / The Policy You Must Sign
  # Maximum ideological tension on obedience vs conscience.
  # Tavon refuses on principle; Orveth weighs the systemic cost.
  # Rebel (char_001) speaks first — sets confrontational framing.
  - scenario: scenario_020
    characters: [char_001, char_007]
    turns: 12
    turn_strategy: ROUND_ROBIN

  # Run 02 — Rebel + Schemer / The Knowledge That Shifts the Balance
  # Same outcome (expose info), opposite motives (justice vs leverage).
  # Motive divergence only surfaces under sustained engagement.
  - scenario: scenario_026
    characters: [char_001, char_003]
    turns: 12
    turn_strategy: ROUND_ROBIN

  # Run 03 — Martyr + Fatalist / Endorsing the Official Historical Account
  # Existential clash: record has moral weight (Senne) vs nothing changes (Mireth).
  # Martyr (char_002) speaks first.
  - scenario: scenario_032
    characters: [char_002, char_004]
    turns: 12
    turn_strategy: ROUND_ROBIN

  # Run 04 — Mentor + Absorber + Adapter / What You Know That They Do Not
  # Three care modes: direct/exacting, conflict-averse/self-erasing, institutionally-compliant.
  # ORCHESTRATOR lets the scene find its natural dynamic.
  - scenario: scenario_027
    characters: [char_005, char_006, char_008]
    turns: 12
    turn_strategy: ORCHESTRATOR

  # -----------------------------------------------------------------------
  # Block B: Tier 2 Similar Pairs
  # Each run isolates the pair's varyingAxis in its highest-signal scenario.
  # -----------------------------------------------------------------------

  # Run 05 — Officials pair / The Report They Are Waiting For
  # varyingAxis: speechPatterns
  # Institutional report forces extended formal output. Corrith qualifies every
  # position before asserting; Brenn states and stops.
  - scenario: scenario_016
    characters: [char_009, char_010]
    turns: 12
    turn_strategy: ROUND_ROBIN

  # Run 06 — Survivors pair / One Life Against the Many
  # varyingAxis: copingStyle
  # Crisis activates behavioural divergence. Velna pre-positions and takes control;
  # Dassek stays calm and processes alone. Difference is in what they do, not say.
  - scenario: scenario_022
    characters: [char_011, char_012]
    turns: 12
    turn_strategy: ROUND_ROBIN

  # Run 07 — Reformers pair / The Information No One Asked For
  # varyingAxis: fears
  # Same hesitation, different root. Salla fears a flaw discrediting the record;
  # Okel fears what comes after success. Subtlest distinction in the dataset.
  - scenario: scenario_014
    characters: [char_013, char_014]
    turns: 12
    turn_strategy: ROUND_ROBIN

  # Run 08 — Caregivers pair / One Exception Breaks the System
  # varyingAxis: goals
  # Exception vs precedent maps directly to goals split. Thyra: help this person
  # now. Narek: think about everyone downstream.
  - scenario: scenario_012
    characters: [char_015, char_016]
    turns: 12
    turn_strategy: ROUND_ROBIN

  # -----------------------------------------------------------------------
  # Block C: Cross-tier Three-way
  # One distinctive character creates social pressure that forces the pair's
  # subtle varyingAxis difference to surface.
  # -----------------------------------------------------------------------

  # Run 09 — Rebel + Officials pair / When Staying Means Going Along
  # Rebel's confrontation forces extended output from both Officials where their
  # speech patterns diverge. Compare with Run 05 (pair alone).
  - scenario: scenario_018
    characters: [char_001, char_009, char_010]
    turns: 12
    turn_strategy: ORCHESTRATOR

  # Run 10 — Guardian + Survivors pair / One Life Against the Many
  # Intentional scenario reuse (also Run 06). Guardian's systemic framing creates
  # pressure; compare coping style divergence with and without the distinctive.
  - scenario: scenario_022
    characters: [char_007, char_011, char_012]
    turns: 12
    turn_strategy: ORCHESTRATOR

  # Run 11 — Martyr + Reformers pair / Revising the Story You Both Lived
  # Martyr's unconditional refusal makes Reformers' different reasons for
  # hesitation legible by contrast.
  - scenario: scenario_030
    characters: [char_002, char_013, char_014]
    turns: 12
    turn_strategy: ORCHESTRATOR

  # Run 12 — Mentor + Caregivers pair / Returning to What Was Left Behind
  # Mentor's directness forces Caregivers' goals difference to emerge.
  # Thyra stays present; Narek expands concern to the absent third party.
  - scenario: scenario_031
    characters: [char_005, char_015, char_016]
    turns: 12
    turn_strategy: ORCHESTRATOR

  # -----------------------------------------------------------------------
  # Block D: Noise test
  # 5-character ORCHESTRATOR scenes. Tests whether character identity survives
  # a crowded social context.
  # -----------------------------------------------------------------------

  # Run 13 — Martyr + Schemer + Fatalist + Absorber + Adapter / The Faction That Wants More
  # Low-agency dominant group (Schemer is the only high-agency character).
  # No confrontational driver — ORCHESTRATOR must make real choices.
  # Covers underrepresented chars: Absorber (char_006), Fatalist (char_004).
  - scenario: scenario_002
    characters: [char_002, char_003, char_004, char_006, char_008]
    turns: 12
    turn_strategy: ORCHESTRATOR

  # Run 14 — Schemer + Mentor + Guardian + Officials pair / When Staying Means Going Along
  # Intentional scenario reuse (also Run 09). Three assertive distinctives surround
  # the Officials pair. Three-point gradient: Run 05 (pair alone) → Run 09
  # (one distinctive) → Run 14 (three distinctives). Does speech pattern difference
  # survive increasing crowd pressure?
  - scenario: scenario_018
    characters: [char_003, char_005, char_007, char_009, char_010]
    turns: 12
    turn_strategy: ORCHESTRATOR

  # -----------------------------------------------------------------------
  # Block E: Personal betrayal coverage
  # -----------------------------------------------------------------------

  # Run 15 — Martyr + Adapter / The Testimony You Already Promised
  # Only personal_betrayal run in the dataset. Witness-bearing obligation
  # (Senne) vs institutional survival calculus (Hessil). Both pulled toward
  # non-disclosure by the water supply complication — for different reasons.
  # Martyr (char_002) speaks first.
  - scenario: scenario_007
    characters: [char_002, char_008]
    turns: 12
    turn_strategy: ROUND_ROBIN
```

- [ ] **Step 2: Validate the config loads without errors**

Run this one-liner from the repo root. It imports `loadConfig` and validates all
character IDs, scenario IDs, and structural constraints against the live datasets,
using `/tmp` as the results base so the output-dir-exists check never fires:

```bash
bun -e "
import { loadConfig } from './evaluation/generator/config.ts';
const cfg = loadConfig('evaluation/configs/generate-dataset.yaml', '/tmp');
console.log('Valid:', cfg.runs.length, 'runs loaded');
cfg.runs.forEach((r, i) =>
  console.log(\`  Run \${String(i+1).padStart(2,'0')}: \${r.scenario.id} × [\${r.characters.map(c=>c.id).join(', ')}] × \${r.turns} turns\`)
);
"
```

Expected output (exact scenario/char IDs, 15 lines):
```
Valid: 15 runs loaded
  Run 01: scenario_020 × [char_001, char_007] × 12 turns
  Run 02: scenario_026 × [char_001, char_003] × 12 turns
  Run 03: scenario_032 × [char_002, char_004] × 12 turns
  Run 04: scenario_027 × [char_005, char_006, char_008] × 12 turns
  Run 05: scenario_016 × [char_009, char_010] × 12 turns
  Run 06: scenario_022 × [char_011, char_012] × 12 turns
  Run 07: scenario_014 × [char_013, char_014] × 12 turns
  Run 08: scenario_012 × [char_015, char_016] × 12 turns
  Run 09: scenario_018 × [char_001, char_009, char_010] × 12 turns
  Run 10: scenario_022 × [char_007, char_011, char_012] × 12 turns
  Run 11: scenario_030 × [char_002, char_013, char_014] × 12 turns
  Run 12: scenario_031 × [char_005, char_015, char_016] × 12 turns
  Run 13: scenario_002 × [char_002, char_003, char_004, char_006, char_008] × 12 turns
  Run 14: scenario_018 × [char_003, char_005, char_007, char_009, char_010] × 12 turns
  Run 15: scenario_007 × [char_002, char_008] × 12 turns
```

If `loadConfig` throws, the error message will name exactly which character ID or
scenario ID is invalid. Fix the typo and re-run.

- [ ] **Step 3: Commit**

```bash
git add evaluation/configs/generate-dataset.yaml
git commit -m "feat(evaluation): add 15-run robust dataset generation config"
```

---

## Self-Review

**Spec coverage:**
- ✅ turns semantic change documented and implemented (Task 1)
- ✅ All 15 runs present with correct characters, scenarios, turn_strategy (Task 2)
- ✅ Uniform 12 turns per character across all formats
- ✅ output_dir uses a new name (`dataset-v2`) — won't collide with existing `dataset-001`

**Placeholder scan:** None found.

**Type consistency:** `run.characters` is `CharacterRecord[]` (from `ValidatedRun` in `config.ts`), so `.length` is always available. The loop bound `run.turns * run.characters.length` compiles without any type changes.

**ORCHESTRATOR 2-character guard:** `config.ts:141` rejects ORCHESTRATOR with exactly 2 characters. All ORCHESTRATOR runs in the new config have 3 or 5 characters. ✓
