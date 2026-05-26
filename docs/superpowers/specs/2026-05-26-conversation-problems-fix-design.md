# Conversation Problems Fix — Design Spec

**Date:** 2026-05-26  
**Status:** Approved  
**Branch:** worktree-conversation-problems-fix

---

## Problem Summary

Six bugs found in the conversation functionality:

1. **Wrong speaker selection strategy** — orchestrator is always called for 3+ participant convos, ignoring the `turnStrategy` field. Round-robin convos get orchestrator anyway.
2. **Characters unaware of other participants** — the system prompt has no cast section; each character speaks as if alone.
3. **Unfocused reasoning** — current 2-call architecture: call 1 generates free-form psych fragments disconnected from the actual upcoming reply. Characters "think random things" rather than reasoning about what to say.
4. **`</dialogue>` tag leaks into streaming UI** — the strip runs after stream end (DB save), but the UI accumulates raw tokens live. The closing tag is briefly visible to the user.
5. **Reasoning models double-reason** — models with native extended thinking (deepseek-r1, claude-3-7-sonnet with thinking, o1/o3) run their internal CoT *and* our explicit reasoning call. Native reasoning must be disabled via OpenRouter's `reasoning: { effort: "none" }` param.
6. **Emotions displayed incorrectly** — the `<emotion>/<dialogue>` streaming parser has edge cases that emit emotion-block content as dialogue tokens; new format eliminates those paths.

---

## Approach

**Unified single-call format.** Replace the 2-call architecture (reasoning call + content call) with one streaming call whose response embeds reasoning and emotion inline:

```
<|reasoning|>
[character's private thoughts about what was just said and what to write next]
<|reasoning|>
<|emotion|>{"emotion":"Fear","intensity":"high","subtext":"..."}<|emotion|>
Dialogue text here.
```

Issues 1 and 2 are independent surgical fixes. Issues 3, 4, 5, 6 are solved by the unified format.

---

## Section 1 — Turn Strategy Fix

**File:** `frontend/lib/conversation/next.ts`

**Root cause:** `next.ts:60` uses `participants.length >= 3` as the orchestrator guard. The `conversation.turnStrategy` field is fetched from DB but never consulted.

**Fix:** Replace the guard:

```ts
// before
if (conversation.participants.length >= 3) {

// after
if (conversation.turnStrategy === "ORCHESTRATOR") {
```

---

## Section 2 — Cast Awareness

**Files:** `frontend/lib/prompts/index.ts`, `frontend/lib/prompts/character-roleplay.hbs`, `frontend/lib/conversation/next.ts`

**Root cause:** `buildCharacterPrompt(sheet, context)` receives no participant list. The template has no cast section.

**Fix:**

- `buildCharacterPrompt` gets a new parameter: `otherParticipantNames: string[]`
- Template gains a conditional section before `## Scene`:
  ```handlebars
  {{#if otherParticipants}}
  ## Scene Cast
  You are sharing this scene with: {{otherParticipants}}.
  {{/if}}
  ```
- Call site in `next.ts` passes all participant names except the speaking character.

---

## Section 3 — Unified Message Format

**Files:**
- `frontend/lib/prompts/character-roleplay.hbs` — Output Format section rewritten
- `frontend/lib/conversation/next.ts` — remove call 1, new streaming parser
- `frontend/lib/conversation/build-messages.ts` — remove `reasoning` param, update historical assistant message format
- `packages/shared/schema/emotion.ts` — update `parseEmotionBlock` for `<|emotion|>` tags

### System prompt (`character-roleplay.hbs`)

The `## Output Format` section is rewritten to specify the new format. Key rules added:

- The `<|reasoning|>` block is written first. The character thinks about what other characters just said and decides what to write next. This block is private — it must never appear in dialogue and must not be referenced or hinted at.
- The `<|emotion|>` block follows immediately after, containing the same JSON structure as before.
- The dialogue text follows the closing `<|emotion|>` tag, with no wrapper tag.

### Streaming parser (`next.ts`)

Single streaming call replaces the 2-call architecture. Parser state machine:

| State | Transition |
|-------|-----------|
| `pre_reasoning` | On second occurrence of `<\|reasoning\|>` in buffer → extract reasoning, enter `pre_emotion` |
| `pre_emotion` | On first `<\|emotion\|>` → enter `emotion` |
| `emotion` | On second `<\|emotion\|>` → parse JSON, call `onEmotion`, enter `dialogue` |
| `dialogue` | Emit every token directly |

