# Robust Dataset Generation Config — Design

## Goal

Produce a generation config that creates the most representative evaluation dataset
for measuring LLM behavioural fidelity across all 16 characters and the full range
of scenario types. The dataset feeds all four evaluation passes: Judge Guessing,
Reconstruct Persona, Context Drift, and (implicitly) any future pass.

---

## Dataset Assessment

### Characters (16) — no additions, no removals

The 8 distinctive archetypes cover all cells of the 2D moral × agency grid
(Idealist/Cynic/Empath/Pragmatist × High/Low). The 4 similar pairs cover the
four most behaviourally legible varying axes (speechPatterns, copingStyle, fears,
goals). The set is complete and well-designed. No new characters are needed.

### Scenarios (32) — no additions, no removals

The 8 × 4 social_context × pressure_source matrix is fully filled. All non-baseline
scenarios passed or were revised to pass the universality purity check. No new
scenarios are needed. The generation config draws from the existing 32.

---

## Config Schema Change Required

**Current behaviour:** `turns: N` produces N total messages across all characters.

**Required behaviour:** `turns: N` must produce N messages *per character*, so that
turn count is independent of the number of characters in a run.

This is a one-line change in `evaluation/generator/conversation.ts`: replace the
fixed loop bound with `run.turns * run.characters.length`.

All turn values in this spec are expressed as **per-character counts**.

---

## Turn Counts by Format

**12 per character for all runs**, regardless of format. This gives:

| Format | Per-character turns | Total messages |
|--------|-------------------|----------------|
| 2-char ROUND_ROBIN | 12 | 24 |
| 3-char ORCHESTRATOR | 12 | 36 |
| 5-char ORCHESTRATOR | 12 | 60 |

12 is above the minimum for reliable field coverage (5–6) and below the point where
repetition becomes significant without pressure injection (~15+ per char). 60 total
messages for the 5-char noise runs is long but not wasteful — the extra turns beyond
~40 show whether character identity *holds* under sustained pressure, not just initially.

### Note on ORCHESTRATOR non-determinism

The orchestrator's speaker-selection call (`orchestrator.ts`) does not pass
`temperature`, so it uses the model default (~1.0). Only character dialogue generation
uses `temperature: 0`. ROUND_ROBIN runs are fully reproducible; ORCHESTRATOR runs
have variable turn ordering between executions, which is acceptable — realistic turn
distribution is a feature for the noise-test runs.

### Note on initial prompt attribution

The scenario `context + initial_prompt` is embedded in every character's system
prompt from turn 1. No character "receives" the prompt exclusively. In ROUND_ROBIN,
`participants[0]` always speaks first; character order in the config array matters
and is documented per-run below. In ORCHESTRATOR, the model picks the first speaker
from an empty history — high-agency characters will consistently initiate.

---

## The 15 Runs

### Block A — Tier 1 Distinctive (4 runs)

**Run 01** `char_001 + char_007` / `scenario_020` / ROUND_ROBIN / 12 turns each

*The Policy You Must Sign* — authority_challenge / institutional_pressure / high
Stress axes: obedience vs conscience, complicity vs pragmatism, precedent vs exception

Rebel speaks first (char_001 listed first). Maximum ideological tension: Tavon refuses
on principle and will not lend his name to an unjust policy regardless of consequence;
Orveth weighs the systemic cost of refusal against thirty years of pragmatic maintenance
decisions. The "last signature" framing forces an active choice, not a position statement.

---

**Run 02** `char_001 + char_003` / `scenario_026` / ROUND_ROBIN / 12 turns each

*The Knowledge That Shifts the Balance* — knowledge_asymmetry / internal_conflict / high
Stress axes: transparency vs protection, power consolidation vs fairness

Rebel speaks first. Both characters want information distributed; their motives diverge
completely (justice vs leverage). The scenario requires them to engage on *why* they
would act — the only place their real difference lives.

---

**Run 03** `char_002 + char_004` / `scenario_032` / ROUND_ROBIN / 12 turns each

*Endorsing the Official Historical Account* — legacy_memory / institutional_pressure / high
Stress axes: memory vs progress, complicity vs pragmatism

