# Group Chat Orchestrator — Design Spec

**Date:** 2026-05-14  
**Branch:** feature/group-chat-orchestrator  
**Status:** Approved

---

## Problem

All conversations currently use round-robin to select the next speaker (`messages.length % participants.length`). For group chats (3+ characters), this produces unnatural, mechanical turn-taking that ignores character personalities and conversational context.

## Goal

- 1-1 chats (1–2 participants): keep round-robin unchanged.
- Group chats (3+ participants): use an LLM orchestrator that reads the full conversation history and character personalities to decide who speaks next.

---

## Architecture

**One new file, one modified file.**

```
frontend/lib/orchestrator.ts          ← new: selectNextSpeakerWithOrchestrator()
frontend/app/api/conversations/[id]/next/route.ts  ← modified: branch on participants.length
```

No DB changes. No new env vars. No new endpoints.

The branch in `next/route.ts`:

```
participants.length >= 3?
  ├── yes → selectNextSpeakerWithOrchestrator(participants, messages)
  └── no  → existing round-robin (unchanged)
```

---

## Data Flow

### Function signature

```ts
selectNextSpeakerWithOrchestrator(
  participants: Array<{
    characterId: string;
    character: { name: string; sheet: Json };
  }>,
  messages: Array<{
    characterId: string;
    character: { name: string };
    content: string;
  }>
): Promise<string>  // returns characterId
```

### What changes in the route query

The existing query already loads participants with character data. Messages need to include `character { name }` via a join — this is the only query change needed.

---

## Prompt Structure

```
System:
  You are a conversation director for a multi-character roleplay scene.
  Given the characters and conversation history below, decide which character
  should speak next to make the conversation feel natural and engaging.
  Reply with only the characterId of the chosen character, nothing else.

User:
  Characters:
  - id: <uuid1> | Name: Alice | Personality: <JSON.stringify(sheet)>
  - id: <uuid2> | Name: Bob   | Personality: <JSON.stringify(sheet)>
  - id: <uuid3> | Name: Carol | Personality: <JSON.stringify(sheet)>

  Conversation so far:
  [Alice]: ...
  [Bob]: ...
  [Alice]: ...

  Which character should speak next? Reply with their characterId only.
```

- Full conversation history — no truncation.
- `character.sheet` serialised with `JSON.stringify`. If null, field omitted.
- Model: `CONVERSATION_MODEL` env var (same as the speaker call).

---

## Error Handling

| Case | Behavior |
|------|----------|
| LLM returns unknown characterId | Fallback to round-robin |
| LLM call throws / times out | Fallback to round-robin, log to stderr |
| `character.sheet` is null | Field omitted from prompt, no crash |

No retries. No circuit breaker. The conversation continues regardless.

---

## Out of Scope (for now)

- Anti-collapse fairness constraints (e.g. max % of turns per character)
- Sliding window / history truncation
- Separate `ORCHESTRATOR_MODEL` env var
- Any UI changes
