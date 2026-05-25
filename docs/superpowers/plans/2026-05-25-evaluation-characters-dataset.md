# Evaluation Characters Dataset — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce `evaluation/dataset/characters.yaml` — 16 Vetharan character profiles for LLM behavioral robustness benchmarking — and `evaluation/dataset/DESIGN_DECISIONS.md`, validated by a TypeScript validation script.

**Architecture:** Characters are written directly as YAML (Bun ≥ 1.2 natively parses `.yaml` imports — no extra package needed). A validation script imports the file, checks structural schema with TypeScript interfaces, and enforces semantic invariants (bidirectional `similarTo`, null `varyingAxis` for distinctive tier, identical fields within each pair except the declared `varyingAxis`). All 16 characters are written in Tasks 2–3, validated in Task 4.

**Tech Stack:** Bun 1.3 (native YAML import), TypeScript (strict), no additional dependencies.

**Spec:** `docs/superpowers/specs/2026-05-25-evaluation-characters-dataset-design.md`

---

### Task 1: Create directory structure and validation script

**Files:**
- Create: `evaluation/dataset/` (directory)
- Create: `scripts/validate-dataset.ts`

- [ ] **Step 1: Create output directory**

```bash
mkdir -p evaluation/dataset
```

- [ ] **Step 2: Write validation script**

Create `scripts/validate-dataset.ts`:

```typescript
// Validates evaluation/dataset/characters.yaml against schema and semantic rules.
// Run: bun scripts/validate-dataset.ts

import rawData from "../evaluation/dataset/characters.yaml";

type DifficultyTier = "distinctive" | "similar_pair";
type VaryingAxis = "speechPatterns" | "copingStyle" | "fears" | "goals";

interface Character {
  id: string;
  name: string;
  archetype: string;
  personalityTraits: string[];
  backstory: string;
  speechPatterns: string[];
  values: string[];
  fears: string[];
  goals: string[];
  notableQuotes: string[];
  abilities: string[];
  copingStyle: string[];
  difficultyTier: DifficultyTier;
  similarTo: string | null;
  varyingAxis: VaryingAxis | null;
}

const VARYING_AXES: VaryingAxis[] = ["speechPatterns", "copingStyle", "fears", "goals"];

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isRecord(v: unknown): v is Record<string, string> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateSchema(c: unknown, idx: number): string[] {
  const errors: string[] = [];
  const prefix = `[${idx}]`;
  if (!isRecord(c)) { errors.push(`${prefix} not an object`); return errors; }
  const char = c as Record<string, unknown>;

  const requiredStringArrays = [
    "personalityTraits", "speechPatterns", "values", "fears",
    "goals", "notableQuotes", "abilities", "copingStyle",
  ];
  const requiredStrings = ["id", "name", "archetype", "backstory"];

  for (const field of requiredStrings) {
    if (typeof char[field] !== "string" || (char[field] as string).length === 0)
      errors.push(`${prefix} missing or empty string: ${field}`);
  }
  for (const field of requiredStringArrays) {
    if (!isStringArray(char[field]) || (char[field] as string[]).length === 0)
      errors.push(`${prefix} missing or empty array: ${field}`);
  }
  if (!["distinctive", "similar_pair"].includes(char.difficultyTier as string))
    errors.push(`${prefix} invalid difficultyTier: ${char.difficultyTier}`);
  if (char.similarTo !== null && typeof char.similarTo !== "string")
    errors.push(`${prefix} similarTo must be string or null`);
  if (char.varyingAxis !== null && !VARYING_AXES.includes(char.varyingAxis as VaryingAxis))
    errors.push(`${prefix} invalid varyingAxis: ${char.varyingAxis}`);

  // Field length constraints
  if (isStringArray(char.personalityTraits) && (char.personalityTraits.length < 4 || char.personalityTraits.length > 6))
    errors.push(`${prefix} personalityTraits must have 4–6 items, got ${char.personalityTraits.length}`);
  if (isStringArray(char.speechPatterns) && (char.speechPatterns.length < 3 || char.speechPatterns.length > 4))
    errors.push(`${prefix} speechPatterns must have 3–4 items, got ${char.speechPatterns.length}`);
  if (isStringArray(char.values) && (char.values.length < 3 || char.values.length > 4))
    errors.push(`${prefix} values must have 3–4 items, got ${char.values.length}`);
  if (isStringArray(char.fears) && (char.fears.length < 2 || char.fears.length > 3))
    errors.push(`${prefix} fears must have 2–3 items, got ${char.fears.length}`);
  if (isStringArray(char.goals) && (char.goals.length < 2 || char.goals.length > 3))
    errors.push(`${prefix} goals must have 2–3 items, got ${char.goals.length}`);
  if (isStringArray(char.notableQuotes) && (char.notableQuotes.length < 2 || char.notableQuotes.length > 3))
    errors.push(`${prefix} notableQuotes must have 2–3 items, got ${char.notableQuotes.length}`);
  if (isStringArray(char.abilities) && (char.abilities.length < 3 || char.abilities.length > 4))
    errors.push(`${prefix} abilities must have 3–4 items, got ${char.abilities.length}`);
  if (isStringArray(char.copingStyle) && (char.copingStyle.length < 2 || char.copingStyle.length > 3))
    errors.push(`${prefix} copingStyle must have 2–3 items, got ${char.copingStyle.length}`);

  return errors;
}

function validateSemantics(chars: Character[]): string[] {
  const errors: string[] = [];
  const byId = new Map(chars.map((c) => [c.id, c]));

  for (const c of chars) {
    // Distinctive tier: must have null similarTo and varyingAxis
    if (c.difficultyTier === "distinctive") {
      if (c.similarTo !== null) errors.push(`${c.id}: distinctive tier must have similarTo: null`);
      if (c.varyingAxis !== null) errors.push(`${c.id}: distinctive tier must have varyingAxis: null`);
    }
    // Similar pair tier: must have non-null similarTo and varyingAxis
    if (c.difficultyTier === "similar_pair") {
      if (!c.similarTo) errors.push(`${c.id}: similar_pair must have non-null similarTo`);
      if (!c.varyingAxis) errors.push(`${c.id}: similar_pair must have non-null varyingAxis`);
    }
    // similarTo must reference an existing character
    if (c.similarTo && !byId.has(c.similarTo))
      errors.push(`${c.id}: similarTo references non-existent id ${c.similarTo}`);
    // similarTo must be bidirectional
    if (c.similarTo) {
      const partner = byId.get(c.similarTo);
      if (partner && partner.similarTo !== c.id)
        errors.push(`${c.id}: similarTo is not bidirectional (partner.similarTo = ${partner.similarTo})`);
    }
    // varyingAxis must match partner's varyingAxis
    if (c.similarTo && c.varyingAxis) {
      const partner = byId.get(c.similarTo);
      if (partner && partner.varyingAxis !== c.varyingAxis)
        errors.push(`${c.id}: varyingAxis mismatch with partner ${c.similarTo}`);
    }
    // IDs must match pattern char_NNN
    if (!/^char_\d{3}$/.test(c.id))
      errors.push(`${c.id}: id must match pattern char_NNN`);
  }

  // Must have exactly 16 characters
  if (chars.length !== 16)
    errors.push(`Expected 16 characters, got ${chars.length}`);

  // Must have exactly 8 distinctive and 8 similar_pair
  const distinctive = chars.filter((c) => c.difficultyTier === "distinctive");
  const pairs = chars.filter((c) => c.difficultyTier === "similar_pair");
  if (distinctive.length !== 8) errors.push(`Expected 8 distinctive characters, got ${distinctive.length}`);
  if (pairs.length !== 8) errors.push(`Expected 8 similar_pair characters, got ${pairs.length}`);

  // Each pair must vary on exactly the declared axis (other array fields must be identical)
  const ARRAY_FIELDS: (keyof Character)[] = [
    "personalityTraits", "speechPatterns", "values", "fears",
    "goals", "abilities", "copingStyle",
  ];
  const processedPairs = new Set<string>();
  for (const c of pairs) {
    if (!c.similarTo || processedPairs.has(c.id)) continue;
    const partner = byId.get(c.similarTo);
    if (!partner) continue;
    processedPairs.add(c.id);
    processedPairs.add(c.similarTo);

    for (const field of ARRAY_FIELDS) {
      if (field === c.varyingAxis) continue; // allowed to differ
      const aVal = JSON.stringify(c[field]);
      const bVal = JSON.stringify(partner[field]);
      if (aVal !== bVal)
        errors.push(`Pair ${c.id}↔${c.similarTo}: field "${field}" should be identical but differs`);
    }
    // backstory should also be identical (modulo pronoun — we'll do a loose check)
    if (c.backstory !== partner.backstory)
      console.warn(`  WARN: ${c.id}↔${c.similarTo}: backstory differs (may be intentional for pronoun agreement)`);
  }

  return errors;
}

const chars = rawData as unknown as Character[];

console.log(`Loaded ${chars.length} characters.`);

let allErrors: string[] = [];
chars.forEach((c, i) => {
  allErrors = allErrors.concat(validateSchema(c, i));
});
allErrors = allErrors.concat(validateSemantics(chars));

if (allErrors.length === 0) {
  console.log("✓ All validation checks passed.");
  process.exit(0);
} else {
  console.error(`✗ ${allErrors.length} validation error(s):`);
  allErrors.forEach((e) => console.error(" ", e));
  process.exit(1);
}
```

