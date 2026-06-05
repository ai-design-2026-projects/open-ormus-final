---
description: Archive (soft-delete) a character from the collection. Use when the user wants to remove a character without permanently deleting them.
---

# Archive Character

Soft-delete a character so they no longer appear in the active collection.

`character_delete` performs a soft-delete (archive) — characters are not permanently removed.

## Steps

1. Resolve the ID using `character_find` or `character_list`.
2. Confirm with the user: "Archive <name>? They will be hidden from your collection."
3. If confirmed, call `character_delete` with `{ id: "<id>" }`.
4. If the result is `{ error: "already_archived" }`, tell the user the character is already archived.
5. Otherwise, report success.
