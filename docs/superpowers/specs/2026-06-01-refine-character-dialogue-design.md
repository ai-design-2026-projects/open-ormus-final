# Refine Character Dialogue — Design Spec

**Date:** 2026-06-01  
**Branch:** worktree-refine-character-dialogue

---

## Problem

Two behavioural issues in the multi-character conversation system:

1. **Scene drift** — characters ignore the scene set by the user and talk about unrelated topics. Drift starts from the first character's message.
2. **Generic messages** — characters know each other's names but produce standalone monologues instead of reacting directly or addressing specific characters.

---

## Root Causes

### Issue 1 — Scene drift

- `buildCharacterMessages` sends `"(The scene has just begun — no lines have been spoken yet.)"` as the first user message — no scene text included.
- The continuation prompt (last user message, sent every turn) is `"Continue as X. Write only their next line."` — no scene reference.
- Scene context only appears in the system prompt (`## Scene`, at the bottom of a 79-line template). LLMs weight message content more heavily than distal system prompt text.
- First character goes off-topic → subsequent characters follow via message history, compounding the drift.

### Issue 2 — Generic messages

- `## Scene Cast` in the system prompt is purely informational: `"You are sharing this scene with: X, Y."` — no instruction to engage directly.
- Continuation prompt is generic: `"Continue as X. Write only their next line."` — no cue to react or address someone.

---

## Design

### Fix 1 — Scene anchoring in user messages

**File: `frontend/lib/conversation/build-messages.ts`**

Add `sceneContext: string` parameter to `buildCharacterMessages`.

Replace `SCENE_START` constant with a function that includes the scene:

```
The scene has just begun — no lines have been spoken yet.

Scene: <sceneContext>
```

Update continuation prompt (last user message, sent every turn) to include scene:

```
<other characters' lines>

Scene: <sceneContext>
Continue as X. Write only their next line.
```

When no prior messages (first speaker, no others yet), use the scene-aware SCENE_START in place of other characters' lines.

**File: `frontend/lib/conversation/next.ts`**

Pass `conversation.context` as `sceneContext` argument to `buildCharacterMessages`.

**Caching impact:** None meaningful. The continuation prompt is already a cache miss every turn (it contains the latest messages). SCENE_START only appears once per character and gets cached on their second turn. System prompt is unchanged.

---

### Fix 2 — Direct engagement instructions

**File: `frontend/lib/prompts/character-roleplay.hbs`**

Add `## Engagement` section immediately after `## Scene Cast` (only rendered when `otherParticipants` is non-empty):

```handlebars
{{#if otherParticipants}}
## Scene Cast
You are sharing this scene with: {{otherParticipants}}.

## Engagement
- React directly to what the last speaker said — don't deliver standalone monologues
- Address specific characters by name when natural (e.g. "Walter, what do you think?")
- Ask questions, challenge, invite response — make others speak
{{/if}}
```

**File: `frontend/lib/conversation/build-messages.ts`**

Add `lastSpeakerName: string | null` parameter to `buildCharacterMessages`.

When `lastSpeakerName` is non-null, append engagement cue to continuation prompt:

```
<other characters' lines>

Scene: <sceneContext>
Continue as X. React to what was just said or address someone directly. Write only their next line.
```

When `lastSpeakerName` is null (first speaker, no prior messages):

```
<SCENE_START with scene>
Continue as X. Write only their next line.
```

**File: `frontend/lib/conversation/next.ts`**

Derive `lastSpeakerName` from `conversation.messages.at(-1)?.character.name ?? null` and pass to `buildCharacterMessages`.

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/lib/conversation/build-messages.ts` | Add `sceneContext` + `lastSpeakerName` params; update SCENE_START and continuation prompt |
| `frontend/lib/conversation/next.ts` | Pass `conversation.context` and last speaker name to `buildCharacterMessages` |
| `frontend/lib/prompts/character-roleplay.hbs` | Add `## Engagement` section after `## Scene Cast` |

No schema changes. No new dependencies. No orchestrator changes.

---

## Out of Scope

- Orchestrator scene awareness (not needed — root cause is in message content, not speaker selection)
- System prompt reorder (message injection is the higher-leverage fix)
- Orchestrator returning addressee hints (added complexity for marginal gain)