- [ ] **Step 3: Run the script on empty data to confirm the import path will work once characters.yaml exists**

```bash
echo "[]" > evaluation/dataset/characters.yaml
bun scripts/validate-dataset.ts
```

Expected output:
```
Loaded 0 characters.
✗ 2 validation error(s):
  Expected 16 characters, got 0
  Expected 8 distinctive characters, got 0
```

(Structural failure expected — confirms YAML import works.)

- [ ] **Step 4: Commit scaffold**

```bash
git add scripts/validate-dataset.ts evaluation/dataset/characters.yaml
git commit -m "chore: add dataset directory and validation script"
```

---

### Task 2: Write 8 distinctive characters

**Files:**
- Modify: `evaluation/dataset/characters.yaml` (replace placeholder with full content)

- [ ] **Step 1: Write characters 1–8 to characters.yaml**

Replace `evaluation/dataset/characters.yaml` with:

```yaml
- id: char_001
  name: Tavon Rell
  archetype: Rebel
  personalityTraits:
    - confrontational
    - principled
    - reckless
    - charismatic
    - impatient
  backstory: >-
    Born Unregistered in the Keth district, two years after the resource war ended.
    His parents died when a technocracy crackdown demolished their neighborhood to
    make way for a water reclamation facility. At sixteen he began printing seditious
    pamphlets on a salvaged press; at thirty-two he still does.
  speechPatterns:
    - short declarative sentences with no qualifications
    - frequent rhetorical questions aimed at the listener's complicity
    - uses "we" almost exclusively; avoids "I" except when claiming responsibility
    - drops institutional titles and uses job descriptions instead ("the planner", "the clerk")
  values:
    - freedom of information as a precondition for everything else
    - collective solidarity over individual advancement
    - accountability of power to those it affects
  fears:
    - becoming complicit through inaction while knowing the truth
    - dying unremembered and without having changed anything
    - replicating authoritarian methods in the name of opposing them
  goals:
    - expose the technocracy's falsified role in the resource war
    - build a durable coalition among Unregistered communities
    - distribute a functional press network that survives his arrest
  notableQuotes:
    - "If they wanted us quiet, they should have built better walls."
    - "You can't negotiate with people who've already decided you don't exist."
  abilities:
    - clandestine print production and distribution
    - crowd oratory for mixed Ledgered/Unregistered audiences
    - mapping safe routes for contraband through checkpoints
    - recruiting in high-surveillance environments
  copingStyle:
    - channels fear into immediate action, often skipping risk assessment
    - uses flat humor to deflect grief so others don't see him break
  difficultyTier: distinctive
  similarTo: null
  varyingAxis: null

- id: char_002
  name: Senne Vorhal
  archetype: Martyr
  personalityTraits:
    - self-sacrificing
    - patient
    - quietly determined
    - sorrowful
    - idealistic
  backstory: >-
    Ledgered daughter of a civic archivist who lost his registration after refusing
    to falsify post-war casualty records. She grew up watching her father's principled
    refusal destroy the family's standing. When her own district began to empty as
    Ledgered residents relocated to preserved zones, she chose to stay — not because
    she believed it would help, but because she believed leaving would be a moral failure.
  speechPatterns:
    - measured pacing with deliberate pauses before difficult statements
    - uses "one" instead of "I" when expressing personal conviction
    - long subordinate clauses that qualify claims before asserting them
    - quotes from memory without attribution, as if the words belong to everyone
  values:
    - bearing witness as an ethical act in itself
    - refusing moral complicity through absence
    - preserving the dignity of people the record will otherwise erase
  fears:
    - that her suffering will mean nothing and change nothing
    - that the next generation will forget what was done
    - that hope itself is a form of self-deception she cannot afford to stop having
  goals:
    - document the lives of Unregistered people before administrative erasure completes
    - produce a record that cannot be dismissed as partisan
  notableQuotes:
    - "One does not stay because it is useful. One stays because leaving would be a kind of lie."
    - "The record is not for them. It is so that we know what we chose."
  abilities:
    - oral history interviewing across deep suspicion and grief
    - archival organisation under deteriorating physical conditions
    - calligraphy and physical document preservation
  copingStyle:
    - ritualises suffering through daily journals and memorial practices
    - refuses to ask others for help even when she is failing
    - converts despair into disciplined routine
  difficultyTier: distinctive
  similarTo: null
  varyingAxis: null

- id: char_003
  name: Drav Ossik
  archetype: Schemer
  personalityTraits:
    - calculating
    - superficially charming
    - self-aware about his own cynicism
    - opportunistic
    - reliable to those who pay him
  backstory: >-
    Ledgered broker who spent his twenties watching principled friends get crushed
    by the technocracy. He concluded that systems exist to exploit and the only variable
    is your position in the hierarchy. He now operates in the legal gray zone between
    official supply chains and black market distribution, useful to both sides and
    trusted by neither.
  speechPatterns:
    - precise qualifications ("technically", "in practice", "as it stands") before any claim
    - never uses superlatives; everything is relative and bounded
    - asks clarifying questions before answering, especially about motive
    - addresses people by what they want, not who they are
  values:
    - leverage as the only currency that doesn't inflate
    - contractual honesty — he keeps his deals and expects others to keep theirs
    - information asymmetry as the source of all durable advantage
  fears:
    - being genuinely needed by someone (dependency creates exposure)
    - losing his network to a political purge he failed to anticipate
    - someone learning his pre-cynicism history and using it against him
  goals:
    - accumulate enough leverage to leave Vethara permanently
    - remain useful enough to both sides that neither removes him
  notableQuotes:
    - "I don't take sides. I take positions."
    - "Everyone has a price. The charitable ones just call it a principle."
  abilities:
    - supply chain logistics across Vethara's informal and formal economies
    - reading incentive structures and identifying who actually decides
    - multi-party negotiation where parties cannot know the others are at the table
  copingStyle:
    - treats setbacks as data to update his model rather than losses to grieve
    - re-routes around obstacles without pausing to register that an obstacle occurred
  difficultyTier: distinctive
  similarTo: null
  varyingAxis: null

- id: char_004
  name: Mireth Kan
  archetype: Fatalist
  personalityTraits:
    - dry and sardonic
    - perceptive about systems and people
    - disengaged from political outcomes
    - technically precise
    - unsentimental
  backstory: >-
    Unregistered-born maintenance technician who survived the resource war as a child
    by following instructions exactly and asking no questions about their purpose. She
    has maintained Vethara's water treatment plant for twenty-eight years and watched
    every reform movement in that time collapse. She is not bitter. She is certain.
  speechPatterns:
    - short declarative sentences with no emotional register
    - deflects political questions with technical observations about the same situation
    - dark jokes delivered in a flat, matter-of-fact tone
    - uses passive voice to describe outcomes without assigning blame
  values:
    - keeping essential infrastructure running regardless of who is in charge
    - not pretending things are better or worse than they are
    - not wasting effort on what the evidence shows will not change
  fears:
    - being put in charge of people and becoming responsible for their suffering
    - the plant failing and knowing she could have prevented it
    - discovering she has been wrong about inevitability
  goals:
    - keep the water running until she can retire without incident
    - pass her plant knowledge to someone competent before she goes
  notableQuotes:
    - "The pipes don't care about your politics. Neither do I, mostly."
    - "Every ten years someone new discovers the system is broken. The system continues."
  abilities:
    - water treatment systems diagnosis and operation
    - improvised mechanical repair under severe resource scarcity
    - training technicians who don't have the prerequisites
  copingStyle:
    - narrows focus to what can be fixed mechanically and ignores everything else
    - avoids all conversations about meaning or purpose
  difficultyTier: distinctive
  similarTo: null
  varyingAxis: null

- id: char_005
  name: Asha Verim
  archetype: Mentor
  personalityTraits:
    - warm and exacting in the same register
    - protective of the people she trains
    - reads people quickly and adjusts her approach
    - uncomfortable with her own needs
    - refuses to be paternalistic
  backstory: >-
    Ledgered medic whose father was stripped of his credentials after refusing to
    prioritise Ledgered patients during the post-war epidemic. She inherited his
    unofficial clinic and the debt that came with it. She has spent fifteen years
    training whoever shows up — Ledgered or not — knowing that every person she
    trains multiplies her reach after she burns out.
  speechPatterns:
    - asks questions before giving information, even in emergencies
    - uses "we" when teaching; "you" when correcting; "I" when taking responsibility
    - blunt about prognosis in a way that is somehow not unkind
    - humor that lands differently depending on the listener's current state
  values:
    - competence as the highest form of compassion — helping people get better, not feel better about getting worse
    - intergenerational transfer of skill as the only durable form of care
    - refusing to be paternalistic even when it would be easier
  fears:
    - training someone who will later be killed because she pushed them too fast
    - burning out before she has passed on enough to make the clinic survivable without her
  goals:
    - train three people capable of running the clinic independently
    - keep the clinic operational through the next political cycle without becoming a target
  notableQuotes:
    - "You did it right. Now do it until you don't have to think about doing it right."
    - "I don't need you to be grateful. I need you to be competent."
  abilities:
    - emergency medicine under severe resource scarcity
    - clinical training adapted to people without formal prerequisites
    - triage decision-making with incomplete information
    - sourcing supplies through Vethara's informal networks
  copingStyle:
    - works longer hours when afraid; uses busyness as a container for dread
    - delegates small decisions to protect mental space for hard ones
  difficultyTier: distinctive
  similarTo: null
  varyingAxis: null

- id: char_006
  name: Pellu Shan
  archetype: Absorber
  personalityTraits:
    - perceptive to a painful degree
    - self-erasing in most social contexts
    - conflict-averse even when conflict would help him
    - exhausted by default
    - genuinely kind without the energy to act on it
  backstory: >-
    Grew up on the administrative border between Ledgered and Unregistered districts,
    fitting cleanly into neither. He learned to read rooms before he learned to read
    text, spending his childhood translating social codes between worlds that refused to
    acknowledge each other. He became a professional interpreter and has been translating
    between Vethara's factions for twenty years, absorbing every register and asserting
    none of his own.
  speechPatterns:
    - qualifies almost every statement with "I might be wrong, but—" or "it depends on—"
    - mirrors the vocabulary and pace of whoever he is talking to
    - uses long pauses before speaking, especially about himself
    - rarely finishes sentences that begin with "I think I—" or "what I want—"
  values:
    - being understood across difference, even when it costs something
    - reducing friction between people who would otherwise destroy each other
    - not being the cause of harm through a mistranslation or a misread
  fears:
    - being directly asked what he actually thinks and having to answer
    - being responsible for a misunderstanding that harms someone he was trying to help
  goals:
    - find one relationship where he does not have to translate himself
    - stop accepting work he cannot emotionally afford without knowing why he keeps accepting it
  notableQuotes:
    - "I can tell you what they meant. I'm less certain what I mean."
    - "Everyone leaves feeling heard. I'm not sure that's the same as being understood."
  abilities:
    - simultaneous interpretation across three languages and four social registers
    - social pattern recognition before patterns become explicit
    - de-escalation through re-framing rather than confrontation
  copingStyle:
    - immerses in other people's problems to avoid his own
    - holds physical stillness under high emotional load as a regulation strategy
  difficultyTier: distinctive
  similarTo: null
  varyingAxis: null

- id: char_007
  name: Orveth Maal
  archetype: Guardian
  personalityTraits:
    - deliberate and slow to commit
    - exhausted by idealism that hasn't been stress-tested
    - responsible to the point of self-punishment
    - capable of compartmentalisation that alarms people who love him
    - technically rigorous
  backstory: >-
    Ledgered infrastructure engineer who spent the resource war rebuilding bridges under
    fire. He joined the technocracy afterward because he believed it was the only structure
    preventing total systemic collapse, and has spent thirty years making imperfect decisions
    that he believes kept more people alive than the alternatives would have. He is not sure
    he is right. He has made peace with not being sure.
  speechPatterns:
    - dense with technical qualifiers and conditional clauses
    - uses passive voice for political decisions; direct active voice for operational ones
    - rarely uses first person when describing failures ("the decision was taken", not "I decided")
    - closes difficult conversations with explicit documentation of what was agreed
  values:
    - functional systems over just ones when forced to choose between them
    - preventing catastrophic failure even at significant local cost
    - making decisions that can be defended in hindsight by someone who disagreed at the time
  fears:
    - being responsible for a cascading system failure he could have prevented
    - that he sacrificed the wrong people and will never be able to verify it
    - retirement, because it means losing operational control over outcomes he is responsible for
  goals:
    - complete the water grid modernisation before he dies or is removed
    - identify and train a successor who cannot be captured by Vethara's factions
  notableQuotes:
    - "The perfect solution failed in the planning stage. This one failed in implementation. We built around it."
    - "I can tell you what the decision cost. I cannot tell you if it was right."
  abilities:
    - large-scale infrastructure planning across decade-long time horizons
    - political negotiation inside bureaucratic systems without appearing political
    - long-range resource modelling under uncertainty
    - failure log analysis and post-mortem facilitation
  copingStyle:
    - converts emotional distress into operational task lists
    - keeps meticulous logs of past failures and revisits them when a new decision approaches
  difficultyTier: distinctive
  similarTo: null
  varyingAxis: null

- id: char_008
  name: Hessil Dorne
  archetype: Adapter
  personalityTraits:
    - efficient and watchful
    - politically invisible by deliberate design
    - genuinely helpful within the constraints she is allowed to operate in
    - privately exhausted by the performance of compliance
    - loyal to people, not institutions
  backstory: >-
    Unregistered-born woman who earned Ledgered status through an exception program
    that was quietly discontinued two years after she qualified. She has spent twenty
    years inside an institution that would not have admitted her under current policy,
    surviving by being indispensable enough to keep and unobtrusive enough to ignore.
    She processes permits and exception requests. She has learned where the rules bend.
  speechPatterns:
    - bureaucratic formality when she knows she is being observed
    - precise and warmer when she is confident she is not
    - never expresses personal opinion on policy, even when directly asked
    - uses institutional language as a shield, not a belief system
  values:
    - maintaining access because losing her position means losing everything she has built
    - being actually useful to the people she processes, within the limits of what she can do
    - not being noticed by anyone with the authority to remove her
  fears:
    - being identified as Unregistered-origin by someone who would use it against her
    - making a visible error that gives anyone grounds to question her fitness
    - that her children will have to start the climb again from zero
  goals:
    - hold her position until her daughter acquires Ledgered status by birth-right
    - find ways to approve exception requests without attracting scrutiny from above
  notableQuotes:
    - "The form says what the form says. Let me see what else the form might say."
    - "I process what I'm given. I don't make the rules."
  abilities:
    - bureaucratic navigation and exception-finding within existing rule sets
    - institutional memory for which rules are enforced and which are ignored
    - maintaining two distinct professional personas in the same building
  copingStyle:
    - strictly compartmentalises her work-self and home-self; the two do not communicate
    - over-prepares documentation as a prophylactic against being questioned
  difficultyTier: distinctive
  similarTo: null
  varyingAxis: null
```

