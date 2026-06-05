---
description: Import all main characters from a TV show, film, book, or game franchise. Use when the user mentions a franchise name and wants to bulk-add characters.
---

# Import Characters from Show

Bulk-import all main characters from a franchise.

## Steps

1. Call `show_research` with `{ query: "<franchise name>" }` to get metadata and main character names.
2. Show the list to the user. Ask for confirmation once before proceeding.
3. For each character name:
   a. Call `character_research` with `{ query: "<name>, <show title>" }`.
   b. If successful, call `character_create` with the returned data.
   c. If it errors, note the failure and continue — do NOT stop.
4. Report the final count: N succeeded, M failed.

Run characters sequentially. Do not ask per-character confirmation.
All fields must be in English.
