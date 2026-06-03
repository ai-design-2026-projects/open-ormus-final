# Agent Refactor & Tool Migration Design

**Date:** 2026-06-02  
**Status:** Approved  

---

## 1. Goal

- Remove all local (frontend-only) tools from the agent.
- Expose all capabilities exclusively through MCP.
- Rename tools for clarity — internal and external MCP consumers get identical, unambiguous names and descriptions.
- Make the agent prompt minimal and generic — tool descriptions carry all workflow knowledge.
- Fix the Zod v3/v4 mismatch in `mcp_server`.
- Execute batched tool calls in parallel using `Promise.allSettled` — each result captured independently, failures don't abort siblings.
- Delete `scene_simulate` and `start_character_wizard` entirely.
- Improve `show_research` by splitting the internal Exa query into two calls (show metadata + character lookup per show).

---

## 2. Architecture

```
Before:
  frontend/lib/agent/loop.ts
    ├── local tools (exa_research.ts, wizard.ts) → packages/shared services (Exa)
    └── mcp_bridge → MCP server (6 tools exposed)

After:
  frontend/lib/agent/loop.ts
    └── mcp_bridge → MCP server (7 tools exposed)

  packages/shared/tool-descriptions.ts   ← single source of truth for description strings
    ├── imported by frontend/lib/agent/mcp_bridge.ts
    └── imported by mcp_server/src/registry/tools/*.ts
```

Description strings live once in `packages/shared/tool-descriptions.ts`. Both the internal agent bridge and external MCP consumers import from there — no drift possible.

Input schemas stay where they are: bridge hardcodes OpenAI-format `input_schema`; server tools use Zod schemas from `packages/shared/schema/`.

---

## 3. Tool Inventory

### Final tool set (8 → 7, plus 1 renamed)

| New tool ID | Old tool ID | Change |
|---|---|---|
| `mcp__openormus__show_research` | `mcp__openormus__show_search` | Rename + rework internals |
| `mcp__openormus__character_research` | `mcp__openormus__character_search` | Rename + add to bridge |
| `mcp__openormus__character_create` | `mcp__openormus__character_save` | Rename |
| `mcp__openormus__character_find` | `mcp__openormus__character_db_search` | Rename |
| `mcp__openormus__character_list` | `mcp__openormus__character_list` | Description update only |
| `mcp__openormus__character_update` | `mcp__openormus__character_update` | Description + bridge schema fix |
| `mcp__openormus__character_delete` | `mcp__openormus__character_delete` | Description update only |

### Removed entirely

| What | Where |
|---|---|
| `mcp__openormus__scene_simulate` | MCP server + bridge |
| `research_show_online` | Frontend local tool |
| `research_character_basics` | Frontend local tool |
| `research_character_details` | Frontend local tool |
| `start_character_wizard` | Frontend local tool |

### Naming rationale

- `*_research` = goes online (Exa). Agent and external consumers immediately know this costs a network call.
- `character_find` = searches within the saved collection. No `_db_` implementation leak.
- `character_create` = unambiguous CRUD verb instead of `_save`.

---

## 4. Tool Descriptions

Centralised in `packages/shared/tool-descriptions.ts`:

```ts
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
    "Pass the object returned by character_research directly, or construct one manually. " +
    "If any required fields are missing, ask the user for them one at a time before calling. " +
    "Returns the saved character with its assigned ID.",

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
    "Replaces the entire sheet — include all fields, not just the changed ones.",

  character_delete:
    "Delete a character from the collection by ID. " +
    "Resolve the ID first with character_find or character_list.",
} as const;
```

---

## 5. Agent System Prompt

```ts
export const AGENT_SYSTEM_PROMPT = `You are an assistant for OpenOrmus, a platform for collecting and managing fictional characters.

Use the tools available to you to help the user research, add, find, update, and delete characters.

## Rules

- Never invent or guess character IDs. Resolve them first with character_find or character_list.
- When a tool returns an error, explain it to the user in plain language.
- Keep responses concise. When listing characters, summarise — do not dump raw JSON.`;
```

No hardcoded workflows. Tool descriptions carry all sequencing knowledge.

---

## 6. show_research — Internal Implementation Change

`showSearchHandler` in `packages/shared/services/show_search.service.ts` becomes two sequential Exa calls per result:

1. **Show metadata call** — returns `{ title, description, year, genre }` for up to 3 matching shows. No characters.
2. **Character lookup call (per show)** — focused Exa query for characters of each show. No `maxItems` cap.

**Error policy:** if either Exa call fails for any reason, the tool call fails completely. No partial results.

Output shape is unchanged: `{ results: [{ title, description, year, genre, characters: string[] }] }`.

---

## 7. character_update Bridge Schema Fix

Current bridge schema for `character_update`:
```ts
sheet: { type: "object", description: "New CharacterSearchResult object" }  // opaque
```

Replacement — full `CharacterSearchResult` shape (same as `character_create.personality` parent):
```ts
sheet: {
  type: "object",
  properties: {
    name, imageUrl, shortDescription, firstAppearanceDate, personality: { ... }
  },
  required: [...]
}
```

Matches `CharacterUpdateInputShape` in `packages/shared/schema/character_saved.ts` which uses `CharacterSearchResultSchema`.

---

## 8. Zod Version Fix

