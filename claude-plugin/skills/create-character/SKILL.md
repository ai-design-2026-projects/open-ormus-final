---
description: Create a new OpenOrmus character. Use when the user wants to add a character, build a character profile, or save a new character to their collection.
---

# Create Character

Guide the user to create a character and save it to OpenOrmus.

## Decision: research or manual?

Ask the user: is this an existing fictional character (from a show, book, film, game) or an original character?

- **Existing character**: call `character_research` with `{ query: "<name>, <show>" }`. Present the result to the user for confirmation, then call `character_create` with the returned data.
- **Original character**: collect all required fields one at a time. Do NOT call `character_create` until every field is populated.

## Required fields for `character_create`

ALL of these must be present:
- `name` (string)
- `shortDescription` (string, 1–2 sentences)
- `imageUrl` (string URL or null)
- `firstAppearanceDate` (ISO date or null)
- `personality.personalityTraits` (string[])
- `personality.backstory` (string)
- `personality.relationships` (object: name → description)
- `personality.speechPatterns` (string)
- `personality.values` (string[])
- `personality.fears` (string[])
- `personality.goals` (string[])
- `personality.notableQuotes` (string[])
- `personality.abilities` (string[])
- `personality.copingStyle` (string)
- `personality.knowledgeScope` (string)

All fields must be in English — translate non-English input before saving.