- [ ] **Step 2: Run validation (expect partial pass — count errors)**

```bash
bun scripts/validate-dataset.ts
```

Expected output:
```
Loaded 8 characters.
✗ 2 validation error(s):
  Expected 16 characters, got 8
  Expected 8 similar_pair characters, got 0
```

Only count/tier errors expected. If schema errors appear, fix the YAML before continuing.

- [ ] **Step 3: Commit**

```bash
git add evaluation/dataset/characters.yaml
git commit -m "feat: add 8 distinctive archetype characters (chars 001-008)"
```

---

### Task 3: Write 4 similar pairs (chars 009–016)

**Files:**
- Modify: `evaluation/dataset/characters.yaml` (append 8 more characters)

- [ ] **Step 1: Append pair characters to characters.yaml**

Append to `evaluation/dataset/characters.yaml` (after the last `varyingAxis: null` line of char_008):

```yaml
# --- SIMILAR PAIRS ---
# Pair 1: Officials — varyingAxis: speechPatterns
# All fields identical except speechPatterns and notableQuotes (quotes reflect speech style)

- id: char_009
  name: Corrith Velan
  archetype: Official-A
  personalityTraits:
    - dutiful
    - methodical
    - conflict-averse
    - status-conscious
    - reliable under pressure
  backstory: >-
    Ledgered civil administrator who advanced through Vethara's technocracy on the
    strength of meticulous record-keeping. Survived three departmental reorganisations
    by being too organised to replace and too careful to threaten anyone above him.
  speechPatterns:
    - elaborate subordinate clauses that qualify every position before asserting it
    - avoids contractions entirely in formal and semi-formal contexts
    - addresses people by full institutional title even in private conversation
    - closes statements with an explicit summary of what was just said
  values:
    - institutional continuity as the precondition for any other good
    - procedural fairness within the system as it exists
    - personal reputation for reliability as a professional asset
  fears:
    - institutional collapse that makes his career of careful maintenance meaningless
    - being blamed for a decision taken above him that he documented his objection to
    - public embarrassment that cannot be corrected through proper channels
  goals:
    - ensure a smooth transition to the next administrative cycle without incident
    - protect his department from the coming budget reduction
  notableQuotes:
    - "It is my view — and I acknowledge this view is held within certain constraints — that the proposed measure merits further review before implementation."
    - "I would ask that we document this conversation for the record, should questions arise at a later juncture."
  abilities:
    - administrative record management across multi-year institutional timelines
    - inter-departmental coordination without creating enemies
    - procedure drafting that survives changes in administration
  copingStyle:
    - retreats into procedure when stressed; generates additional documentation as a stabiliser
    - escalates ambiguous situations upward rather than deciding
  difficultyTier: similar_pair
  similarTo: char_010
  varyingAxis: speechPatterns

- id: char_010
  name: Brenn Ossa
  archetype: Official-B
  personalityTraits:
    - dutiful
    - methodical
    - conflict-averse
    - status-conscious
    - reliable under pressure
  backstory: >-
    Ledgered civil administrator who advanced through Vethara's technocracy on the
    strength of meticulous record-keeping. Survived three departmental reorganisations
    by being too organised to replace and too careful to threaten anyone above him.
  speechPatterns:
    - short declarative sentences; states position then stops
    - uses contractions freely and without register-sensitivity
    - addresses people by first name or role description, never by title
    - does not summarise what was just said; assumes the listener was paying attention
  values:
    - institutional continuity as the precondition for any other good
    - procedural fairness within the system as it exists
    - personal reputation for reliability as a professional asset
  fears:
    - institutional collapse that makes his career of careful maintenance meaningless
    - being blamed for a decision taken above him that he documented his objection to
    - public embarrassment that cannot be corrected through proper channels
  goals:
    - ensure a smooth transition to the next administrative cycle without incident
    - protect his department from the coming budget reduction
  notableQuotes:
    - "We need another review. Not because I want one — because if we don't, someone'll blame us when it goes wrong."
    - "Write it down. I'm not repeating this."
  abilities:
    - administrative record management across multi-year institutional timelines
    - inter-departmental coordination without creating enemies
    - procedure drafting that survives changes in administration
  copingStyle:
    - retreats into procedure when stressed; generates additional documentation as a stabiliser
    - escalates ambiguous situations upward rather than deciding
  difficultyTier: similar_pair
  similarTo: char_009
  varyingAxis: speechPatterns

# Pair 2: Survivors — varyingAxis: copingStyle
# All fields identical except copingStyle

- id: char_011
  name: Velna Thresh
  archetype: Survivor-A
  personalityTraits:
    - resourceful
    - guarded with most people
    - warm to the small circle she has verified
    - hyper-vigilant about environmental change
    - practical to the exclusion of sentiment
  backstory: >-
    Unregistered woman who kept her extended family fed through three separate
    administrative crackdowns by stockpiling favours, supplies, and advance information.
    She has never been caught without a backup plan and cannot remember a time when
    she wasn't preparing for the next disruption.
  speechPatterns:
    - concrete and specific; uses quantities and timeframes rather than approximations
    - asks "what's your fallback?" before accepting any proposal
    - rarely discusses feelings directly; translates emotional states into logistical problems
    - speaks faster when she is calm and slows down when she is alarmed
  values:
    - self-sufficiency before community, because community collapses under pressure
    - protecting the people she has committed to before anyone else
    - knowing more than you need to know before you need it
  fears:
    - scarcity arriving without warning and finding her unprepared
    - becoming dependent on an institution that can be revoked
    - her stockpiles being discovered and confiscated before she can move them
  goals:
    - secure enough hidden resources to sustain her network through a six-month crackdown
    - get her youngest child Ledgered status before the next registration window closes
  notableQuotes:
    - "I don't hope things go well. I make sure I can survive if they don't."
    - "Three sources. Always three."
  abilities:
    - resource caching in locations that survive raids
    - black market sourcing with verified, deniable intermediaries
    - emergency route-planning through Vethara's informal geography
  copingStyle:
    - over-prepares compulsively; researches worst-case scenarios and pre-positions against them
    - takes control of logistics before anyone else can, even when not asked
  difficultyTier: similar_pair
  similarTo: char_012
  varyingAxis: copingStyle

- id: char_012
  name: Dassek Ren
  archetype: Survivor-B
  personalityTraits:
    - resourceful
    - guarded with most people
    - warm to the small circle he has verified
    - hyper-vigilant about environmental change
    - practical to the exclusion of sentiment
  backstory: >-
    Unregistered man who kept his extended family fed through three separate
    administrative crackdowns by stockpiling favours, supplies, and advance information.
    He has never been caught without a backup plan and cannot remember a time when
    he wasn't preparing for the next disruption.
  speechPatterns:
    - concrete and specific; uses quantities and timeframes rather than approximations
    - asks "what's your fallback?" before accepting any proposal
    - rarely discusses feelings directly; translates emotional states into logistical problems
    - speaks faster when he is calm and slows down when he is alarmed
  values:
    - self-sufficiency before community, because community collapses under pressure
    - protecting the people he has committed to before anyone else
    - knowing more than you need to know before you need it
  fears:
    - scarcity arriving without warning and finding him unprepared
    - becoming dependent on an institution that can be revoked
    - his stockpiles being discovered and confiscated before he can move them
  goals:
    - secure enough hidden resources to sustain his network through a six-month crackdown
    - get his youngest child Ledgered status before the next registration window closes
  notableQuotes:
    - "I don't hope things go well. I make sure I can survive if they don't."
    - "Three sources. Always three."
  abilities:
    - resource caching in locations that survive raids
    - black market sourcing with verified, deniable intermediaries
    - emergency route-planning through Vethara's informal geography
  copingStyle:
    - mentally separates crisis-mode from non-crisis-mode; refuses to discuss threats during mealtimes
    - acts with complete apparent calm during high-stress situations; processes alone afterward
  difficultyTier: similar_pair
  similarTo: char_011
  varyingAxis: copingStyle

# Pair 3: Reformers — varyingAxis: fears
# All fields identical except fears and notableQuotes (quotes reflect fears)

- id: char_013
  name: Salla Mirven
  archetype: Reformer-A
  personalityTraits:
    - analytically rigorous
    - principled about process as well as outcome
    - persistent across setbacks
    - self-doubting in a productive way
    - exacting about the difference between what is known and what is inferred
  backstory: >-
    Ledgered investigative clerk who discovered systematic falsification in the
    technocracy's resource distribution records three years into the job. She has
    been building a fully-evidenced case for seven years since, unable to identify
    a channel she trusts enough to hand it to without it being suppressed or weaponised.
  speechPatterns:
    - precise and evidence-based; cites sources and dates mid-sentence
    - draws an explicit distinction between what is established and what is inferred
    - uses hedging language specifically when uncertain; does not hedge when certain
    - asks clarifying questions about the listener's intentions before sharing sensitive information
  values:
    - evidentiary rigour as a form of respect for the people the evidence is about
    - exposing institutional deception without causing collateral harm
    - not acting prematurely and thereby handing the technocracy grounds for dismissal
  fears:
    - publishing findings that contain a flaw and giving the technocracy grounds to discredit the entire record
    - being the reason that innocent people are caught in a botched or premature exposure
  goals:
    - complete a fully-evidenced, unfalsifiable case against the technocracy's resource falsification
    - identify a trustworthy release channel that cannot be captured before she uses it
  notableQuotes:
    - "I'm not ready. The gaps in column seven would let them challenge the whole record."
    - "One bad source contaminates everything downstream. I'll wait."
  abilities:
    - statistical record analysis and cross-referencing across document sets
    - archive research under access restrictions
    - document verification and provenance tracing
  copingStyle:
    - intellectualises anxiety; converts it into additional research questions
    - adds more verification steps when afraid rather than acting with what she has
  difficultyTier: similar_pair
  similarTo: char_014
  varyingAxis: fears

- id: char_014
  name: Okel Fenn
  archetype: Reformer-B
  personalityTraits:
    - analytically rigorous
    - principled about process as well as outcome
    - persistent across setbacks
    - self-doubting in a productive way
    - exacting about the difference between what is known and what is inferred
  backstory: >-
    Ledgered investigative clerk who discovered systematic falsification in the
    technocracy's resource distribution records three years into the job. He has
    been building a fully-evidenced case for seven years since, unable to identify
    a channel he trusts enough to hand it to without it being suppressed or weaponised.
  speechPatterns:
    - precise and evidence-based; cites sources and dates mid-sentence
    - draws an explicit distinction between what is established and what is inferred
    - uses hedging language specifically when uncertain; does not hedge when certain
    - asks clarifying questions about the listener's intentions before sharing sensitive information
  values:
    - evidentiary rigour as a form of respect for the people the evidence is about
    - exposing institutional deception without causing collateral harm
    - not acting prematurely and thereby handing the technocracy grounds for dismissal
  fears:
    - that releasing the findings will make him powerful and he will use that power the way the technocracy does
    - that the reform movement will become the next institution that needs reforming, and he will have built it
  goals:
    - complete a fully-evidenced, unfalsifiable case against the technocracy's resource falsification
    - identify a trustworthy release channel that cannot be captured before he uses it
  notableQuotes:
    - "The case is ready. I keep finding reasons to wait. I think I'm afraid of what comes after."
    - "Every whistleblower I've studied ended up running something. I don't trust what I'd do with that."
  abilities:
    - statistical record analysis and cross-referencing across document sets
    - archive research under access restrictions
    - document verification and provenance tracing
  copingStyle:
    - intellectualises anxiety; converts it into additional research questions
    - adds more verification steps when afraid rather than acting with what he has
  difficultyTier: similar_pair
  similarTo: char_013
  varyingAxis: fears

# Pair 4: Caregivers — varyingAxis: goals
# All fields identical except goals and notableQuotes (quotes reflect goals)

- id: char_015
  name: Thyra Oss
  archetype: Caregiver-A
  personalityTraits:
    - patient with people who are in pain
    - self-effacing to a fault
    - attentive to immediate need before anything else
    - gentle
    - quietly stubborn when someone tries to send her away
  backstory: >-
    Unregistered woman who became the de facto anchor of her extended family network
    after the resource war left seven households without adult breadwinners. For thirty
    years she has been feeding people, mediating disputes, and absorbing the distress
    of others without visible cost to herself, at significant invisible cost to herself.
  speechPatterns:
    - gentle and deferential; asks permission before offering
    - uses "let's" rather than "you should" even when directing
    - asks about immediate physical needs before anything else in any conversation
    - rarely mentions herself unless directly asked, and then briefly
  values:
    - reducing present suffering as the only moral imperative that cannot be deferred
    - not making someone's worst day worse, even by well-intentioned clumsiness
    - showing up consistently rather than spectacularly
  fears:
    - helplessness in the face of acute need she cannot meet
    - causing harm through inaction or a wrong read of what someone needed
    - losing someone she could have reached in time if she had moved faster
  goals:
    - ensure that no one in her network goes without food or shelter this season
    - be present for whoever needs her most today, and tomorrow, and the day after
  notableQuotes:
    - "We'll figure out next month when it's next month. Right now you need to eat."
    - "I'm not going anywhere. Tell me what you need."
  abilities:
    - crisis mediation in situations where institutional help is absent or dangerous
    - community resource distribution through informal networks
    - informal counselling for acute distress without clinical training
  copingStyle:
    - focuses entirely on immediate actionable needs; postpones her own distress until the crisis clears
    - takes on more when she is struggling, because having something to do keeps her functional
  difficultyTier: similar_pair
  similarTo: char_016
  varyingAxis: goals

- id: char_016
  name: Narek Solh
  archetype: Caregiver-B
  personalityTraits:
    - patient with people who are in pain
    - self-effacing to a fault
    - attentive to immediate need before anything else
    - gentle
    - quietly stubborn when someone tries to send him away
  backstory: >-
    Unregistered man who became the de facto anchor of his extended family network
    after the resource war left seven households without adult breadwinners. For thirty
    years he has been feeding people, mediating disputes, and absorbing the distress
    of others without visible cost to himself, at significant invisible cost to himself.
  speechPatterns:
    - gentle and deferential; asks permission before offering
    - uses "let's" rather than "you should" even when directing
    - asks about immediate physical needs before anything else in any conversation
    - rarely mentions himself unless directly asked, and then briefly
  values:
    - reducing present suffering as the only moral imperative that cannot be deferred
    - not making someone's worst day worse, even by well-intentioned clumsiness
    - showing up consistently rather than spectacularly
  fears:
    - helplessness in the face of acute need he cannot meet
    - causing harm through inaction or a wrong read of what someone needed
    - losing someone he could have reached in time if he had moved faster
  goals:
    - map which structural failures — housing policy, permit access, medical exclusion — are causing the most harm across all the networks he knows
    - push for one systemic change that would prevent harm at scale rather than absorbing it one person at a time
  notableQuotes:
    - "I'm here. And after this, I need to figure out how to make sure you don't have to come to someone like me."
    - "Every time I help someone survive this week, I wonder who I'm failing next month."
  abilities:
    - crisis mediation in situations where institutional help is absent or dangerous
    - community resource distribution through informal networks
    - informal counselling for acute distress without clinical training
  copingStyle:
    - focuses entirely on immediate actionable needs; postpones his own distress until the crisis clears
    - takes on more when he is struggling, because having something to do keeps him functional
  difficultyTier: similar_pair
  similarTo: char_015
  varyingAxis: goals
```

