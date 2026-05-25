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
Permitted divergences outside the `varyingAxis` field:

- `name` and `archetype` — each pair member has a distinct name and an A/B archetype label (e.g. `Official-A` / `Official-B`) for machine-readable identification
- `backstory` — pronoun agreement (her/his/they) for different-gender pair members; the narrative content is otherwise identical
- `notableQuotes` — vary when the varying axis directly shapes what a character would say (`speechPatterns`, `fears`, `goals` pairs); identical when the varying axis is behavioural (`copingStyle` pair)

## Generation Method

Full LLM generation in one pass, validated against the checklist in
`docs/superpowers/specs/2026-05-25-evaluation-characters-dataset-design.md`.

## Fields Excluded from Original Schema

- `relationships`: removed because no shared world is required
- `knowledgeScope`: removed because characters are self-contained

## Field Added Beyond Original Schema

- `varyingAxis`: machine-readable marker of which field is the test signal for each pair;
  null for all distinctive-tier characters
