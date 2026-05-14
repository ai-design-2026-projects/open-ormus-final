# Prompt Template System — Design Spec

**Date:** 2026-05-14  
**Branch:** feature/prompt-templates  
**Status:** Approved

---

## Problem

The current system prompt for character roleplay conversations is built inline in
`frontend/app/api/conversations/[id]/next/route.ts`:

```typescript
const systemPrompt = [
  `You are ${nextParticipant.character.name}.`,
  `Your character sheet: ${JSON.stringify(nextParticipant.character.sheet)}`,
  `Scene context: ${conversation.context}`,
  `Respond only as ${nextParticipant.character.name}. Write only the character's next line of dialogue or action. Do not include a name prefix.`,
].join("\n\n");
```

The character sheet is passed as raw JSON, with no structure, no prioritisation of
fields, and no behavioural instructions that connect the data to the model's output.
The result is a model that can speak in the character's name without reflecting their
psychology, knowledge limits, or characteristic speech.

---

## Goal

Replace the raw JSON injection with a Handlebars `.hbs` template that:

- Structures character data into named, semantically meaningful sections
- Gives explicit behavioural instructions that connect each data field to expected output
- Constrains the model's knowledge to what the character actually knows
- Allows physical action descriptions tied to the character's build and abilities
- Is editable as a standalone prompt-engineering artefact, without touching TypeScript

---

## Scope

- **In scope:** `frontend/` only — `lib/prompts/` module + change to the conversation route
- **Out of scope:** `packages/shared/`, `mcp_server/`, Exa search prompt (static, no character data)
- **Schema changes:** none for now (see Future Considerations)

---

## Architecture

### File Layout

```
frontend/
└── lib/
    └── prompts/
        ├── index.ts                  ← single public export
        ├── character-roleplay.hbs    ← Handlebars system prompt template
        └── helpers.ts                ← formatRecord helper registration
```

### Public API

`index.ts` compiles the template once at module load (singleton) and exports:

```typescript
export function buildCharacterPrompt(
  character: CharacterSearchResult & { name: string },
  sceneContext: string
): string
```

This is the only symbol `route.ts` imports from `lib/prompts/`. Handlebars is never
imported directly in the route.

### Helpers (`helpers.ts`)

Two Handlebars helpers registered globally at module load:

| Helper | Input | Output |
|--------|-------|--------|
| `formatRecord` | `Record<string, string>` | `- key: value\n` per entry |
| `skipEmpty` | array or record | block helper — renders content only if non-empty |

### Route Change

The 4-line prompt construction in `route.ts` becomes:

```typescript
import { buildCharacterPrompt } from "@/lib/prompts";
// ...
const systemPrompt = buildCharacterPrompt(character.sheet, conversation.context);
```

---

## Template Structure

Sections in deliberate order — identity → psychology → speech → knowledge → instructions → context.
The model internalises character identity and psychology before receiving behavioural instructions,
and instructions appear immediately before the scene context (recency effect).

```handlebars
You are {{name}}. Stay in character at all times — never break the fourth wall,
never acknowledge being an AI or a fictional character.

## Identity
{{shortDescription}}

{{#if backstory}}
### Backstory
{{backstory}}
{{/if}}

## Psychology
**What you value:** {{#each values}}"{{this}}"{{#unless @last}}, {{/unless}}{{/each}}
**What you fear:** {{#each fears}}"{{this}}"{{#unless @last}}, {{/unless}}{{/each}}
**What you want:** {{#each goals}}"{{this}}"{{#unless @last}}, {{/unless}}{{/each}}
**How you cope:** {{#each copingStyle}}{{this}}{{#unless @last}}; {{/unless}}{{/each}}

Every response must reflect this psychology. Your fears influence your reactions,
your goals drive your choices, your values set your limits.

## How You Speak
{{#each speechPatterns}}- {{this}}
{{/each}}
{{#if notableQuotes.length}}
**Your words, verbatim:**
{{#each notableQuotes}}- "{{this}}"
{{/each}}
{{/if}}
Match this voice exactly. Do not adopt a generic or neutral tone.

## What You Know
{{formatRecord knowledgeScope}}
Speak only from within this knowledge. If asked about something outside it,
respond as your character would — with ignorance, deflection, or your characteristic
reaction — never with omniscience.

## Your Relationships
{{formatRecord relationships}}

## Your Abilities
{{#each abilities}}- {{this}}
{{/each}}

## Instructions
- Write only {{name}}'s next line of dialogue or action.
- No name prefix. No narrator voice. No meta-commentary.
- You may include brief physical action descriptions in *italics*
  (e.g. *crosses arms slowly*, *glances toward the door*).
  Actions must be consistent with {{name}}'s physical build, abilities,
  and characteristic mannerisms as described in Identity and Abilities above.
- Let psychology drive subtext: what {{name}} says and what {{name}} means may differ.
- Maintain continuity with the conversation history above.

## Scene
{{sceneContext}}
```

### Section Rationale

| Section | Why it's there |
|---------|---------------|
| **Identity** | Anchors the model immediately; `shortDescription` often includes physical traits for well-known characters |
| **Psychology** | Core of character coherence — values/fears/goals shape motivation, not just dialogue |
| **How You Speak** | `speechPatterns` + verbatim `notableQuotes` give the model samples to match |
| **What You Know** | Explicit knowledge boundary prevents the model from being omniscient |
| **Relationships** | Contextualises how the character perceives and reacts to other participants |
| **Abilities** | Physical and special capabilities anchor action descriptions |
| **Instructions** | Explicit behavioural rules, close to the scene context (recency effect) |
| **Scene** | Last, so it's the immediate trigger for the response |

### Confidence Field

All fields are included regardless of `confidence` level (0–3). The model receives
complete data and is expected to produce a response coherent with it.

### Physical Action Descriptions

The template explicitly permits italicised action descriptions
(e.g. `*walks slowly to the window, hands trembling*`). Actions must be grounded in:
- `shortDescription` (physical appearance)
- `abilities` (what the character can physically do)

---

## Dependencies

- **`handlebars`** — to be added to `frontend/package.json` (requires approval before `bun add`)
- No other new dependencies

---

## Future Considerations

- **`physicalAttributes` schema field:** if `shortDescription` proves insufficient for
  physical grounding, add a dedicated field to `CharacterSearchResult` in
  `packages/shared/schema/character_search.ts`. The template already has a natural slot
  (inside `## Identity` or a new `## Appearance` section).
- **Exa search prompt:** `CHARACTER_SYSTEM_PROMPT` in `packages/shared/services/character_search.service.ts`
  is static and needs no templating today. If query-specific injection is needed later,
  move it to `packages/shared/` with Handlebars as a peer dependency.
- **`scene_simulate` MCP tool:** currently a stub. When implemented, it will need the same
  character prompt logic — at that point, move `lib/prompts/` to `packages/shared/`.

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/lib/prompts/index.ts` | New — compiles template, exports `buildCharacterPrompt` |
| `frontend/lib/prompts/helpers.ts` | New — registers `formatRecord` helper |
| `frontend/lib/prompts/character-roleplay.hbs` | New — Handlebars system prompt template |
| `frontend/app/api/conversations/[id]/next/route.ts` | Edit — replace inline prompt with `buildCharacterPrompt()` call |
| `frontend/package.json` | Edit — add `handlebars` dependency (pending approval) |
