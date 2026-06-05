---
description: Evaluate a completed conversation for character fidelity and quality. Use when the user wants to score or review how well characters performed.
---

# Evaluate Conversation

## Steps

1. Ask for `conversationId` or `jobId` if not provided.
2. Call `conversation_job_status` with `{ jobId: "<id>" }`.
   - If `status !== "completed"`, tell the user the conversation is not done yet and stop.
3. Present the conversation messages.
4. For each character, evaluate:
   - **Speech pattern fidelity**: does the dialogue match how this character speaks?
   - **Personality consistency**: do actions and words match their values, fears, and goals?
   - **Knowledge scope**: does the character stay within what they would know?
5. Give an overall fidelity score (0–10) per character with specific examples from the transcript.
