---
description: Research a fictional character online and preview their profile. Use when the user wants to explore a character before deciding whether to save them.
---

# Research Character

Look up a fictional character without saving.

## Steps

1. Ask for the character name and show/context if not provided.
2. Call `character_research` with `{ query: "<name>, <show>" }`.
3. Present the full profile to the user in a readable format.
4. Ask: "Would you like to save this character to your collection?"
   - Yes → call `character_create` with the returned data.
   - No → done.
