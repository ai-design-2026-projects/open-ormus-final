---
description: Start a new multi-character conversation in OpenOrmus. Use when the user wants to simulate a scene, run characters in dialogue, or create a roleplay scenario.
---

# Start Conversation

Design and launch a multi-character conversation.

## Steps

1. **Characters**: resolve at least 2 character IDs using `character_list` or `character_find`.
2. **Context**: ask for a 2–5 sentence scene description (setting, reason for meeting, tone, any constraints).
3. **Strategy**:
   - `ORCHESTRATOR` — AI picks who speaks next; best for organic dialogue
   - `ROUND_ROBIN` — fixed rotation; best for structured scenes
   Ask the user or recommend ORCHESTRATOR for most scenes.
4. **Turns**: ask for turn count (1–500). Suggest 10–20 for a short scene, 50+ for longer.
5. Call `conversation_start` with `{ characterIds, context, turnStrategy, turns }`.
6. Report the returned `conversationId` and `jobId` to the user, then **STOP**.

## Anti-polling rule
After calling `conversation_start`, do NOT call `conversation_job_status`.
The UI streams live progress automatically.
Only call `conversation_job_status` if the user explicitly asks: "what's the status?" or "show me the results."
