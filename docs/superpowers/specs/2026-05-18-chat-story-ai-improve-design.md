# Scene Context AI Improvement — Design Spec

**Date:** 2026-05-18  
**Branch:** worktree-chat-story-ai-improve  
**Status:** Approved

---

## Overview

Add an "Improve" button to the Scene context textarea in the conversation creation modal. Clicking it sends the draft context and selected characters to a dedicated LLM endpoint, then presents a side-by-side modal (original vs improved) where the user can Accept or Discard the result.

---

## Architecture & Data Flow

```
conversations/page.tsx (create modal)
  └─ "Improve" button click
       ├─ POST /api/conversations/improve-context
       │    body: { draft: string, characterIds: string[] }
       │    ↓
       │    auth: supabase.auth.getUser() → 401 if unauthenticated
       │    ↓
       │    prisma.character.findMany({ where: { id: { in: characterIds }, userId } })
       │    → parse sheet via CharacterPersonalitySchema
       │    ↓
       │    build system prompt + user message
       │    ↓
       │    Anthropic client → messages.create() (no streaming)
       │    ↓
       │    return { improved: string }
       └─ ImproveContextModal opens
            ├─ Accept → setContext(improved), close modal
            └─ Discard → close modal
```

No DB schema changes. `Conversation.context` stores the final accepted text, unchanged from current behavior. The endpoint fetches character sheets server-side using `userId` from auth — no client-side personality data needed.

---

## API Route

**Path:** `POST /api/conversations/improve-context`  
**Auth:** `supabase.auth.getUser()` — 401 if missing  
**File:** `frontend/app/api/conversations/improve-context/route.ts`

### Request body (Zod-validated)

```ts
{
  draft: string;          // the raw scene context text
  characterIds: string[]; // IDs of selected participants — endpoint fetches sheets from DB
}
```

### Response

```ts
{ improved: string }   // 200
{ error: string }      // 400 | 401 | 500
```

### Logging

Each call logs to `stderr` as structured JSON:

```ts
{
  component: "improve-context",
  userId,
  model: process.env.CONVERSATION_MODEL ?? "default",
  prompt_hash: sha256(draft).slice(0, 8),
  latency_ms,
  timestamp: new Date().toISOString(),
}
```

---

## LLM Prompt

### System prompt

```
You are a creative writing assistant specializing in fictional scene-setting.
Your task: improve a scene context description for a roleplay/story simulation.

Rules:
- If the input is sparse (fewer than 3 sentences or note-form): expand into a vivid, atmospheric paragraph
- If the input is a longer draft: polish prose, fix inconsistencies, improve narrative flow
- Preserve all factual details and character names from the original
- Output ONLY the improved text — no explanation, no preamble, no quotes
```

### User message (template)

```
Characters in this scene:
{characters.map(c => `- ${c.name}: ${c.personalityTraits.join(", ")}. ${c.backstory}`).join("\n")}

Scene context draft:
{draft}
```

Character data is fetched server-side by the endpoint using `characterIds` from the request body and `userId` from auth. The `sheet` JSON column is parsed via `CharacterPersonalitySchema` to extract `personalityTraits[0..2]` and `backstory`. The modal only needs to send `character.id` values — no sheet data on the client.

---

## UI Components

### `ImproveContextButton`

Inline in the create modal, positioned next to the "Scene context" label.

- Renders `✨ Improve` button (small, secondary variant)
- **Disabled** when: textarea empty, no characters selected, or request in-flight
- Shows spinner while loading
- On click: fires POST, captures `draft` at click-time, opens modal on success
- On error: shows toast "Improvement failed — try again", does not open modal

### `ImproveContextModal`

New component. Uses existing shadcn `Dialog`.

- Two panels side-by-side, equal width  
  - Left: "Original" (read-only)  
  - Right: "Improved" (read-only)  
- Footer: "Accept" (primary) + "Discard" (secondary) buttons
- Accept: calls `setContext(improved)`, closes modal
- Discard: closes modal, no state change
- Mobile: panels stack vertically (original on top)

---

## Error Handling

| Case | Behavior |
|------|----------|
| Empty textarea | Button disabled |
| No characters selected | Button disabled |
| LLM returns empty string | Toast: "Improvement failed — try again" |
| API 5xx / network error | Toast: "Improvement failed — try again", modal does not open |
| User edits draft after clicking Improve | Modal shows draft captured at click-time |
| Unauthenticated request | 401 response, toast shown |

---

## Files to Create / Modify

| Action | Path |
|--------|------|
| Create | `frontend/app/api/conversations/improve-context/route.ts` |
| Create | `frontend/components/conversations/ImproveContextButton.tsx` |
| Create | `frontend/components/conversations/ImproveContextModal.tsx` |
| Modify | `frontend/app/conversations/page.tsx` — wire in button and modal |

---

## Out of Scope

- Streaming the improved text word-by-word
- Improving the chat input textarea (not the scene context)
- Persisting improvement history
- User-configurable prompt tone/style