**Problem:** `packages/shared` uses Zod v4; `mcp_server` uses Zod v3. `server.tool()` from `@modelcontextprotocol/sdk` expects Zod v3 schemas. Tools currently cast with `as any`.

**Fix:** Migrate `mcp_server` to Zod v4. Verify `@modelcontextprotocol/sdk@^1.29` is compatible with Zod v4 schemas, or upgrade the SDK if needed. Remove all `as any` casts from tool registrations.

---

## 9. Data Flow

**Import from franchise:**
```
show_research("Breaking Bad")
  → { results: [{ title, characters: ["Walter White", ...] }] }
for each name:
  character_research("Walter White, Breaking Bad")
    → full profile or { error }
  on success: character_create(profile) → saved with ID
  on error: skip, inform user
```

**Single character:**
```
character_research("Walter White, Breaking Bad") → profile
character_create(profile)
```

**Manual creation (partial user input):**
```
agent asks missing fields one at a time
character_create(assembled profile)
```

**Find / update / delete:**
```
character_find("Walter") → [{ id, name, shortDescription }]
character_update({ id, sheet }) / character_delete({ id })
```

---

## 10. Files Changed

### New
- `packages/shared/tool-descriptions.ts`

### Modified
- `packages/shared/services/show_search.service.ts` — two internal Exa calls
- `packages/shared/schema/show_search.ts` — remove characters from metadata query schema if needed
- `frontend/lib/agent/mcp_bridge.ts` — import descriptions, rename tools, add `show_research` + `character_research`, remove `scene_simulate`, fix `character_update` schema
- `frontend/lib/agent/loop.ts` — remove local tool imports and handlers; replace sequential tool execution with `Promise.allSettled`
- `frontend/lib/agent/prompt.ts` — new minimal prompt
- `mcp_server/package.json` — upgrade Zod to v4
- `mcp_server/src/registry/tools/character_search.ts` → update tool ID string + import description (rename file optional, tool ID is what matters)
- `mcp_server/src/registry/tools/show_search.ts` → update tool ID string + import description
- `mcp_server/src/registry/tools/character_save.ts` → update tool ID string + import description
- `mcp_server/src/registry/tools/character_db_search.ts` → update tool ID string + import description
- `mcp_server/src/registry/tools/character_list.ts` — import description
- `mcp_server/src/registry/tools/character_update.ts` — import description
- `mcp_server/src/registry/tools/character_delete.ts` — import description
- `mcp_server/src/registry/index.ts` — update registrations if tool file names change

### Deleted
- `frontend/lib/agent/tools/exa_research.ts`
- `frontend/lib/agent/tools/wizard.ts`
- `mcp_server/src/registry/tools/scene_simulate.ts`
- `mcp_server/src/registry/tools/scene_simulate.test.ts`
- `packages/shared/schema/scene.ts`
- `packages/shared/schema/scene.test.ts`

---

## 11. Parallel Tool Execution

`loop.ts` currently executes tool calls sequentially. Replace with `Promise.allSettled`:

```ts
const toolResults = await Promise.allSettled(
  toolCalls.map(async (toolCall) => { ... })
);
```

Each settled result is mapped to a `tool` message regardless of outcome — fulfilled results return the value, rejected results return `{ error: "..." }`. The agent sees all results and decides what to skip.

**Why `allSettled` over `Promise.all`:** a single failed `character_research` call must not abort the remaining characters in a batch import. Each result is independent.

**Impact:** importing 8 characters fires all `character_research` calls simultaneously. ~8x speedup for batch imports. Single-tool calls unaffected.

---

## 12. Exa Search Quality Fixes

All fixes in `packages/shared/services/`. No schema changes. No new tools.

### Problem 1 — Duplicate show results
Same show returned under multiple titles (e.g. "Money Heist", "Money Heist (La casa de papel)", "Money Heist (TV series)").

**Fix A — System prompt:** add *"Return each unique show only once. Use the most internationally recognised title."*

**Fix B — Post-processing:** after Exa returns results, deduplicate by normalised title (lowercase, strip parenthetical suffixes `/ \(.*\)$/`). Keep first occurrence.

### Problem 2 — Actor names in characters list
`show_research` returns actor/cast names instead of character names.

**Fix — System prompt:** add *"The `characters` array must contain only the names of fictional characters in the story. Never include actor names, cast members, or real-world people."*

### Problem 3 — Character query returns actor biography
When a character shares a name with a real actor, Exa returns the actor's biography and personality.

**Fix A — Query prefix:** prepend `"fictional character"` to every character research query.
```ts
// Before
args.query  // "Bruno, Money Heist"

// After
`fictional character ${args.query}`  // "fictional character Bruno, Money Heist"
```

**Fix B — System prompt hardening:** add to both `characterBasicsHandler` and `characterDetailsHandler` system prompts: *"The subject is always a fictional character, never a real person. If a real person shares this name, ignore them entirely and focus only on the fictional character."*

---

## 13. Implementation Constraints

- **Tool ID audit:** hardcoded IDs exist only in `prompt.ts`, `mcp_bridge.ts`, `exa_research.ts`, `wizard.ts` — all files being modified or deleted. No other consumers found.
- **Zod cast removal depends on SDK compatibility** — verify before removing `as any`.
- **`character_update` full-replace semantics** — the tool replaces the entire `sheet`. Agent must include all fields when constructing the update payload.