Reasoning and emotion tokens are buffered internally, never yielded to the caller. The `</dialogue>` strip at the end of the function is removed (no dialogue tag exists in the new format).

`reasoning` is extracted from the inline block and saved to DB (same `reasoning` field as before — UI display unchanged).

`reasoning: { effort: "none" }` is always added to `extra_body` to disable native thinking tokens on all models.

### Historical assistant messages (`build-messages.ts`)

The `reasoning` parameter is removed from `buildCharacterMessages`. Historical assistant messages are reconstructed in the new format:

- If `reasoning` is present: `<|reasoning|>{reasoning}<|reasoning|><|emotion|>{emotionJson}<|emotion|>{content}`
- If `reasoning` is null (old messages): `<|emotion|>{emotionJson}<|emotion|>{content}`

Other characters' lines remain formatted via `buildHistoryLine(name, content, emotion, intensity, subtext)` — reasoning is never passed and never exposed to other characters. Reasoning is **reasoner-limited**: each character only sees their own past reasoning blocks, never those of others.

### Emotion parser (`packages/shared/schema/emotion.ts`)

`parseEmotionBlock` updated to match `<|emotion|>...<|emotion|>` pattern instead of `<emotion>...</emotion>`.

---

## Section 4 — Reasoning Model Handling

`reasoning: { effort: "none" }` is added unconditionally to `extra_body` on every LLM content call. Non-reasoning models ignore the parameter. Reasoning models (deepseek-r1, claude-3-7-sonnet with thinking, o1/o3) have their native thinking tokens disabled — our `<|reasoning|>` block serves as the replacement.

No env var needed.

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/lib/conversation/next.ts` | Turn strategy fix; remove call 1; new parser; add `reasoning: {effort: "none"}`; remove `</dialogue>` strip; pass cast to prompt |
| `frontend/lib/prompts/index.ts` | Add `otherParticipantNames` param; remove `buildReasoningSystemPrompt`/`buildReasoningUserMessage` |
| `frontend/lib/prompts/character-roleplay.hbs` | Add cast section; rewrite Output Format |
| `frontend/lib/conversation/build-messages.ts` | Remove `reasoning` param; update historical assistant format |
| `packages/shared/schema/emotion.ts` | Update `parseEmotionBlock` for `<\|emotion\|>` tags |
| `frontend/lib/__tests__/build-messages.test.ts` | Update tests to match new historical assistant message format |

---

## Section 5 — Emotion UI

**File:** `frontend/components/ui/emotion-dot.tsx`, `frontend/app/conversations/[id]/page.tsx`

**Problem:** `EmotionDot` renders only a colored circle. The emotion name and subtext are invisible (subtext is a `title` tooltip only). Users can't read what the character is feeling.

**Fix:** Add `showLabel?: boolean` prop to `EmotionDot`.

When `showLabel={true}`, the component renders inline:

```
● Fear · "Trying not to show weakness"
```

Dot keeps existing color (by emotion) and size/opacity (by intensity). The label shows `{emotion} · "{subtext}"` in a small muted style. If `subtext` is empty, just `{emotion}`.

**Usage site changes:**
- Cast sidebar (line ~270): stays as-is — no `showLabel`. Sidebar is compact; dot alone suffices.
- Message list (line ~324): add `showLabel={true}`.
- Streaming message (line ~349): add `showLabel={true}`.

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/lib/conversation/next.ts` | Turn strategy fix; remove call 1; new parser; add `reasoning: {effort: "none"}`; remove `</dialogue>` strip; pass cast to prompt |
| `frontend/lib/prompts/index.ts` | Add `otherParticipantNames` param; remove `buildReasoningSystemPrompt`/`buildReasoningUserMessage` |
| `frontend/lib/prompts/character-roleplay.hbs` | Add cast section; rewrite Output Format |
| `frontend/lib/conversation/build-messages.ts` | Remove `reasoning` param; update historical assistant format |
| `packages/shared/schema/emotion.ts` | Update `parseEmotionBlock` for `<\|emotion\|>` tags |
| `frontend/components/ui/emotion-dot.tsx` | Add `showLabel` prop |
| `frontend/app/conversations/[id]/page.tsx` | Pass `showLabel` on message list and streaming rows |
| `frontend/lib/__tests__/build-messages.test.ts` | Update tests to match new historical assistant message format |

---

## Out of Scope

- Database migration — `emotion`/`intensity`/`subtext`/`reasoning` fields unchanged; only the LLM output format changes.
- Eval track — not touched.