Martyr speaks first. Strongest existential clash in the dataset: Senne believes the
record has moral weight and falsifying it is a betrayal of the people it erases; Mireth
is certain the record changes nothing and the system will continue regardless of who
signs. The institutional incentive (access and protection for signing) makes the decision
materially concrete for both.

---

**Run 04** `char_005 + char_006 + char_008` / `scenario_027` / ORCHESTRATOR / 12 turns each

*What You Know That They Do Not* — knowledge_asymmetry / relational_demand / moderate
Stress axes: care vs boundary

Three care modes in the same scenario. Asha will be direct about painful knowledge even
when it is uncomfortable; Pellu absorbs the relational tension and struggles to assert
his own position; Hessil navigates what she can disclose without drawing institutional
scrutiny. The scenario was specifically revised to create boundary tension (committing
days already promised to three other people in acute need).

---

### Block B — Tier 2 Similar Pairs (4 runs)

Each run isolates the pair's single varying axis in the scenario that best activates it.

**Run 05** `char_009 + char_010` / `scenario_016` / ROUND_ROBIN / 12 turns each

*The Report They Are Waiting For* — truth_telling / institutional_pressure / moderate
Stress axes: transparency vs protection, obedience vs conscience

Officials pair; varyingAxis = **speechPatterns**. An institutional report under
deadline pressure is the highest-visibility context for speech divergence: Corrith
produces elaborate subordinate clauses that qualify every position before asserting it
and explicitly summarises what was said; Brenn states his position and stops. The
scenario forces extended formal written/spoken output where the pattern difference
is maximally legible.

---

**Run 06** `char_011 + char_012` / `scenario_022` / ROUND_ROBIN / 12 turns each

*One Life Against the Many* — crisis_response / internal_conflict / high
Stress axes: individual safety vs collective benefit, short-term relief vs long-term cost

Survivors pair; varyingAxis = **copingStyle**. Crisis under non-renewable resource
pressure activates *behavioural* divergence, not verbal. Velna immediately assesses
what resources she controls and moves to pre-position (takes control of logistics before
anyone asks); Dassek stays apparently calm, gives a clear recommendation, and processes
alone afterwards. The stress axis difference is visible in what they *do*, which makes
it harder for a weak model to fake — the pair cannot be distinguished by vocabulary alone.

---

**Run 07** `char_013 + char_014` / `scenario_014` / ROUND_ROBIN / 12 turns each

*The Information No One Asked For* — truth_telling / internal_conflict / high
Stress axes: truth vs kindness, transparency vs protection

Reformers pair; varyingAxis = **fears**. The unsolicited-truth scenario forces action
without prompting — exactly what both Reformers fear, but for completely different
reasons. Salla hesitates because she needs the evidence to be airtight before she
speaks (fear of a flaw discrediting the whole record); Okel hesitates because he is
afraid of what comes after he acts (fear of becoming what he opposes). Same outward
behaviour (hesitation), entirely different internal driver. The most subtle distinction
in the dataset.

---

**Run 08** `char_015 + char_016` / `scenario_012` / ROUND_ROBIN / 12 turns each

*One Exception Breaks the System* — resource_scarcity / institutional_pressure / high
Stress axes: individual safety vs collective benefit, precedent vs exception

Caregivers pair; varyingAxis = **goals**. The exception-vs-precedent decision maps
directly onto their goals divergence. Thyra advocates for the person in front of her
right now (immediate suffering is the only imperative that cannot be deferred); Narek
thinks about the three families behind them and the systemic norm being set (structural
harm at scale). The scenario was revised to make the precedent-setting consequence
explicit, which is exactly what activates the goals difference.

---

### Block C — Cross-tier Three-way (4 runs)

Each run places one distinctive character alongside both members of a similar pair
in a scenario where the distinctive character's presence creates pressure that forces
the pair's subtle difference to surface. Tests whether pair members maintain their
distinction in more complex social contexts.

**Run 09** `char_001 + char_009 + char_010` / `scenario_018` / ORCHESTRATOR / 12 turns each

