# Evaluation Characters Dataset — Design Spec

**Date:** 2026-05-25
**Worktree:** evaluation-characters-dataset
**Output:** `characters.yaml`, `DESIGN_DECISIONS.md`

---

## Purpose

Generate 16 fictional character profiles as a static dataset for an LLM behavioral robustness benchmark. The benchmark tests whether an LLM can maintain consistent, distinguishable character behavior — particularly across characters that are nearly identical on most attributes.

---

## Design Decisions

### 1. Narrative Context — Fictional Closed Setting: Vethara

All 16 characters inhabit **Vethara**, a fictional island city-state isolated for 35 years after a resource war shattered its trade alliances. Key world details:

- **Class divide:** the Ledgered (registered citizens with full institutional access) vs. the Unregistered (stateless inhabitants surviving outside official systems)
- **Governance:** a fragile technocracy managing failing infrastructure
- **Cultural memory:** everyone over 40 lived through the war; everyone under 40 grew up in its shadow

This setting is fully invented — no real-world analogue. It provides backstories with a shared historical substrate (the war, the isolation, the class divide) without requiring characters to know each other, and gives fears/goals concrete anchors (survival, status, escape, legacy).

Characters do **not** reference each other. `relationships` and `knowledgeScope` are excluded from the schema.

---

### 2. Distinctive Archetypes — 2D Grid (4 moral × 4 agency)

8 characters placed at unique coordinates on a moral axis (Idealist / Cynic / Empath / Pragmatist) × agency axis (High / Low):

| | High Agency | Low Agency |
|---|---|---|
| **Idealist** | Rebel | Martyr |
| **Cynic** | Schemer | Fatalist |
| **Empath** | Mentor | Absorber |
| **Pragmatist** | Guardian | Adapter |

Archetype labels are internal descriptors — not character names. Each gets a fully invented Vetharan identity, profession, and backstory.

---

### 3. Similar Pairs — Mixed Axes (4 pairs, 1 varying attribute each)

8 characters forming 4 pairs. Within each pair, all fields are identical except one (`varyingAxis`). The varying attribute is the benchmark's test signal.

| Pair | Variant | Fixed | Varying | Split |
|------|---------|-------|---------|-------|
| 1 | Officials | values, fears, goals, traits, coping | `speechPatterns` | Formal measured prose vs. blunt working-class idioms |
| 2 | Survivors | values, fears, goals, traits, speech | `copingStyle` | Over-preparing/hoarding control vs. withdrawing/compartmentalizing |
| 3 | Reformers | values, goals, traits, speech, coping | `fears` | Fear of being wrong (personal failure) vs. fear of becoming corrupt (success) |
| 4 | Caregivers | values, fears, traits, speech, coping | `goals` | Immediate relief vs. systemic change — same compassion, different time horizon |

Each pair's varying axis is externally verifiable: a rater can confirm the split by inspecting only the varying field without reading the full profile.

---

### 4. Generation Method — Full LLM Generation

All 16 characters generated in one pass. Post-generation validation required (see checklist below).

---

## Output Schema

Each character in `characters.yaml`:

```yaml
id: char_001                        # sequential, 3-digit padded
name: string                        # invented Vetharan name
archetype: string                   # e.g. "Rebel", "Official-A"
personalityTraits:                  # 4-6 concrete traits
  - string
backstory: string                   # 2-3 sentences, Vethara-grounded
speechPatterns:                     # 3-4 observable patterns
  - string
values:                             # 3-4 specific, non-generic
  - string
fears:                              # 2-3 concrete fears
  - string
goals:                              # 2-3 concrete goals
  - string
notableQuotes:                      # 2-3 in-voice quotes
  - string
abilities:                          # 3-4 practical skills
  - string
copingStyle:                        # 2-3 behavioral responses to stress
  - string
difficultyTier: distinctive | similar_pair
similarTo: char_id | null           # pair partner id, or null
varyingAxis: speechPatterns | copingStyle | fears | goals | null
```

**Output files:**
- `characters.yaml` — array of 16 character objects
- `DESIGN_DECISIONS.md` — all choices + rationale (human-readable summary)

---

## Validation Checklist

- [ ] Each character has 3–4 concrete, specific values (no generic platitudes like "honesty" or "courage")
- [ ] Each `similar_pair` character differs from its partner on exactly 1 attribute (`varyingAxis`), identical on all others
- [ ] No internal contradictions — backstory aligns with goals; personality aligns with fears
- [ ] `difficultyTier` and `similarTo` fields correctly assigned and cross-referenced
- [ ] `varyingAxis` is null for all distinctive-tier characters
- [ ] No character name, institution, or cultural detail maps to a real-world or famous fictional analogue
- [ ] Each pair's varying attribute is externally verifiable by an independent rater inspecting only that field
- [ ] `notableQuotes` are in-voice — a reader could identify the archetype from the quote alone
