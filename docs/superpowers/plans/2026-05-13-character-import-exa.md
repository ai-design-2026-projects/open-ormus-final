# Character Import via Exa Search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Exa search logic into `packages/shared` and add an "Import from Exa" step inside `CharacterFormWizard` that lets users find characters by collection or name, select them, and review pre-populated wizard fields before saving.

**Architecture:** Exa singleton + two handler functions move to `packages/shared/services/`; MCP tools become thin wrappers importing from shared. Two new Next.js route handlers expose the shared services to the frontend. `CharacterFormWizard` gains a new step 0 (create mode only) with `ImportStep` sub-component plus a queue-driven sequential review flow for multi-character imports.

**Tech Stack:** Bun, TypeScript strict, Next.js App Router, `exa-js`, Zod v4 (shared), shadcn/ui Tailwind classes, `bun:test`

---

## File Map

### New files
| Path | Purpose |
|---|---|
| `packages/shared/services/exa.ts` | Lazy-init Exa singleton (`getExa()`) |
| `packages/shared/services/show_search.service.ts` | `showSearchHandler` — lifted from MCP tool |
| `packages/shared/services/show_search.service.test.ts` | Unit tests for `showSearchHandler` |
| `packages/shared/services/character_search.service.ts` | `characterSearchHandler` — lifted from MCP tool |
| `packages/shared/services/character_search.service.test.ts` | Unit tests for `characterSearchHandler` |
| `frontend/app/api/exa/show-search/route.ts` | POST /api/exa/show-search |
| `frontend/app/api/exa/character-search/route.ts` | POST /api/exa/character-search |
| `frontend/components/characters/ImportStep.tsx` | Import UI sub-component |

### Modified files
| Path | What changes |
|---|---|
| `packages/shared/package.json` | Add `exa-js` dependency |
| `packages/shared/index.ts` | Export `showSearchHandler`, `characterSearchHandler` |
| `mcp_server/package.json` | Remove `exa-js` |
| `mcp_server/src/registry/tools/show_search.ts` | Import `showSearchHandler` from shared |
| `mcp_server/src/registry/tools/character_search.ts` | Import `characterSearchHandler` from shared |
| `mcp_server/src/exa.ts` | Delete (only consumed by the two tool files) |
| `frontend/components/characters/CharacterFormWizard.tsx` | New import step, queue state, footer logic |

---

## Task 1: Add exa-js to shared and create lazy Exa singleton

**Files:**
- Modify: `packages/shared/package.json`
- Create: `packages/shared/services/exa.ts`

- [ ] **Step 1: Add exa-js to packages/shared/package.json**

Replace the `dependencies` block:

```json
{
  "name": "@open-ormus/shared",
  "version": "0.0.1",
  "private": true,
  "main": "./index.ts",
  "types": "./index.ts",
  "scripts": {
    "test": "bun test"
  },
  "dependencies": {
    "exa-js": "^2.12.1",
    "zod": "^4.4.3"
  }
}
```

- [ ] **Step 2: Create packages/shared/services/exa.ts**

```typescript
// packages/shared/services/exa.ts
import Exa from "exa-js";

let _exa: Exa | null = null;

/**
 * Returns the shared Exa client. Throws at call time (not import time)
 * if EXA_API_KEY is missing — safe to import in environments without the key.
 */
export function getExa(): Exa {
  if (_exa) return _exa;
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    throw new Error(
      "EXA_API_KEY environment variable is required. Set it in .env.local"
    );
  }
  _exa = new Exa(apiKey);
  return _exa;
}
```

- [ ] **Step 3: Install dependency**

```bash
bun install
```

Expected: lock file updates, no errors.

- [ ] **Step 4: Type-check shared**

```bash
bun run --cwd packages/shared tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/package.json packages/shared/services/exa.ts bun.lock
git commit -m "feat(shared): add exa-js dep and lazy Exa singleton"
```

---

## Task 2: Create show_search.service.ts in shared

**Files:**
- Create: `packages/shared/services/show_search.service.ts`
- Create: `packages/shared/services/show_search.service.test.ts`
- Modify: `packages/shared/index.ts`

- [ ] **Step 1: Write failing test**

Create `packages/shared/services/show_search.service.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { showSearchHandler } from "./show_search.service";

const validPayload = {
  results: [
    {
      title: "Money Heist",
      description: "A heist drama.",
      characters: ["Berlin", "Tokyo"],
      year: 2017,
      genre: "Crime",
    },
  ],
};

const mockSuccess = { answer: async (_q: unknown, _o: unknown) => ({ answer: validPayload }) };
const mockThrows = { answer: async () => { throw new Error("network fail"); } };
const mockBadJson = { answer: async () => ({ answer: "not-json{{{" }) };
const mockBadSchema = { answer: async () => ({ answer: { wrong: true } }) };

describe("showSearchHandler", () => {
  test("returns results on valid Exa response", async () => {
    const result = await showSearchHandler({ query: "Money Heist" }, mockSuccess);
    expect("error" in result).toBe(false);
    if ("results" in result) {
      expect(result.results[0]?.title).toBe("Money Heist");
    }
  });

  test("returns search_failed when Exa throws", async () => {
    const result = await showSearchHandler({ query: "x" }, mockThrows);
    expect(result).toEqual({ error: "search_failed" });
  });

  test("returns parse_failed when answer is bad JSON string", async () => {
    const result = await showSearchHandler({ query: "x" }, mockBadJson);
    expect(result).toEqual({ error: "parse_failed" });
  });

  test("returns parse_failed when answer fails schema validation", async () => {
    const result = await showSearchHandler({ query: "x" }, mockBadSchema);
    expect(result).toEqual({ error: "parse_failed" });
  });

  test("returns results when answer is an object (not string)", async () => {
    const mock = { answer: async () => ({ answer: validPayload }) };
    const result = await showSearchHandler({ query: "x" }, mock);
    expect("results" in result).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test packages/shared/services/show_search.service.test.ts
```

