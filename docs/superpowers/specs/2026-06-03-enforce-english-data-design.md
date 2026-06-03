# Enforce English-Canonical Data — Design

**Date:** 2026-06-03
**Status:** Approved (pending spec review)
**Branch:** `worktree-enforce-english`

## Goal

All generated, stored data — character personality, story/backstory, conversation
roleplay turns, and scene context — must be written in **English only**. Users may
interact with the system in any language; the system understands the input but always
**produces and persists English**.

This is enforced entirely at the **prompt layer**. No schema, parser, or data-model
changes.

## Scope

### In scope
Four prompt sites that generate persisted text:

1. **Character research** — `packages/shared/services/character_search.service.ts`
   (`BASICS_SYSTEM_PROMPT`, `PERSONALITY_SYSTEM_PROMPT`, `CONNECTIONS_SYSTEM_PROMPT`).
2. **Manual character creation/edit via agent** — `frontend/lib/agent/prompt.ts`
   (`AGENT_SYSTEM_PROMPT`) and `packages/shared/tool-descriptions.ts`
   (`character_create`, `character_update`).
3. **Roleplay turns** — `frontend/lib/prompts/character-roleplay.hbs`.
4. **Scene context generation** — `frontend/app/api/conversations/improve-context/route.ts`
   (`SYSTEM_PROMPT`).

### Out of scope
- User's own typed messages (`user-message` route) — stored as-typed, untranslated.
  Users may write in any language; only **generated/AI-authored** data is English.
- No Prisma schema change. `Message.content` is already the English-canonical column.
- No parser change in `frontend/lib/conversation/next.ts`.
- No UI change.
- No language-selection setting.

## Decisions (resolved during brainstorming)

- **Characters reply in English only.** A character understands input in any language
  but always answers in English. (Supersedes an earlier "reply in user's language,
  store English translation" option — rejected: "Characters must write only in
  english. No space for other languages.")
- **User messages are not translated.** Stored as the user typed them.
- **Scene context is in scope** — generated context must be English.

## Design

### 1. Character research prompts
Append to each of `BASICS_SYSTEM_PROMPT`, `PERSONALITY_SYSTEM_PROMPT`,
`CONNECTIONS_SYSTEM_PROMPT`:

> "Write all output fields in English, regardless of the source material's language."

### 2. Manual creation/edit via the assistant agent
Add a rule to `AGENT_SYSTEM_PROMPT`:

> "All character data is stored in English. If the user provides details in another
> language, translate them to English before calling character_create or
> character_update."

Reinforce in the `character_create` and `character_update` tool descriptions
(`packages/shared/tool-descriptions.ts`) so the constraint is visible at tool-call time:

> "All fields must be in English; translate any non-English input before saving."

### 3. Roleplay output
Add a rule to `character-roleplay.hbs` (Instructions section):

> "Always respond in English — dialogue, the `<|reasoning|>` block, and the emotion
> subtext. The user may write in any language; understand it, but always reply in
> English."

No change to the output format, the structured blocks, or the streaming parser.
`Message.content` continues to hold the (now guaranteed-English) dialogue.

### 4. Scene context
Append to the `improve-context` route `SYSTEM_PROMPT`:

> "Always write the improved scene context in English, regardless of the draft's
> language."

## Consistency notes
- The evaluation track and multi-character history both read `Message.content`,
  which is now uniformly English — no mixed-language continuity issues.
- The orchestrator (next-speaker selection) reads English content/reasoning — unaffected.

## Verification
Prompt-only change. Verify by:
- `bun run typecheck` (no type impact expected).
- `bun test --cwd mcp_server` (tool-description/registry tests still pass).
- Manual: create a character from a non-English query / chat to the agent in another
  language → stored sheet is English; run a roleplay turn replying to a non-English
  user message → character replies in English; improve a non-English scene draft →
  output is English.

## Risks
- Prompt adherence is probabilistic, not guaranteed. Models may occasionally leak the
  input language. Acceptable for this iteration; a hard post-generation language check
  is explicitly deferred (YAGNI for now).