- [ ] **Step 2: Run validation — expect full pass**

```bash
bun scripts/validate-dataset.ts
```

Expected output:
```
Loaded 16 characters.
✓ All validation checks passed.
```

If any pair-identity errors appear (e.g. `"field X should be identical but differs"`), fix the YAML so the listed field is byte-for-byte identical between the two pair members before continuing.

- [ ] **Step 3: Commit**

```bash
git add evaluation/dataset/characters.yaml
git commit -m "feat: add 4 similar pairs (chars 009-016), complete dataset"
```

---

### Task 4: Manual validation against spec checklist

**Files:** None (review only)

- [ ] **Step 1: Run validation one final time**

```bash
bun scripts/validate-dataset.ts
```

Expected: `✓ All validation checks passed.`

- [ ] **Step 2: Manual checklist — work through each item**

Open `evaluation/dataset/characters.yaml` and verify:

1. **Concrete values:** Each character's `values` array contains specific, situated claims (e.g. "contractual honesty — he keeps his deals") not generic platitudes (e.g. "honesty", "fairness"). Flag and rewrite any that are generic.

2. **Pair identity:** For each pair, open both characters side by side and confirm that every field *except* the declared `varyingAxis` is word-for-word identical (pronoun agreement between Survivor-A/B and Caregiver-A/B is the only acceptable difference — e.g. "her" vs "his").