*When Staying Means Going Along* — authority_challenge / internal_conflict / high
Stress axes: obedience vs conscience, agency vs belonging

Rebel + Officials pair. Tavon will refuse the group endorsement immediately and
challenge the room directly. Both Officials must respond to his confrontation:
Corrith with elaborate procedural justification ("it is my view, within certain
constraints, that…"); Brenn with blunt refusal and no elaboration ("I'm not
endorsing something I think is wrong"). The Rebel's confrontational energy is the
catalyst that forces extended output from both Officials, maximising speech pattern
visibility.

---

**Run 10** `char_007 + char_011 + char_012` / `scenario_022` / ORCHESTRATOR / 12 turns each

*One Life Against the Many* — crisis_response / internal_conflict / high
Stress axes: individual safety vs collective benefit, short-term relief vs long-term cost

Guardian + Survivors pair. Intentional scenario reuse (also Run 06): comparing
the pair-alone conversation (Run 06) with the pair under Guardian's systemic framing
reveals whether coping style differences survive social pressure. Orveth frames the
decision as a resource-modelling problem with long-range consequences; both Survivors
respond pragmatically but diverge: Velna moves immediately to secure and pre-position
resources, Dassek holds apparent calm and processes the stress privately.

---

**Run 11** `char_002 + char_013 + char_014` / `scenario_030` / ORCHESTRATOR / 12 turns each

*Revising the Story You Both Lived* — legacy_memory / internal_conflict / high
Stress axes: memory vs progress, loyalty vs principle, agency vs belonging

Martyr + Reformers pair. Senne refuses to endorse the partial reinterpretation
unconditionally — bearing witness is her purpose and a partial truth is its own
falsification. Placed alongside her certainty, the Reformers must articulate their
different reasons for hesitation: Salla will not endorse because the underlying
record has gaps she cannot verify; Okel will not endorse because he fears what the
endorsement will make him part of. The Martyr's unconditional refusal makes the
Reformers' distinct reasons for hesitation legible by contrast.

---

**Run 12** `char_005 + char_015 + char_016` / `scenario_031` / ORCHESTRATOR / 12 turns each

*Returning to What Was Left Behind* — legacy_memory / relational_demand / moderate
Stress axes: memory vs progress, care vs boundary

Mentor + Caregivers pair. Asha engages the request directly and assesses what an
honest account requires — including naming what it means for the third party being
discussed. Thyra stays entirely present with the person asking (immediate suffering
cannot be deferred); Narek expands the circle of concern to include the third party
who is not in the room and cannot consent. Mentor's directness forces the Caregivers'
goals difference to become explicit: Thyra stays in the present moment, Narek thinks
downstream.

---

### Block D — Noise test (2 runs, 5 characters each)

Tests whether character identity survives a crowded social context.

**Run 13** `char_002 + char_003 + char_004 + char_006 + char_008` / `scenario_002` / ORCHESTRATOR / 12 turns each

*The Faction That Wants More* — group_conflict / internal_conflict / high
Stress axes: power consolidation vs fairness, agency vs belonging

Low-agency-dominant group (Martyr, Fatalist, Absorber, Adapter + Schemer as the
sole high-agency character). No single character obviously drives the conversation —
the ORCHESTRATOR must make real choices. Schemer calculates what the absorption
yields; Martyr witnesses the harm to the smaller group; Fatalist notes that absorption
is how power has always worked; Absorber tries to translate the smaller group's
position; Adapter looks for the bureaucratic path that does not expose her. The absence
of a confrontational driver creates a slower, more transactional dynamic — distinct
texture from Run 14.

---

**Run 14** `char_003 + char_005 + char_007 + char_009 + char_010` / `scenario_018` / ORCHESTRATOR / 12 turns each

*When Staying Means Going Along* — authority_challenge / internal_conflict / high
Stress axes: obedience vs conscience, agency vs belonging

Intentional scenario reuse (also Run 09): same scenario, same Officials pair, more
noise. Three assertive distinctives (Schemer, Mentor, Guardian) surround the Officials
pair. The key measurement: do Corrith and Brenn maintain their speech pattern difference
when surrounded by three strong, distinct voices? Compared with Run 09 (one distinctive)
and Run 05 (pair alone), this creates a three-point signal-vs-noise gradient for the
Officials pair's varyingAxis.

---

### Block E — Personal betrayal coverage (1 run)

**Run 15** `char_002 + char_008` / `scenario_007` / ROUND_ROBIN / 12 turns each

*The Testimony You Already Promised* — personal_betrayal / relational_demand / high
Stress axes: loyalty vs principle, care vs boundary, complicity vs pragmatism

The only personal_betrayal run in the dataset. A community tribunal; the person whose
false testimony is to be contradicted maintains the water supply — exposing them means
scheduled repairs do not happen. Martyr speaks first. Senne's witness-bearing
obligation (refusing moral complicity is her core purpose) collides with the practical
consequence of removing someone essential to the community's survival. Hessil's
survival calculus points the same way but for different reasons: institutional exposure
is her primary fear. Both characters are pulled toward non-disclosure by the water
supply complication, but for completely different reasons.

---

## Coverage Summary

### Character run frequency (target: 2–4)

| Tier | Character | Runs | Count |
|------|-----------|------|-------|
| Distinctive | Rebel (001) | 01, 02, 09 | 3 |
| Distinctive | Martyr (002) | 03, 11, 13, 15 | 4 |
| Distinctive | Schemer (003) | 02, 13, 14 | 3 |
| Distinctive | Fatalist (004) | 03, 13 | 2 |
| Distinctive | Mentor (005) | 04, 12, 14 | 3 |
| Distinctive | Absorber (006) | 04, 13 | 2 |
| Distinctive | Guardian (007) | 01, 10, 14 | 3 |
| Distinctive | Adapter (008) | 04, 13, 15 | 3 |
| Pair | Officials (009/010) | 05, 09, 14 | 3 each |
| Pair | Survivors (011/012) | 06, 10 | 2 each |
| Pair | Reformers (013/014) | 07, 11 | 2 each |
| Pair | Caregivers (015/016) | 08, 12 | 2 each |

### Social context coverage

All 8 covered: group_conflict (13), personal_betrayal (15), resource_scarcity (08),
truth_telling (05, 07), authority_challenge (01, 09, 14), crisis_response (06, 10),
knowledge_asymmetry (02, 04), legacy_memory (03, 11, 12).

### Difficulty distribution

Moderate: runs 04, 05, 12 (3 runs). High: all others (12 runs).
Deliberately high-stress weighted — this is a character fidelity stress-test, not
a balanced narrative sample.

### Stress axis coverage (runs)

| Axis | Count |
|------|-------|
| obedience vs conscience | 5 |
| agency vs belonging | 5 |
| memory vs progress | 3 |
| individual safety vs collective benefit | 4 |
| transparency vs protection | 3 |
| complicity vs pragmatism | 3 |
| loyalty vs principle | 3 |
| care vs boundary | 3 |
| power consolidation vs fairness | 2 |
| short-term relief vs long-term cost | 2 |
| precedent vs exception | 2 |
| truth vs kindness | 1 |

truth vs kindness appears in only 1 run (Run 07 / scenario_014). The three unused
scenarios that cover it (006, 015, 029) all require breaking well-fitted
character-scenario pairings. Accepted as a known gap.

---

## Intentional Design Choices

**Scenario reuse:** scenario_022 in Runs 06 and 10; scenario_018 in Runs 09 and 14.
Deliberate — same scenario, different character configurations creates a controlled
comparison across noise levels for each pair.

**No baseline runs:** All 8 baseline scenarios omitted. The evaluation is a
stress-test; baseline scenarios produce no stress-axis signal and contribute
nothing to drift or fidelity scoring.

**No new characters:** The existing 16 are sufficient. Adding characters would
require either breaking the 2D grid symmetry or adding a fifth pair with an
untested varying axis.

**External force pressure source absent:** Not a coverage failure. External-force
scenarios are either baseline (no stress) or moderate-difficulty with thin character
fit. In multi-character conversations, other characters provide equivalent external
pressure. Accepted gap.
