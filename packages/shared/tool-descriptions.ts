// packages/shared/tool-descriptions.ts
export const TOOL_DESCRIPTIONS = {
  show_research:
    "Search online for a TV series, film, or book by title. " +
    "Returns show metadata and a list of main character names. " +
    "Call this first when importing characters from a franchise, " +
    "then call character_research for each name in the returned list. " +
    "Fails completely if any part of the lookup fails.",

  character_research:
    "Research a fictional character online by name. " +
    "Returns a complete profile (traits, backstory, relationships, speech patterns) " +
    "ready to pass directly to character_create. " +
    "Include show context in the query for accuracy (e.g. 'Walter White, Breaking Bad'). " +
    "Returns an error if the character cannot be identified — skip and continue.",

  character_create:
    "Save a character profile to the collection. " +
    "IMPORTANT: Do NOT call this tool until you have ALL required fields. " +
    "Required fields: name, shortDescription, imageUrl (null if unknown), firstAppearanceDate (null if unknown), " +
    "and a complete personality object with: personalityTraits, backstory, relationships, speechPatterns, " +
    "values, fears, goals, notableQuotes, abilities, copingStyle, knowledgeScope. " +
    "If using character_research, pass its output directly — all fields are already populated. " +
    "If constructing manually, collect every missing field from the user one at a time before calling. " +
    "Returns the saved character with its assigned ID." +
    " All fields must be in English; translate any non-English input before saving.",

  character_find:
    "Search saved characters in the collection by name or description using fuzzy matching. " +
    "Use this to resolve a character name to an ID before updating or deleting. " +
    "Returns matching characters with IDs and short descriptions.",

  character_list:
    "List all characters saved in the collection. " +
    "Use when the user wants an overview or when searching by name is not precise enough.",

  character_update:
    "Replace a character's full profile by ID. " +
    "Resolve the ID first with character_find or character_list. " +
    "Replaces the entire sheet — include all fields, not just the changed ones." +
    " All fields must be in English; translate any non-English input before saving.",

  character_delete:
    "Delete a character from the collection by ID. " +
    "Resolve the ID first with character_find or character_list.",
} as const;
