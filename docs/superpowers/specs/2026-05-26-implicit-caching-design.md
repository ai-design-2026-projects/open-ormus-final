# Implicit Caching Improvement — Character Conversations

**Date:** 2026-05-26
**Branch:** worktree-implicit-caching-improvement

---

## Problem

In `frontend/lib/conversation/next.ts`, Call 2 (content generation) currently builds its system prompt by appending the character's private reasoning to the character sheet:

```ts
const contentSystemPrompt = reasoning
  ? `${systemPrompt}\n\n[Your private thoughts...]\n${reasoning}`
  : systemPrompt;
```

This makes the system prompt unique every turn → Anthropic implicit caching never fires. The character sheet (`buildCharacterPrompt`) is stable and potentially 400–700+ tokens — expensive to retokenize on every turn.

Additionally, all conversation history is collapsed into a single flat user message, meaning the full history is retokenized on every call regardless of how much of it has already been processed.

---

## Goal

Enable Anthropic implicit caching on character conversation calls so that:
- Cost scales with **new content per turn**, not total conversation length
- Each character maintains its own independent cache entry
- Private reasoning remains invisible to other characters

---

## Design

### Per-character multi-turn messages array

Instead of a single flat user message containing all history, build a proper alternating messages array **from each character's point of view**:

- **assistant turns** = the character's own previous lines
- **user turns** = all other characters' lines spoken between this character's turns (bundled)

The historical portion of this array is **stable** — it only grows by one assistant+user pair each time the character speaks. Anthropic caches the prefix automatically.

### Reasoning injection

Private reasoning (from Call 1) is prepended to the **last user message only** — which is always new and never cached:

```
messages: [
  { role: "user",      content: "B: first line\nC: first line" },   ← stable
  { role: "assistant", content: "A's first response" },              ← stable
  { role: "user",      content: "B: second line" },                  ← stable
  { role: "assistant", content: "A's second response" },             ← stable
  { role: "user",      content: "[Private thoughts: {reasoning}]\n\nB: latest line. Continue as A." }
                                 ↑ always new — safe to mutate
]
```

Since thoughts are in the last user message of A's call only, B and C never see them.

### System prompt

`buildCharacterPrompt(sheet, conversation.context)` — unchanged, stable for the lifetime of a conversation. Cache-eligible from the second turn the character speaks.

### Cache hit pattern

```
A's cache entry:  system=[A's sheet]  +  historical turns from A's POV
B's cache entry:  system=[B's sheet]  +  historical turns from B's POV
C's cache entry:  system=[C's sheet]  +  historical turns from C's POV
```

On turn N where A speaks for the Kth time: A's call sends ~1 new user message and hits cache on system prompt + (K-1) historical turn pairs. Cost is proportional to new content only.

---

## Implementation Scope

**Single file:** `frontend/lib/conversation/next.ts`

Changes:
1. Add `buildCharacterMessages()` helper — constructs the per-character messages array from `conversation.messages`, given the speaking character's ID
2. Replace the existing `messages` construction in Call 2 with `buildCharacterMessages()`
3. Remove `contentSystemPrompt` — system prompt is always `systemPrompt` (no reasoning appended)
4. Inject reasoning as prefix to the last user message inside `buildCharacterMessages()`

No changes to:
- `buildCharacterPrompt` / `buildReasoningSystemPrompt` / `buildReasoningUserMessage`
- Call 1 (reasoning) — unchanged
- DB schema — `message.reasoning` column already exists
- History persistence — `appendTurns` / `getSessionMessages` — unchanged

---

## Constraints

- Implicit caching activates at ≥ 1024 tokens system prompt on supported models (claude-3-5-sonnet-20241022+). Minimal character sheets may not reach this threshold. The multi-turn prefix caching benefit applies regardless of threshold.
- LiteLLM proxy passes requests through to Anthropic transparently — no proxy-side changes needed.
- `conversation.context` is part of the system prompt via `buildCharacterPrompt`. If context changes mid-conversation, cache is invalidated for all characters. This is acceptable — context changes are rare and intentional.

---

## Error handling

- If `reasoning` is empty or Call 1 failed, last user message is constructed without the thoughts prefix — same as today.
- Multi-turn array construction must handle edge cases: character's first turn (no prior assistant turns), character speaks twice in a row (should not happen given turn strategy, but handle gracefully).