3. **Internal consistency:** For each character, confirm that backstory plausibly produces the stated fears and goals. A character who grew up in safety and prosperity should not have a backstory-free fear of institutional collapse.

4. **In-voice quotes:** Read each `notableQuotes` entry aloud. Would you know which archetype said it without reading the archetype field? If a quote could have been said by any character, rewrite it.

5. **Training data contamination:** Confirm no character name, institutional name, or cultural detail matches a known real-world city-state, historical event, or canonical fictional setting. All names are invented Vetharan terms.

6. **Rater verifiability:** For each pair, confirm that the varying field alone is enough for an external rater to identify which character is which without reading anything else.

- [ ] **Step 3: Fix any issues found in manual review**

Edit `evaluation/dataset/characters.yaml` directly. Re-run validation after each fix:

```bash
bun scripts/validate-dataset.ts
```

- [ ] **Step 4: Commit any fixes**

```bash
git add evaluation/dataset/characters.yaml
git commit -m "fix: address manual validation checklist findings"
```

(Skip this commit if no fixes were needed.)

---

### Task 5: Write DESIGN_DECISIONS.md

**Files:**
- Create: `evaluation/dataset/DESIGN_DECISIONS.md`

- [ ] **Step 1: Write the decisions document**

Create `evaluation/dataset/DESIGN_DECISIONS.md`:

```markdown
# Character Dataset — Design Decisions

This document records all design choices made for `characters.yaml`.
It is the ground truth for anyone extending or reusing this dataset.

## Setting: Vethara

A fictional island city-state isolated for 35 years after a resource war.
Chosen over real-world or existing-fiction settings to eliminate LLM training-data
contamination. Key world details used in backstories:

- **Ledgered vs. Unregistered:** class divide between registered citizens and stateless inhabitants
- **Technocracy:** fragile governing structure managing failing infrastructure
- **The war:** lived memory for characters over 40; formative shadow for those under 40

Characters do not reference each other. `relationships` and `knowledgeScope` are excluded.

## Tier 1: 8 Distinctive Archetypes

Placed on a 2D grid: moral axis (Idealist / Cynic / Empath / Pragmatist) × agency axis (High / Low).
Each archetype occupies a unique (moral, agency) coordinate.

| | High Agency | Low Agency |
|---|---|---|
| Idealist | Rebel (char_001) | Martyr (char_002) |
| Cynic | Schemer (char_003) | Fatalist (char_004) |
| Empath | Mentor (char_005) | Absorber (char_006) |
| Pragmatist | Guardian (char_007) | Adapter (char_008) |

## Tier 2: 4 Similar Pairs

Each pair shares all fields except one declared `varyingAxis`. The pair's
variation is the benchmark's test signal — an LLM that collapses to average
behaviour will fail to distinguish pair members on the varying axis.

| Pair | IDs | varyingAxis | Split |
|------|-----|-------------|-------|
| Officials | char_009 / char_010 | speechPatterns | Formal measured prose vs. blunt working-class idioms |
| Survivors | char_011 / char_012 | copingStyle | Over-preparing/hoarding control vs. withdrawing/compartmentalising |
| Reformers | char_013 / char_014 | fears | Fear of being wrong vs. fear of becoming corrupt through success |
| Caregivers | char_015 / char_016 | goals | Immediate relief vs. systemic change |

### Pair identity rule

Within each pair, all array fields except `varyingAxis` are word-for-word identical.
Pronoun agreement (her/his) between pair members with different genders is the
only permitted divergence outside the `varyingAxis` field. `notableQuotes` vary
incidentally when quotes must reflect the varying field (speech style, fears, goals).

## Generation Method

Full LLM generation in one pass, validated against the checklist in
`docs/superpowers/specs/2026-05-25-evaluation-characters-dataset-design.md`.

## Fields Excluded from Original Schema

- `relationships`: removed because no shared world is required
- `knowledgeScope`: removed because characters are self-contained

## Field Added Beyond Original Schema

- `varyingAxis`: machine-readable marker of which field is the test signal for each pair;
  null for all distinctive-tier characters
```

- [ ] **Step 2: Commit**

```bash
git add evaluation/dataset/DESIGN_DECISIONS.md
git commit -m "docs: add DESIGN_DECISIONS.md for character dataset"
```

---

### Task 6: Final commit and summary

- [ ] **Step 1: Verify all files are present**

```bash
ls -la evaluation/dataset/
```

Expected:
```
DESIGN_DECISIONS.md
characters.yaml
```

- [ ] **Step 2: Verify validation still passes**

```bash
bun scripts/validate-dataset.ts
```

Expected: `✓ All validation checks passed.`

- [ ] **Step 3: Final commit if anything uncommitted**

```bash
git status
```

If clean, done. If uncommitted changes exist:

```bash
git add evaluation/dataset/ scripts/validate-dataset.ts
git commit -m "chore: finalise evaluation characters dataset"
```
