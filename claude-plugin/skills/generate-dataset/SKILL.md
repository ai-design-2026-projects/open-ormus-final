---
description: Generate an evaluation dataset from completed OpenOrmus conversations. Use when the user wants to build a dataset for offline LLM evaluation.
---

# Generate Dataset

## Steps

1. Call `character_list` to get all characters.
2. Ask which characters to include, or confirm all.
3. For each included character, call `conversation_job_status` for their completed conversations.
4. Format as JSON Lines — one object per line:

```json
{ "conversationId": "uuid", "characterId": "uuid", "characterName": "string", "turns": [{ "speaker": "string", "text": "string" }] }
```

5. Present the dataset or write to a file if the user specifies a path.

Only include conversations where `status === "completed"`.
