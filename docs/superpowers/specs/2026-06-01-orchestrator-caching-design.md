# Orchestrator Caching — Design

**Date:** 2026-06-01
**Branch:** worktree-orchestrator-caching

---

## Problem

`selectNextSpeakerWithOrchestrator` issues a single-turn LLM call on every orchestrator invocation:

```
system: "You are a conversation director..."
user:   "Characters:\n[list]\n\nConversation so far:\n[ALL messages]\n\nWho speaks next?"
```

The user message grows with every turn — full history is retokenized on every call. No caching fires. Cost scales linearly with conversation length.

---

## Goal

Enable implicit prefix caching on orchestrator calls so that:
- Cost scales with **one new user message per turn**, not total history length
- System prompt + all prior decision pairs are cached
- Reasoning (private thoughts) from each character is visible to the orchestrator

---

## Design

### Architecture

Two units:

```
frontend/lib/conversation/build-orchestrator-messages.ts   ← pure function, testable
frontend/lib/orchestrator.ts                               ← modified to use above
```

`buildOrchestratorMessages` is a pure function — no I/O, no side effects. Takes participants and messages, returns the full messages array. `selectNextSpeakerWithOrchestrator` calls it and passes the result to the LLM. No changes to `next.ts` or the job runner.

### Message format

**System prompt** (stable for conversation lifetime):

```
You are a conversation director for a multi-character roleplay scene.
Given the conversation history below, decide which character should speak
next to make the conversation feel natural and engaging.
Reply with only the characterId of the chosen character, nothing else.

Characters:
- id: <characterId> | Name: <name>
- id: <characterId> | Name: <name>
...
```

No character sheets — name and id only. System prompt is small and stable.

**Historical turns** — one pair per prior message spoken, all stable:

Turn 0 (scene start, always present):
```
user:  "(The scene has just begun — no lines have been spoken yet.) Who should speak first? Reply with their characterId only."
asst:  messages[0].characterId
```

Turn 1..N-1:
```
user:  "[CharacterName]: <content>\nPrivate thoughts: <reasoning>   ← omitted if reasoning is null
       \nWho speaks next? Reply with their characterId only."
asst:  messages[i+1].characterId
```

**Final user message** (always new, never cached):
```
user:  "[CharacterName]: <content>\nPrivate thoughts: <reasoning>\nWho speaks next? Reply with their characterId only."
```

### Cache hit pattern

On turn N (N messages already in conversation):
- System prompt → cached (stable)
- Turns 0..N-2 (historical pairs) → cached (stable, grow by one each time)
- Turn N-1 (final user message) → new, not cached

Cost per orchestrator call = tokens for one user message + output, regardless of conversation length.

### Type changes

`OrchestratorMessage` gains `reasoning: string | null`:

```ts
type OrchestratorMessage = {
  character: { name: string };
  content: string;
  reasoning: string | null;
};
```

`next.ts` already selects `reasoning` in the Prisma query — no schema change, no query change needed.

### Edge cases

- **Empty messages** (scene not started): return only the scene-start user message. No historical pairs, no prior assistant turns.
- **`reasoning` is null**: omit the `Private thoughts:` line from that turn entirely.
- **Single participant**: valid — orchestrator still runs and always returns the same id.
- **Invalid characterId from LLM**: existing fallback (round-robin) unchanged.

---

## Implementation Scope

| File | Change |
|------|--------|
| `frontend/lib/conversation/build-orchestrator-messages.ts` | New — pure function |
| `frontend/lib/orchestrator.ts` | Use `buildOrchestratorMessages`; update `OrchestratorMessage` type |
| `frontend/lib/__tests__/build-orchestrator-messages.test.ts` | New — unit tests |

No changes to:
- `next.ts` — call site unchanged
- DB schema — `message.reasoning` already exists and is already selected
- Job runner — unchanged
- `buildCharacterMessages` / character conversation path — unchanged

---

## Testing

New file: `frontend/lib/__tests__/build-orchestrator-messages.test.ts`

Test cases (pure function, no LLM mocking needed):

1. **Empty messages** → scene-start user message only, no prior pairs
2. **One message** → scene-start + assistant(msg[0].characterId) + final user message containing msg[0] content
3. **N messages** → N historical pairs with correct characterIds in assistant turns + final user message
4. **Reasoning null** → `Private thoughts:` line absent from that turn
5. **Reasoning present** → `Private thoughts:` line included in that turn

---

## Constraints

- Implicit caching threshold varies by provider. System prompt is intentionally small (name + id only) — caching benefit comes primarily from the growing historical turns prefix, not system prompt size. This is still a significant win at conversation lengths > 5 turns.
- `conversation.context` is NOT included in the orchestrator system prompt (unlike the character system prompt) — the orchestrator only needs to select a speaker, not understand the scene deeply.
- If a character is added/removed mid-conversation (participants change), system prompt changes and cache is invalidated. This is acceptable — participant changes are rare and intentional.