Expected: FAIL — `showSearchHandler` not found.

- [ ] **Step 3: Create packages/shared/services/show_search.service.ts**

```typescript
// packages/shared/services/show_search.service.ts
import type { ShowSearchInput, ShowSearchResult } from "../schema/show_search";
import { ShowSearchResultSchema } from "../schema/show_search";
import { getExa } from "./exa";

const SHOW_SYSTEM_PROMPT = `You are a fiction catalogue expert. Given a search query (e.g. "Berlin" or "Money Heist"), find up to 3 TV series, films, or books that best match. Return fewer than 3 results if fewer genuinely match. Rank by relevance to the query.`;

const SHOW_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string", description: "2–3 sentences" },
          characters: {
            type: "array",
            items: { type: "string" },
            maxItems: 8,
            description: "Main character names only",
          },
          year: { type: ["integer", "null"], description: "Release year" },
          genre: { type: ["string", "null"] },
        },
        required: ["title", "description", "characters", "year", "genre"],
      },
    },
  },
  required: ["results"],
} as const;

type ExaClient = { answer: (...args: unknown[]) => Promise<{ answer: unknown }> };

export async function showSearchHandler(
  args: ShowSearchInput,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exaClient: ExaClient = getExa() as any
): Promise<ShowSearchResult | { error: "parse_failed" | "search_failed" }> {
  try {
    const result = await exaClient.answer(args.query, {
      systemPrompt: SHOW_SYSTEM_PROMPT,
      outputSchema: SHOW_OUTPUT_SCHEMA,
    });

    let parsed: unknown;
    try {
      if (typeof result.answer === "object" && result.answer !== null) {
        parsed = result.answer;
      } else {
        const raw = String(result.answer ?? "{}")
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, "")
          .trim();
        parsed = JSON.parse(raw);
      }
    } catch {
      return { error: "parse_failed" };
    }

    const validated = ShowSearchResultSchema.safeParse(parsed);
    if (!validated.success) {
      return { error: "parse_failed" };
    }

    return validated.data;
  } catch {
    return { error: "search_failed" };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test packages/shared/services/show_search.service.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Export from packages/shared/index.ts**

In the existing show_search export block, add the `ShowResult` type (it is currently missing):

```typescript
export {
  ShowSearchInputShape,
  ShowSearchInputSchema,
  ShowResultSchema,
  ShowSearchResultSchema,
  type ShowResult,
} from "./schema/show_search";
```

Then add to the end of the file:

```typescript
export { showSearchHandler } from "./services/show_search.service";
```

- [ ] **Step 6: Type-check shared**

```bash
bun run --cwd packages/shared tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/services/show_search.service.ts packages/shared/services/show_search.service.test.ts packages/shared/index.ts
git commit -m "feat(shared): add showSearchHandler service with tests"
```

---

## Task 3: Create character_search.service.ts in shared

**Files:**
- Create: `packages/shared/services/character_search.service.ts`
- Create: `packages/shared/services/character_search.service.test.ts`
- Modify: `packages/shared/index.ts`

- [ ] **Step 1: Write failing test**

Create `packages/shared/services/character_search.service.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { characterSearchHandler } from "./character_search.service";

const validCharacter = {
  name: "Walter White",
  imageUrl: null,
  shortDescription: "Chemistry teacher turned drug lord.",
  firstAppearanceDate: "2008-01-20",
  confidence: 3,
  personality: {
    personalityTraits: ["intelligent", "prideful"],
    backstory: "High school chemistry teacher diagnosed with cancer.",
    relationships: { "Jesse Pinkman": "former student and partner" },
    speechPatterns: ["measured", "precise"],
    values: ["family", "pride"],
    fears: ["obscurity", "death"],
    goals: ["provide for family", "build empire"],
    notableQuotes: ["I am the one who knocks."],
    abilities: ["chemistry", "manipulation"],
    copingStyle: ["denial", "rationalization"],
    knowledgeScope: { chemistry: "expert" },
  },
};

const mockSuccess = { answer: async () => ({ answer: validCharacter }) };
const mockThrows = { answer: async () => { throw new Error("network fail"); } };
const mockNotFound = {
  answer: async () => ({
    answer: {
      ...validCharacter,
      confidence: 0,
      name: "",
      shortDescription: "",
      personality: {
        ...validCharacter.personality,
        personalityTraits: [],
        backstory: "",
        relationships: {},
        speechPatterns: [],
        values: [],
        fears: [],
        goals: [],
        notableQuotes: [],
        abilities: [],
        copingStyle: [],
        knowledgeScope: {},
      },
    },
  }),
};

