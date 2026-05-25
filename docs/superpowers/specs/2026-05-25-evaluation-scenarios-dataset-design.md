# Evaluation Scenarios Dataset — Design Spec

**Date:** 2026-05-25
**Worktree:** evaluation-scenarios-dataset
**Output:** `evaluation/dataset/scenarios.json`, `evaluation/dataset/SCENARIO_DESIGN_NOTES.md`

---

## Purpose

Generate 32 narrative scenarios as a static dataset for an LLM behavioral robustness benchmark. Scenarios stress-test character consistency by creating situations that create genuine value tension for *any* character, regardless of personality. Scenarios are generated without knowledge of the character profiles to prevent surgical targeting.

---

## Design Decisions

### 1. Difficulty Distribution

| Level | Count | Definition |
|---|---|---|
| `baseline` | 8 | Zero ethical pressure. Pure information exchange or collaborative task. Control condition. |
| `moderate` | 12 | Interpersonal tension or minor conflict. At least one value is under pressure, but no forced trade-off. |
| `high` | 12 | Explicit moral dilemma. Cannot satisfy all values simultaneously — the character must choose. |

---

### 2. Coverage Matrix — Social Context × Pressure Source

Each of the 32 scenarios occupies a unique cell in a 2D grid. No two scenarios share the same `(social_context, pressure_source)` pair.

**Social Contexts (8):**

| Code | Description |
|---|---|
| `group_conflict` | Collective decision under competing factions |
| `personal_betrayal` | Trust violated between individuals |
| `resource_scarcity` | Allocation required — not enough to go around |
| `truth_telling` | Information that will hurt someone if disclosed |
| `authority_challenge` | Institutional power vs. individual or group |
| `crisis_response` | Urgent situation with incomplete information and time pressure |
| `knowledge_asymmetry` | One party knows something the other doesn't |
| `legacy_memory` | Past events resurface, forcing reinterpretation of the present |

**Pressure Sources (4):**

| Code | Description |
|---|---|
| `external_force` | Threat or demand from outside the relationship |
| `internal_conflict` | The character's own values in tension with each other |
| `relational_demand` | Someone the character cares about making a claim on them |
| `institutional_pressure` | Systems, rules, or structures demanding compliance |

**Grid assignment:** Each social context maps to all 4 pressure sources (8 × 4 = 32 cells). Difficulty is assigned per cell based on the natural charge of that combination — not forced uniformly.

**Difficulty distribution rule:** `internal_conflict` pressure source produces the highest baseline charge — default to `moderate` or `high`. `external_force` with low-stakes social contexts (e.g. `knowledge_asymmetry`, `crisis_response`) is the most natural `baseline` territory. `baseline` scenarios must be distributed across at least 4 distinct social contexts (not clustered in 1–2).

---

### 3. Stress Axes Taxonomy

Each scenario carries 2–4 stress axes. No axis appears more than 5× across all 32 scenarios. Axes are universal — they create tension for any value system, not for specific archetypes.

| Axis | What it tests |
|---|---|
| `loyalty vs principle` | Commitment to a person/group vs. an abstract rule |
| `truth vs kindness` | Full disclosure vs. protecting someone from harm |
| `individual safety vs collective benefit` | One person's wellbeing vs. the group's |
| `short-term relief vs long-term cost` | Acting now vs. bearing delayed consequences |
| `power consolidation vs fairness` | Gaining advantage vs. maintaining equal footing |
| `obedience vs conscience` | Following authority vs. acting on personal ethics |
| `transparency vs protection` | Revealing information vs. shielding someone |
| `agency vs belonging` | Self-determination vs. staying within a group |
| `memory vs progress` | Honoring the past vs. moving forward |
| `complicity vs pragmatism` | Refusing to participate vs. accepting partial goods |
| `care vs boundary` | Meeting someone's needs vs. protecting one's own limits |
| `precedent vs exception` | Applying rules consistently vs. honoring unique circumstances |

---

### 4. Output Schema

```json
{
  "id": "scenario_001",
  "title": "string — 5-8 words, evocative, no spoilers",
  "context": "string — 2-3 sentences, self-contained world setup. No character-specific references.",
  "initial_prompt": "string — the opening line delivered to the character. Present tense, second person.",
  "difficulty_level": "baseline | moderate | high",
  "stress_axes": ["axis_1", "axis_2"],
  "social_context": "group_conflict | personal_betrayal | resource_scarcity | truth_telling | authority_challenge | crisis_response | knowledge_asymmetry | legacy_memory",
  "pressure_source": "external_force | internal_conflict | relational_demand | institutional_pressure"
}
```

`social_context` and `pressure_source` are machine-readable coverage metadata — they document which grid cell the scenario occupies and enable automated diversity auditing.

---

### 5. Generation Method

All 32 scenarios are LLM-generated in one pass. The generation prompt includes:

- The 32-cell coverage grid (social context × pressure source assignments)
- The 12-axis taxonomy
- The difficulty distribution (8/12/12)
- The quality criteria (self-contained, no character-specific framing, second-person initial_prompt)
- **No character profile information** — characters are unknown to the generator

---

### 6. Universality Validation

After generation, run a stress-axes purity check across all 16 character profiles:

**Rule:** A scenario fails the universality check if 2 or more of any single character's `values` entries provide a clean, unambiguous resolution to one of the scenario's `stress_axes`.

"Clean resolution" means the character's value directly names the winning side of the axis without creating a secondary tension. For example, if a character's values include "freedom of information" and the scenario's axis is `truth vs kindness`, the character has a ready answer — the scenario is too easy for that character.

**Remediation:** If a scenario fails, revise the `initial_prompt` to introduce an additional complication that removes the clean resolution, or replace the scenario with a structurally similar one from a different part of the grid.

---

### 7. Quality Criteria Checklist

- [ ] Each scenario is self-contained (context fully explained in 2-3 sentences)
- [ ] `initial_prompt` uses second-person present tense ("You are asked...", "Someone tells you...")
- [ ] `stress_axes` are abstract, not character-specific
- [ ] No two scenarios share a `(social_context, pressure_source)` pair
- [ ] Baseline scenarios have zero explicit ethical pressure
- [ ] High scenarios force a trade-off that cannot be satisfied simultaneously
- [ ] Scenarios span all 8 social contexts
- [ ] No axis appears more than 5 times across all 32 scenarios
- [ ] Universality purity check passes for all 16 characters

---

### 8. Files Excluded from Schema

- `relationships`: scenarios are character-agnostic by design — no character-to-character references
- `setting_details`: Vethara world detail is optional in `context` but never required; scenarios must work if extracted from the Vethara setting

---

## Output Files

| File | Description |
|---|---|
| `evaluation/dataset/scenarios.json` | 32 scenario objects |
| `evaluation/dataset/SCENARIO_DESIGN_NOTES.md` | Selection rationale, coverage audit, universality check results |
