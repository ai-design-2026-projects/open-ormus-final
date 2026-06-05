---
description: List, search, update, or delete characters in the OpenOrmus collection. Use when the user wants to see their characters, find a specific one, edit a profile, or remove a character.
---

# Manage Characters

## List all characters
Call `character_list`. Present as a readable list with name and short description.

## Find by name
Call `character_find` with `{ query: "<name>" }`. If multiple results, show them and ask the user to pick one.

## Update a character
1. Resolve the ID with `character_find` or `character_list`.
2. Show the current profile.
3. Collect the changes.
4. Build the full updated object — `character_update` replaces the entire sheet.
5. Call `character_update` with the complete profile.

## Delete a character
1. Resolve the ID.
2. The hook will surface a confirmation prompt — wait for the user to confirm.
3. Call `character_delete` with `{ id: "<id>" }`.

Never guess an ID. Always resolve first.