describe("characterSearchHandler", () => {
  test("returns character on valid Exa response", async () => {
    const result = await characterSearchHandler({ query: "Walter White" }, mockSuccess);
    expect("error" in result).toBe(false);
    if ("name" in result) {
      expect(result.name).toBe("Walter White");
      expect(result.confidence).toBe(3);
    }
  });

  test("returns search_failed when Exa throws", async () => {
    const result = await characterSearchHandler({ query: "x" }, mockThrows);
    expect(result).toEqual({ error: "search_failed" });
  });

  test("returns character_not_found when confidence is 0", async () => {
    const result = await characterSearchHandler({ query: "x" }, mockNotFound);
    expect(result).toEqual({ error: "character_not_found" });
  });

  test("returns parse_failed when answer is bad JSON string", async () => {
    const mock = { answer: async () => ({ answer: "bad{json" }) };
    const result = await characterSearchHandler({ query: "x" }, mock);
    expect(result).toEqual({ error: "parse_failed" });
  });

  test("returns parse_failed when answer fails schema validation", async () => {
    const mock = { answer: async () => ({ answer: { wrong: true } }) };
    const result = await characterSearchHandler({ query: "x" }, mock);
    expect(result).toEqual({ error: "parse_failed" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test packages/shared/services/character_search.service.test.ts
```

Expected: FAIL — `characterSearchHandler` not found.

- [ ] **Step 3: Create packages/shared/services/character_search.service.ts**

```typescript
// packages/shared/services/character_search.service.ts
import {
  type CharacterSearchInput,
  type CharacterSearchResult,
  CharacterSearchResultSchema,
} from "../schema/character_search";
import { getExa } from "./exa";

export const CHARACTER_SYSTEM_PROMPT = `You are a fictional character analyst. Given a search query identifying a fictional character (e.g. "Berlin, Money Heist"), populate every field in the output schema with accurate data from your sources.

Confidence scale:
- 3: complete data from multiple consistent sources
- 2: partial data or minor inconsistencies across sources
- 1: sparse data, heavy inference required
- 0: character not identifiable from the query

If confidence is 0, set all string fields to "" and all arrays/objects to empty.`;

const CHARACTER_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    imageUrl: { type: ["string", "null"] },
    shortDescription: { type: "string", description: "1–2 sentences" },
    firstAppearanceDate: {
      type: "string",
      description: 'ISO 8601 date, e.g. "2017-05-02"; "0000-01-01" if unknown',
    },
    confidence: { type: "integer", minimum: 0, maximum: 3 },
    personality: {
      type: "object",
      properties: {
        personalityTraits: { type: "array", items: { type: "string" } },
        backstory: { type: "string" },
        relationships: { type: "object", additionalProperties: { type: "string" } },
        speechPatterns: { type: "array", items: { type: "string" } },
        values: { type: "array", items: { type: "string" } },
        fears: { type: "array", items: { type: "string" } },
        goals: { type: "array", items: { type: "string" } },
        notableQuotes: { type: "array", items: { type: "string" } },
        abilities: { type: "array", items: { type: "string" } },
        copingStyle: { type: "array", items: { type: "string" } },
        knowledgeScope: { type: "object", additionalProperties: { type: "string" } },
      },
      required: [
        "personalityTraits", "backstory", "relationships", "speechPatterns",
        "values", "fears", "goals", "notableQuotes", "abilities", "copingStyle", "knowledgeScope",
      ],
    },
  },
  required: ["name", "imageUrl", "shortDescription", "firstAppearanceDate", "confidence", "personality"],
} as const;

type ExaClient = { answer: (...args: unknown[]) => Promise<{ answer: unknown }> };

export async function characterSearchHandler(
  args: CharacterSearchInput,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exaClient: ExaClient = getExa() as any
): Promise<CharacterSearchResult | { error: "character_not_found" | "parse_failed" | "search_failed" }> {
  try {
    const result = await exaClient.answer(args.query, {
      systemPrompt: CHARACTER_SYSTEM_PROMPT,
      outputSchema: CHARACTER_OUTPUT_SCHEMA,
    });

    let parsed: unknown;
    try {
      if (typeof result.answer === "object" && result.answer !== null) {
        parsed = result.answer;
      } else {
        const raw = String(result.answer)
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, "")
          .trim();
        parsed = JSON.parse(raw);
      }
    } catch {
      return { error: "parse_failed" };
    }

    const validation = CharacterSearchResultSchema.safeParse(parsed);
    if (!validation.success) {
      return { error: "parse_failed" };
    }

    if (validation.data.confidence === 0) {
      return { error: "character_not_found" };
    }

    return validation.data;
  } catch {
    return { error: "search_failed" };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test packages/shared/services/character_search.service.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Export from packages/shared/index.ts**

Add to the end of `packages/shared/index.ts`:

```typescript
export { characterSearchHandler } from "./services/character_search.service";
```

- [ ] **Step 6: Type-check shared**

```bash
bun run --cwd packages/shared tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/services/character_search.service.ts packages/shared/services/character_search.service.test.ts packages/shared/index.ts
git commit -m "feat(shared): add characterSearchHandler service with tests"
```

---

## Task 4: Update MCP tools to use shared services, remove local exa.ts

**Files:**
- Modify: `mcp_server/src/registry/tools/show_search.ts`
- Modify: `mcp_server/src/registry/tools/character_search.ts`
- Delete: `mcp_server/src/exa.ts`
- Modify: `mcp_server/package.json`

- [ ] **Step 1: Update mcp_server/src/registry/tools/show_search.ts**

Replace the full file content:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ShowSearchInput } from "@open-ormus/shared";
import { ShowSearchInputShape, showSearchHandler } from "@open-ormus/shared";

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__show_search",
    "Search for TV series, films, or books by title or theme and retrieve metadata with character names",
    ShowSearchInputShape,
    // @ts-expect-error -- TS2589: type instantiation depth from Zod v3/v4 workspace mismatch. Tracked: AGENTS.md §11, resolves before M3-05.
    async (args: ShowSearchInput) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await showSearchHandler(args)),
        },
      ],
    })
  );
}
```

- [ ] **Step 2: Update mcp_server/src/registry/tools/character_search.ts**

Replace the full file content:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CharacterSearchInputShape, characterSearchHandler } from "@open-ormus/shared";

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__character_search",
    "Search for a fictional character and retrieve their personality traits, backstory, and relationships",
    CharacterSearchInputShape as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    async (args: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await characterSearchHandler(args)),
        },
      ],
    })
  );
}
```

- [ ] **Step 3: Delete mcp_server/src/exa.ts**

```bash
rm mcp_server/src/exa.ts
```

- [ ] **Step 4: Remove exa-js from mcp_server/package.json**

Replace the `dependencies` block in `mcp_server/package.json`:

```json
{
  "name": "mcp_server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "test": "bun test"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29",
    "@open-ormus/shared": "workspace:*",
    "@prisma/adapter-pg": "^7.8.0",
    "@prisma/client": "^7.8.0",
    "express": "^5.1.0",
    "jsonwebtoken": "^9.0.2",
    "pg": "^8.20.0",
    "zod": "^3.25.23"
  },
  "devDependencies": {
    "@types/express": "^5.0.3",
    "@types/jsonwebtoken": "^9.0.9",
    "@types/node": "^22",
    "@types/pg": "^8.20.0"
  },
  "prisma": {
    "schema": "../prisma/schema.prisma"
  }
}
```

- [ ] **Step 5: Re-install to update lockfile**

```bash
bun install
```

Expected: lock file updates, no errors.

- [ ] **Step 6: Type-check mcp_server**

```bash
bun run --cwd mcp_server tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add mcp_server/src/registry/tools/show_search.ts mcp_server/src/registry/tools/character_search.ts mcp_server/package.json bun.lock
git rm mcp_server/src/exa.ts
git commit -m "refactor(mcp): import exa handlers from shared, remove local exa singleton"
```

---

## Task 5: Create /api/exa/show-search frontend route

**Files:**
- Create: `frontend/app/api/exa/show-search/route.ts`

- [ ] **Step 1: Create frontend/app/api/exa/show-search/route.ts**

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ShowSearchInputSchema, showSearchHandler } from "@open-ormus/shared";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = ShowSearchInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  const result = await showSearchHandler(parsed.data);
  return NextResponse.json(result);
}
```

- [ ] **Step 2: Type-check frontend**

```bash
bun run --cwd frontend tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/api/exa/show-search/route.ts
git commit -m "feat(frontend): add POST /api/exa/show-search route"
```

---

## Task 6: Create /api/exa/character-search frontend route

**Files:**
- Create: `frontend/app/api/exa/character-search/route.ts`

- [ ] **Step 1: Create frontend/app/api/exa/character-search/route.ts**

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CharacterSearchInputSchema, characterSearchHandler } from "@open-ormus/shared";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CharacterSearchInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  const result = await characterSearchHandler(parsed.data);
  return NextResponse.json(result);
}
```

- [ ] **Step 2: Type-check frontend**

```bash
bun run --cwd frontend tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/api/exa/character-search/route.ts
git commit -m "feat(frontend): add POST /api/exa/character-search route"
```

---

## Task 7: Create ImportStep component

**Files:**
- Create: `frontend/components/characters/ImportStep.tsx`

- [ ] **Step 1: Create frontend/components/characters/ImportStep.tsx**

```tsx
"use client";

import { useState } from "react";
import type { CharacterSearchResult, ShowResult } from "@open-ormus/shared";

type ImportTab = "collection" | "character";

type FetchStatus = {
  name: string;
  status: "loading" | "success" | "error";
  result?: CharacterSearchResult;
  errorMsg?: string;
};

interface ImportStepProps {
  onImported: (results: CharacterSearchResult[]) => void;
}

export function ImportStep({ onImported }: ImportStepProps) {
  const [tab, setTab] = useState<ImportTab>("collection");

  // ── By Collection state ────────────────────────────────────────────────────
  const [collectionQuery, setCollectionQuery] = useState("");
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [showResults, setShowResults] = useState<ShowResult[]>([]);
  const [selectedShow, setSelectedShow] = useState<ShowResult | null>(null);
  const [checkedChars, setCheckedChars] = useState<Set<string>>(new Set());
  const [fetchStatuses, setFetchStatuses] = useState<FetchStatus[]>([]);
  const [fetchingChars, setFetchingChars] = useState(false);

  // ── By Character state ─────────────────────────────────────────────────────
  const [charQuery, setCharQuery] = useState("");
  const [charLoading, setCharLoading] = useState(false);
  const [charError, setCharError] = useState<string | null>(null);

  // ── Collection handlers ────────────────────────────────────────────────────
  const searchCollection = async () => {
    if (!collectionQuery.trim()) return;
    setCollectionLoading(true);
    setCollectionError(null);
    setShowResults([]);
    setSelectedShow(null);
    setCheckedChars(new Set());
    setFetchStatuses([]);
    try {
      const res = await fetch("/api/exa/show-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: collectionQuery }),
      });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const data = (await res.json()) as { results?: ShowResult[]; error?: string };
      if (data.error ?? !data.results) {
        setCollectionError("Search failed, try again");
      } else if (data.results.length === 0) {
        setCollectionError("No collections found");
      } else {
        setShowResults(data.results);
      }
    } catch {
      setCollectionError("Search failed, try again");
    } finally {
      setCollectionLoading(false);
    }
  };

  const selectShow = (show: ShowResult) => {
    setSelectedShow(show);
    setCheckedChars(new Set());
    setFetchStatuses([]);
  };

  const toggleChar = (name: string) => {
    setCheckedChars((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const importSelected = async () => {
    if (!selectedShow || checkedChars.size === 0) return;
    const names = Array.from(checkedChars);
    setFetchStatuses(names.map((name) => ({ name, status: "loading" as const })));
    setFetchingChars(true);

    const settled = await Promise.allSettled(
      names.map(async (name) => {
        const query = `${name}, ${selectedShow.title}`;
        const res = await fetch("/api/exa/character-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        });
        if (res.status === 401) throw new Error("unauthorized");
        const data = (await res.json()) as CharacterSearchResult | { error: string };
        if ("error" in data) throw new Error(data.error);
        return { name, data: data as CharacterSearchResult };
      })
    );

    const updated: FetchStatus[] = names.map((name, i) => {
      const r = settled[i];
      if (r === undefined) return { name, status: "error" as const, errorMsg: "Unknown error" };
      if (r.status === "fulfilled") {
        return { name, status: "success" as const, result: r.value.data };
      }
      const msg =
        r.reason instanceof Error ? r.reason.message : "unknown";
      if (msg === "unauthorized") window.location.href = "/login";
      return {
        name,
        status: "error" as const,
        errorMsg: msg === "character_not_found" ? "Character not found" : "Failed to fetch",
      };
    });

    setFetchStatuses(updated);
    setFetchingChars(false);
  };

  const successResults = fetchStatuses
    .filter((s): s is FetchStatus & { status: "success"; result: CharacterSearchResult } =>
      s.status === "success" && s.result !== undefined
    )
    .map((s) => s.result);

  // ── Character handler ──────────────────────────────────────────────────────
  const searchCharacter = async () => {
    if (!charQuery.trim()) return;
    setCharLoading(true);
    setCharError(null);
    try {
      const res = await fetch("/api/exa/character-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: charQuery }),
      });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const data = (await res.json()) as CharacterSearchResult | { error: string };
      if ("error" in data) {
        setCharError(
          data.error === "character_not_found"
            ? "Character not found"
            : "Search failed, try again"
        );
      } else {
        onImported([data]);
      }
    } catch {
      setCharError("Search failed, try again");
    } finally {
      setCharLoading(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-zinc-200">
        {(["collection", "character"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-zinc-900 text-zinc-900"
                : "border-transparent text-zinc-400 hover:text-zinc-600"
            }`}
          >
            {t === "collection" ? "By Collection" : "By Character"}
          </button>
        ))}
      </div>

      {/* ── By Collection ── */}
      {tab === "collection" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={collectionQuery}
              onChange={(e) => setCollectionQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void searchCollection();
                }
              }}
              placeholder="e.g. Money Heist, Breaking Bad…"
              className="flex-1 px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
            />
            <button
              type="button"
              onClick={() => void searchCollection()}
              disabled={collectionLoading || !collectionQuery.trim()}
              className="px-4 py-2 text-sm bg-zinc-900 text-white rounded-lg hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {collectionLoading ? "Searching…" : "Search"}
            </button>
          </div>

          {collectionError && (
            <p className="text-sm text-red-600">{collectionError}</p>
          )}

          {/* Show results (before selection) */}
          {showResults.length > 0 && !selectedShow && (
            <div className="space-y-2">
              {showResults.map((show) => (
                <button
                  key={show.title}
                  type="button"
                  onClick={() => selectShow(show)}
                  className="w-full text-left p-3 rounded-lg border border-zinc-200 hover:border-zinc-400 hover:bg-zinc-50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-zinc-900">{show.title}</span>
                    {show.year !== null && (
                      <span className="text-xs text-zinc-400">{show.year}</span>
                    )}
                    {show.genre !== null && (
                      <span className="text-xs text-zinc-400">· {show.genre}</span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">
                    {show.description}
                  </p>
                </button>
              ))}
            </div>
          )}

          {/* Selected show — character checklist or fetch statuses */}
          {selectedShow && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-900">
                  {selectedShow.title}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedShow(null);
                    setFetchStatuses([]);
                    setCheckedChars(new Set());
                  }}
                  className="text-xs text-zinc-400 hover:text-zinc-600 underline"
                >
                  Change
                </button>
              </div>

              {fetchStatuses.length === 0 ? (
                <>
                  <div className="space-y-1.5">
                    {selectedShow.characters.map((name) => (
                      <label
                        key={name}
                        className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checkedChars.has(name)}
                          onChange={() => toggleChar(name)}
                          className="rounded border-zinc-300"
                        />
                        {name}
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => void importSelected()}
                    disabled={checkedChars.size === 0}
                    className="px-4 py-2 text-sm bg-zinc-900 text-white rounded-lg hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Import Selected ({checkedChars.size})
                  </button>
                </>
              ) : (
                <div className="space-y-2">
                  {/* Per-character status */}
                  {fetchStatuses.map((s) => (
                    <div
                      key={s.name}
                      className={`flex items-center gap-2 text-sm p-2 rounded-lg ${
                        s.status === "error"
                          ? "bg-red-50 text-red-700"
                          : s.status === "success"
                          ? "bg-green-50 text-green-700"
                          : "bg-zinc-50 text-zinc-500"
                      }`}
                    >
                      <span>
                        {s.status === "loading"
                          ? "⟳"
                          : s.status === "success"
                          ? "✓"
                          : "✗"}
                      </span>
                      <span className="flex-1">{s.name}</span>
                      {s.status === "error" && (
                        <span className="text-xs">{s.errorMsg}</span>
                      )}
                    </div>
                  ))}

                  {/* Continue / all-failed controls */}
                  {!fetchingChars && (
                    <div className="flex items-center gap-3 pt-1">
                      {successResults.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => onImported(successResults)}
                          className="px-4 py-2 text-sm bg-zinc-900 text-white rounded-lg hover:bg-zinc-700 transition-colors"
                        >
                          Continue with {successResults.length} of{" "}
                          {fetchStatuses.length} character
                          {fetchStatuses.length !== 1 ? "s" : ""}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void importSelected()}
                          className="px-4 py-2 text-sm border border-zinc-300 text-zinc-700 rounded-lg hover:bg-zinc-50 transition-colors"
                        >
                          Retry all
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── By Character ── */}
      {tab === "character" && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={charQuery}
              onChange={(e) => setCharQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void searchCharacter();
                }
              }}
              placeholder="e.g. Walter White, Breaking Bad"
              className="flex-1 px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
            />
            <button
              type="button"
              onClick={() => void searchCharacter()}
              disabled={charLoading || !charQuery.trim()}
              className="px-4 py-2 text-sm bg-zinc-900 text-white rounded-lg hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {charLoading ? "Searching…" : "Search"}
            </button>
          </div>
          {charError && <p className="text-sm text-red-600">{charError}</p>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check frontend**

```bash
bun run --cwd frontend tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/characters/ImportStep.tsx
git commit -m "feat(frontend): add ImportStep component for Exa character import"
```

---

## Task 8: Update CharacterFormWizard with import step and queue

**Files:**
- Modify: `frontend/components/characters/CharacterFormWizard.tsx`

This is a full replacement of the file. The changes are:
1. Add `CharacterSearchResult` import
2. Add `fromSearchResult()` helper (converts `CharacterSearchResult` → `FormState`)
3. Import `ImportStep`
4. Update `STEPS` → split into `CREATE_STEPS` and `EDIT_STEPS`
5. Add `pendingQueue`, `queueTotal` state
6. Add `handleImported()`, `handleSaveAndNext()`, `handleSkip()`
7. Update body rendering (step 0 = ImportStep in create mode; form step offset)
8. Update footer (queue buttons + progress when queue active)

- [ ] **Step 1: Replace frontend/components/characters/CharacterFormWizard.tsx**

```tsx
"use client";

import { useState } from "react";
import type {
  CharacterSaveInput,
  CharacterPersonality,
  CharacterSearchResult,
  SavedCharacterRecord,
} from "@open-ormus/shared";
import { ImportStep } from "./ImportStep";

// ─── Form State ───────────────────────────────────────────────────────────────

type KVPair = { key: string; value: string };

type FormState = {
  name: string;
  shortDescription: string;
  imageUrl: string;
  firstAppearanceDate: string;
  confidence: 0 | 1 | 2 | 3;
  personalityTraits: string[];
  backstory: string;
  speechPatterns: string[];
  values: string[];
  fears: string[];
  goals: string[];
  notableQuotes: string[];
  abilities: string[];
  copingStyle: string[];
  relationships: KVPair[];
  knowledgeScope: KVPair[];
};

function emptyForm(): FormState {
  return {
    name: "",
    shortDescription: "",
    imageUrl: "",
    firstAppearanceDate: "",
    confidence: 3,
    personalityTraits: [],
    backstory: "",
    speechPatterns: [],
    values: [],
    fears: [],
    goals: [],
    notableQuotes: [],
    abilities: [],
    copingStyle: [],
    relationships: [],
    knowledgeScope: [],
  };
}

function fromRecord(record: SavedCharacterRecord): FormState {
  const { sheet } = record;
  const p = sheet.personality;
  return {
    name: sheet.name,
    shortDescription: sheet.shortDescription,
    imageUrl: sheet.imageUrl ?? "",
    firstAppearanceDate: sheet.firstAppearanceDate,
    confidence: sheet.confidence,
    personalityTraits: p.personalityTraits,
    backstory: p.backstory,
    speechPatterns: p.speechPatterns,
    values: p.values,
    fears: p.fears,
    goals: p.goals,
    notableQuotes: p.notableQuotes,
    abilities: p.abilities,
    copingStyle: p.copingStyle,
    relationships: Object.entries(p.relationships).map(([key, value]) => ({
      key,
      value: String(value),
    })),
    knowledgeScope: Object.entries(p.knowledgeScope).map(([key, value]) => ({
      key,
      value: String(value),
    })),
  };
}

function fromSearchResult(result: CharacterSearchResult): FormState {
  const p = result.personality;
  return {
    name: result.name,
    shortDescription: result.shortDescription,
    imageUrl: result.imageUrl ?? "",
    firstAppearanceDate: result.firstAppearanceDate,
    confidence: result.confidence,
    personalityTraits: p.personalityTraits,
    backstory: p.backstory,
    speechPatterns: p.speechPatterns,
    values: p.values,
    fears: p.fears,
    goals: p.goals,
    notableQuotes: p.notableQuotes,
    abilities: p.abilities,
    copingStyle: p.copingStyle,
    relationships: Object.entries(p.relationships).map(([key, value]) => ({ key, value })),
    knowledgeScope: Object.entries(p.knowledgeScope).map(([key, value]) => ({ key, value })),
  };
}

function toSaveInput(state: FormState): CharacterSaveInput {
  const personality: CharacterPersonality = {
    personalityTraits: state.personalityTraits,
    backstory: state.backstory,
    speechPatterns: state.speechPatterns,
    values: state.values,
    fears: state.fears,
    goals: state.goals,
    notableQuotes: state.notableQuotes,
    abilities: state.abilities,
    copingStyle: state.copingStyle,
    relationships: Object.fromEntries(
      state.relationships.filter((r) => r.key.trim()).map((r) => [r.key, r.value])
    ),
    knowledgeScope: Object.fromEntries(
      state.knowledgeScope.filter((r) => r.key.trim()).map((r) => [r.key, r.value])
    ),
  };
  return {
    name: state.name,
    shortDescription: state.shortDescription,
    imageUrl: state.imageUrl.trim() || null,
    firstAppearanceDate: state.firstAppearanceDate,
    confidence: state.confidence,
    personality,
  };
}

// ─── TagInput ──────────────────────────────────────────────────────────────────

function TagInput({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const trimmed = draft.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
      setDraft("");
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-zinc-700 mb-1">{label}</label>
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className="flex-1 px-3 py-1.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
          placeholder="Type and press Enter or Add"
        />
        <button
          type="button"
          onClick={add}
          className="px-3 py-1.5 text-sm bg-zinc-100 rounded-lg hover:bg-zinc-200 transition-colors"
        >
          Add
        </button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {values.map((v, i) => (
            <span
              key={i}
              className="flex items-center gap-1 text-xs bg-zinc-100 text-zinc-700 px-2 py-1 rounded-full"
            >
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((_, j) => j !== i))}
                className="text-zinc-400 hover:text-zinc-600"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── KVEditor ─────────────────────────────────────────────────────────────────

function KVEditor({
  label,
  pairs,
  onChange,
}: {
  label: string;
  pairs: KVPair[];
  onChange: (p: KVPair[]) => void;
}) {
  const add = () => onChange([...pairs, { key: "", value: "" }]);
  const remove = (i: number) => onChange(pairs.filter((_, j) => j !== i));
  const update = (i: number, field: "key" | "value", v: string) =>
    onChange(pairs.map((p, j) => (j === i ? { ...p, [field]: v } : p)));

  return (
    <div>
      <label className="block text-sm font-medium text-zinc-700 mb-1">{label}</label>
      <div className="space-y-2">
        {pairs.map((pair, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input
              type="text"
              value={pair.key}
              onChange={(e) => update(i, "key", e.target.value)}
              placeholder="Key"
              className="w-32 px-3 py-1.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
            />
            <input
              type="text"
              value={pair.value}
              onChange={(e) => update(i, "value", e.target.value)}
              placeholder="Value"
              className="flex-1 px-3 py-1.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-zinc-400 hover:text-red-500 text-lg leading-none"
            >
              &times;
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="text-sm text-zinc-500 hover:text-zinc-800 underline"
        >
          + Add entry
        </button>
      </div>
    </div>
  );
}

// ─── Wizard ───────────────────────────────────────────────────────────────────

const FORM_STEPS = ["Basics", "Personality", "Connections"] as const;

// In create mode: step 0 = Import, steps 1-3 = FORM_STEPS.
// In edit mode:   steps 0-2 = FORM_STEPS.
const CREATE_STEPS = ["Import", ...FORM_STEPS] as const;

interface WizardProps {
  mode: "create" | "edit";
  initialData?: SavedCharacterRecord;
  onSubmit: (data: CharacterSaveInput) => Promise<void>;
  onClose: () => void;
}

export function CharacterFormWizard({
  mode,
  initialData,
  onSubmit,
  onClose,
}: WizardProps) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(() =>
    initialData ? fromRecord(initialData) : emptyForm()
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Queue state for multi-character imports
  const [pendingQueue, setPendingQueue] = useState<CharacterSearchResult[]>([]);
  const [queueTotal, setQueueTotal] = useState(0);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // formStep is the index into FORM_STEPS (0=Basics, 1=Personality, 2=Connections).
  // In create mode, step 0 is Import, so formStep = step - 1.
  // In edit mode, formStep = step directly.
  const formStep = mode === "create" ? step - 1 : step;
  const displaySteps = mode === "create" ? CREATE_STEPS : FORM_STEPS;
  const isImportStep = mode === "create" && step === 0;
  const isLastFormStep = formStep === FORM_STEPS.length - 1;

  // Called by ImportStep when user confirms import selection
  const handleImported = (results: CharacterSearchResult[]) => {
    if (results.length === 0) return;
    const [first, ...rest] = results;
    setForm(fromSearchResult(first!));
    setPendingQueue(rest);
    setQueueTotal(results.length);
    setStep(mode === "create" ? 1 : 0); // advance to Basics
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(toSaveInput(form));
      onClose();
    } catch {
      setError("Failed to save character. Please try again.");
      setSubmitting(false);
    }
  };

  const handleSaveAndNext = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(toSaveInput(form));
      if (pendingQueue.length > 0) {
        const [next, ...rest] = pendingQueue;
        setForm(fromSearchResult(next!));
        setPendingQueue(rest);
        setStep(mode === "create" ? 1 : 0); // back to Basics for next character
        setError(null);
      } else {
        onClose();
      }
    } catch {
      setError("Failed to save character. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = () => {
    if (pendingQueue.length > 0) {
      const [next, ...rest] = pendingQueue;
      setForm(fromSearchResult(next!));
      setPendingQueue(rest);
      setStep(mode === "create" ? 1 : 0);
      setError(null);
    } else {
      onClose();
    }
  };

  const queuePosition = queueTotal - pendingQueue.length; // 1-based index of current char

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900">
            {mode === "create" ? "New Character" : "Edit Character"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Step indicator */}
        <div className="px-6 py-3 border-b border-zinc-100 flex gap-6">
          {displaySteps.map((label, i) => (
            <button
              key={label}
              type="button"
              // Allow clicking on visited form steps; import step (i=0 create) is not re-enterable
              onClick={() => {
                if (mode === "create" && i === 0) return;
                if (mode === "create" ? i <= step : i <= step) setStep(i);
              }}
              className={`text-sm font-medium pb-1 border-b-2 transition-colors ${
                i === step
                  ? "border-zinc-900 text-zinc-900"
                  : i < step
                  ? "border-zinc-300 text-zinc-500 cursor-pointer"
                  : "border-transparent text-zinc-300 cursor-default"
              }`}
            >
              {i + 1}. {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {/* Import step — create mode only */}
          {isImportStep && (
            <ImportStep onImported={handleImported} />
          )}

          {/* Form steps */}
          {!isImportStep && (
            <>
              {formStep === 0 && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">
                      Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => set("name", e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">
                      Short Description
                    </label>
                    <textarea
                      value={form.shortDescription}
                      onChange={(e) => set("shortDescription", e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">
                      Image URL
                    </label>
                    <input
                      type="text"
                      value={form.imageUrl}
                      onChange={(e) => set("imageUrl", e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">
                      First Appearance Date
                    </label>
                    <input
                      type="text"
                      value={form.firstAppearanceDate}
                      onChange={(e) => set("firstAppearanceDate", e.target.value)}
                      placeholder="e.g. 2013-09-22 or 0000-01-01 if unknown"
                      className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">
                      Confidence
                    </label>
                    <select
                      value={form.confidence}
                      onChange={(e) =>
                        set("confidence", Number(e.target.value) as 0 | 1 | 2 | 3)
                      }
                      className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400 bg-white"
                    >
                      <option value={0}>0 — Unknown</option>
                      <option value={1}>1 — Low</option>
                      <option value={2}>2 — Medium</option>
                      <option value={3}>3 — High</option>
                    </select>
                  </div>
                </>
              )}

              {formStep === 1 && (
                <>
                  <TagInput
                    label="Personality Traits"
                    values={form.personalityTraits}
                    onChange={(v) => set("personalityTraits", v)}
                  />
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">
                      Backstory
                    </label>
                    <textarea
                      value={form.backstory}
                      onChange={(e) => set("backstory", e.target.value)}
                      rows={4}
                      className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
                    />
                  </div>
                  <TagInput
                    label="Speech Patterns"
                    values={form.speechPatterns}
                    onChange={(v) => set("speechPatterns", v)}
                  />
                  <TagInput
                    label="Values"
                    values={form.values}
                    onChange={(v) => set("values", v)}
                  />
                  <TagInput
                    label="Fears"
                    values={form.fears}
                    onChange={(v) => set("fears", v)}
                  />
                  <TagInput
                    label="Goals"
                    values={form.goals}
                    onChange={(v) => set("goals", v)}
                  />
                  <TagInput
                    label="Notable Quotes"
                    values={form.notableQuotes}
                    onChange={(v) => set("notableQuotes", v)}
                  />
                  <TagInput
                    label="Abilities"
                    values={form.abilities}
                    onChange={(v) => set("abilities", v)}
                  />
                  <TagInput
                    label="Coping Style"
                    values={form.copingStyle}
                    onChange={(v) => set("copingStyle", v)}
                  />
                </>
              )}

              {formStep === 2 && (
                <>
                  <KVEditor
                    label="Relationships (name → description)"
                    pairs={form.relationships}
                    onChange={(p) => set("relationships", p)}
                  />
                  <KVEditor
                    label="Knowledge Scope (topic → scope)"
                    pairs={form.knowledgeScope}
                    onChange={(p) => set("knowledgeScope", p)}
                  />
                </>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-100 flex items-center justify-between">
          {/* Left button */}
          <button
            type="button"
            onClick={() => (step > 0 ? setStep(step - 1) : onClose())}
            className="px-4 py-2 text-sm rounded-lg border border-zinc-200 text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            {step === 0 ? "Cancel" : "Back"}
          </button>

          {/* Right area */}
          {isImportStep ? (
            // Import step: offer manual entry escape hatch
            <button
              type="button"
              onClick={() => setStep(1)}
              className="px-4 py-2 text-sm rounded-lg border border-zinc-200 text-zinc-700 hover:bg-zinc-50 transition-colors"
            >
              Enter manually →
            </button>
          ) : !isLastFormStep ? (
            // Form steps — not last
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              disabled={formStep === 0 && !form.name.trim()}
              className="px-4 py-2 text-sm rounded-lg bg-zinc-900 text-white hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          ) : pendingQueue.length > 0 ? (
            // Last form step with pending queue
            <div className="flex items-center gap-3">
              {queueTotal > 1 && (
                <span className="text-xs text-zinc-400">
                  Character {queuePosition} of {queueTotal}
                </span>
              )}
              <button
                type="button"
                onClick={handleSkip}
                disabled={submitting}
                className="px-4 py-2 text-sm rounded-lg border border-zinc-200 text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-40"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={() => void handleSaveAndNext()}
                disabled={submitting || !form.name.trim()}
                className="px-4 py-2 text-sm rounded-lg bg-zinc-900 text-white hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? "Saving…" : "Save & Next"}
              </button>
            </div>
          ) : (
            // Last form step, no queue — normal save
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={submitting || !form.name.trim()}
              className="px-4 py-2 text-sm rounded-lg bg-zinc-900 text-white hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? "Saving…" : mode === "create" ? "Create" : "Save Changes"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check frontend**

```bash
bun run --cwd frontend tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Start dev server and test manually**

```bash
bun run dev:frontend
```

Test these paths:

1. **By Character:** Open "New Character" → wizard shows "1. Import" tab → By Character tab → search "Walter White, Breaking Bad" → result loads into step 2 Basics pre-filled → review all 3 form steps → Create saves successfully.

2. **By Collection:** Open "New Character" → By Collection tab → search "Breaking Bad" → 3 show cards appear → click one → character checklist appears → check 2 characters → "Import Selected (2)" → fetch statuses show → "Continue with N of 2" → wizard pre-fills with first character → step through all 3 form steps → "Save & Next" saves and loads second character → saves second → modal closes.

3. **Enter manually:** Open "New Character" → Import step → "Enter manually →" → Basics step with empty form → fill in manually → Create.

4. **Edit mode:** Click edit on existing character → wizard opens directly at step 1 (Basics) with prefilled data, no Import step shown.

5. **Error state:** Search for a nonsense string → "No collections found" / "Character not found" errors display correctly.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/characters/CharacterFormWizard.tsx
git commit -m "feat(frontend): add import step and queue flow to CharacterFormWizard"
```

---

## Self-Review Notes

- All 8 spec requirements covered: shared Exa singleton ✓, show_search service ✓, character_search service ✓, MCP tool wrappers ✓, two frontend routes ✓, ImportStep ✓, wizard queue ✓, error handling ✓
- `fromSearchResult` defined before it is used in Task 8
- `handleSaveAndNext` and `handleSkip` both correctly reset `step` to `mode === "create" ? 1 : 0` (Basics)
- `queuePosition` = `queueTotal - pendingQueue.length` correctly gives 1-based index after consuming first item
- `ShowResult` added to shared index exports in Task 2 Step 5 ✓
- `CharacterSearchResult` already exported from shared index ✓
- `mcp_server/src/exa.ts` deleted via `git rm` in Task 4 Step 7 — `git rm` both stages the deletion and removes the file
