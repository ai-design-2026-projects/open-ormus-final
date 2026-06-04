# Agent Tool Call UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw JSON accordion in `ToolCallBlock` with rich, type-specific renderer components for all 9 MCP tools, with skeleton loading and live conversation streaming.

**Architecture:** `tool-call-block.tsx` becomes a thin dispatcher holding a registry `Record<string, ComponentType<ToolRendererProps>>`. Each renderer receives `{ input, result, isLoading }` and falls back to the existing accordion on parse failure. A new SSE route streams conversation turns to `ConversationPanel`.

**Tech Stack:** Next.js 15 App Router, React, Tailwind CSS, shadcn/ui (`Card`, `Badge`), `Monogram` component, Zod (v4 in `packages/shared`), Supabase SSR auth, Prisma.

---

## File Map

**Modified:**
- `frontend/lib/agent/stream.ts` — change `tool_result` from `preview: string` → `result: unknown`, unwrap MCP content envelope
- `frontend/app/chat/_components/message-thread.tsx` — `MessageBlock.result` from `string` → `unknown`
- `frontend/app/chat/_components/chat-view.tsx` — update `TOOL_RESULT` action type + reducer
- `frontend/app/chat/_components/tool-call-block.tsx` — replace with dispatcher + registry

**Created:**
- `frontend/app/chat/_components/tool-renderers/character-card.tsx`
- `frontend/app/chat/_components/tool-renderers/character-delete-card.tsx`
- `frontend/app/chat/_components/tool-renderers/show-card.tsx`
- `frontend/app/chat/_components/tool-renderers/result-summary-card.tsx`
- `frontend/app/chat/_components/tool-renderers/conversation-panel.tsx`
- `frontend/app/api/conversations/jobs/[jobId]/stream/route.ts`

---

## Task 1: Fix stream.ts — full result instead of truncated preview

**Files:**
- Modify: `frontend/lib/agent/stream.ts`

The MCP server wraps every tool result in `{ content: [{ type: "text", text: "...json..." }] }`. The current code stringifies and slices that wrapper. We need to unwrap the envelope and parse the inner JSON so renderers get real data.

- [ ] **Step 1: Update `StreamChunk` type**

In `frontend/lib/agent/stream.ts`, replace the `tool_result` variant:

```ts
export type StreamChunk =
  | { type: "session_created"; sessionId: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; tool: string; input: unknown }
  | { type: "tool_result"; tool: string; result: unknown }
  | { type: "error"; message: string }
  | { type: "done"; sessionId: string };
```

- [ ] **Step 2: Update `mapRunEvent` to unwrap MCP envelope**

Replace the `tool_output` branch in `mapRunEvent`:

```ts
if (event.name === "tool_output") {
  const { item } = event as RunItemToolOutput;
  const raw = item.output;
  let result: unknown = raw;
  if (
    typeof raw === "object" &&
    raw !== null &&
    "content" in raw &&
    Array.isArray((raw as { content: unknown[] }).content)
  ) {
    const first = (raw as { content: unknown[] }).content[0];
    if (
      typeof first === "object" &&
      first !== null &&
      "text" in first &&
      typeof (first as { text: unknown }).text === "string"
    ) {
      try {
        result = JSON.parse((first as { text: string }).text);
      } catch {
        result = (first as { text: string }).text;
      }
    }
  }
  return {
    type: "tool_result",
    tool: item.rawItem.name ?? "",
    result,
  };
}
```

- [ ] **Step 3: Verify typecheck passes**

```bash
bun run typecheck
```

Expected: errors in `chat-view.tsx` only (uses `chunk.preview` — will fix in Task 2). No errors in `stream.ts` itself.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/agent/stream.ts
git commit -m "feat: stream full tool result instead of truncated preview"
```

---

## Task 2: Cascade result type through MessageBlock and chat-view.tsx

**Files:**
- Modify: `frontend/app/chat/_components/message-thread.tsx`
- Modify: `frontend/app/chat/_components/chat-view.tsx`

- [ ] **Step 1: Update `MessageBlock` type in `message-thread.tsx`**

Change line 8:

```ts
// Before
| { type: "tool_call"; tool: string; input: unknown; result?: string }
// After
| { type: "tool_call"; tool: string; input: unknown; result?: unknown }
```

- [ ] **Step 2: Update `TOOL_RESULT` action type in `chat-view.tsx`**

Change line 24:

```ts
// Before
| { type: "TOOL_RESULT"; tool: string; preview: string }
// After
| { type: "TOOL_RESULT"; tool: string; result: unknown }
```

- [ ] **Step 3: Update `TOOL_RESULT` dispatch in `chat-view.tsx`**

Find line ~190 (the `chunk.type === "tool_result"` branch) and change:

```ts
// Before
else if (chunk.type === "tool_result")
  dispatch({ type: "TOOL_RESULT", tool: chunk.tool, preview: chunk.preview });
// After
else if (chunk.type === "tool_result")
  dispatch({ type: "TOOL_RESULT", tool: chunk.tool, result: chunk.result });
```

- [ ] **Step 4: Update `TOOL_RESULT` reducer case in `chat-view.tsx`**

Find the `TOOL_RESULT` case in `chatReducer` (around line 78) and change:

```ts
case "TOOL_RESULT": {
  const msgs = [...state.messages];
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== "assistant") return state;
  const blocks = [...last.blocks];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b?.type === "tool_call" && b.tool === action.tool && !b.result) {
      blocks[i] = { ...b, result: action.result };
      break;
    }
  }
  msgs[msgs.length - 1] = { ...last, blocks };
  return { ...state, messages: msgs };
}
```

- [ ] **Step 5: Verify typecheck passes**

```bash
bun run typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/chat/_components/message-thread.tsx frontend/app/chat/_components/chat-view.tsx
git commit -m "feat: cascade tool result type from string to unknown"
```

---

## Task 3: Refactor tool-call-block.tsx to dispatcher

**Files:**
- Modify: `frontend/app/chat/_components/tool-call-block.tsx`

Replace the entire file. The registry starts empty (populated in Task 10). The fallback accordion is preserved inline.

- [ ] **Step 1: Replace tool-call-block.tsx**

```tsx
"use client";

import { useState, type ComponentType } from "react";

export interface ToolRendererProps {
  input: unknown;
  result: unknown;
  isLoading: boolean;
}

// Registry populated in task 10 — each tool name maps to its renderer.
// Renderers are added here to keep the import graph centralised.
const toolRenderers: Record<string, ComponentType<ToolRendererProps>> = {};

interface ToolCallBlockProps {
  tool: string;
  input: unknown;
  result?: unknown;
}

function FallbackAccordion({ tool, input, result }: ToolCallBlockProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1 border border-border rounded-md text-xs font-mono">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-accent/40 transition-colors rounded-md"
      >
        <span>{open ? "▼" : "▶"}</span>
        <span className="text-muted-foreground">🔧</span>
        <span className="font-semibold text-foreground">{tool}</span>
        {!open && result !== undefined && (
          <span className="ml-auto text-muted-foreground truncate max-w-[200px]">
            {JSON.stringify(result).slice(0, 100)}
          </span>
        )}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-border">
          <div>
            <p className="text-muted-foreground mt-2 mb-1">Input</p>
            <pre className="bg-muted rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>
          {result !== undefined && (
            <div>
              <p className="text-muted-foreground mb-1">Result</p>
              <pre className="bg-muted rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ToolCallBlock({ tool, input, result }: ToolCallBlockProps) {
  const Renderer = toolRenderers[tool];
  const isLoading = result === undefined;

  if (!Renderer) {
    return <FallbackAccordion tool={tool} input={input} result={result} />;
  }

  return (
    <Renderer
      input={input}
      result={result ?? null}
      isLoading={isLoading}
    />
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
bun run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/chat/_components/tool-call-block.tsx
git commit -m "refactor: tool-call-block becomes dispatcher with renderer registry"
```

---

## Task 4: CharacterCard renderer

**Files:**
- Create: `frontend/app/chat/_components/tool-renderers/character-card.tsx`

Used for `character_create`, `character_update`, and as item component inside `ResultSummaryCard`.

The result shape from `character_create`/`character_update` is `SavedCharacterRecord` (from `packages/shared`):
```ts
{
  id, userId, name, sheet: CharacterSearchResult, pictures, createdAt, updatedAt, archivedAt
}
```
`sheet` contains `{ name, imageUrl, shortDescription, firstAppearanceDate, personality: { personalityTraits, backstory, relationships, speechPatterns, values, fears, goals, notableQuotes, abilities, copingStyle, knowledgeScope } }`.

For list/find/research contexts the item shape is `SavedCharacterRecord` (list/find) or `CharacterSearchResult` (research). We accept both by using the `sheet` field when present, or treating the whole object as the sheet.

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { useState } from "react";
import { SavedCharacterRecordSchema } from "@open-ormus/shared";
import { CharacterSearchResultSchema } from "@open-ormus/shared";
import { Monogram } from "@/components/ui/monogram";
import { Badge } from "@/components/ui/badge";
import type { ToolRendererProps } from "../tool-call-block";

function Shimmer({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse bg-muted rounded ${className ?? ""}`}
    />
  );
}

export function CharacterCard({ result, isLoading }: ToolRendererProps) {
  const [expanded, setExpanded] = useState(false);

  if (isLoading) {
    return (
      <div className="my-1 border border-border rounded-xl p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Shimmer className="size-8 rounded-full" />
          <div className="space-y-1 flex-1">
            <Shimmer className="h-3 w-32" />
            <Shimmer className="h-2 w-48" />
          </div>
        </div>
        <div className="flex gap-1">
          <Shimmer className="h-5 w-16 rounded-full" />
          <Shimmer className="h-5 w-20 rounded-full" />
          <Shimmer className="h-5 w-14 rounded-full" />
        </div>
      </div>
    );
  }

  // Try SavedCharacterRecord first, then bare CharacterSearchResult
  const saved = SavedCharacterRecordSchema.safeParse(result);
  const sheet = saved.success
    ? saved.data.sheet
    : CharacterSearchResultSchema.safeParse(result).data;

  if (!sheet) {
    return (
      <div className="my-1 border border-border rounded-xl p-3 text-xs text-muted-foreground">
        <pre className="overflow-x-auto">{JSON.stringify(result, null, 2)}</pre>
      </div>
    );
  }

  const name = sheet.name;
  const traits = sheet.personality.personalityTraits;

  return (
    <div className="my-1 border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 p-3">
        <Monogram name={name} size={36} shape="circle" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{name}</p>
          <p className="text-xs text-muted-foreground truncate">
            {sheet.shortDescription}
          </p>
        </div>
        {sheet.firstAppearanceDate && (
          <Badge variant="secondary" className="text-xs shrink-0">
            {sheet.firstAppearanceDate}
          </Badge>
        )}
      </div>

      {/* Collapsed: first 3 traits */}
      {!expanded && (
        <div className="px-3 pb-3 flex flex-wrap gap-1">
          {traits.slice(0, 3).map((t) => (
            <Badge key={t} variant="outline" className="text-xs">
              {t}
            </Badge>
          ))}
          {traits.length > 3 && (
            <span className="text-xs text-muted-foreground self-center">
              +{traits.length - 3} more
            </span>
          )}
        </div>
      )}

      {/* Expanded: full personality */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-border pt-3 text-xs">
          <Section title="Backstory">
            <p className="text-muted-foreground whitespace-pre-wrap">
              {sheet.personality.backstory}
            </p>
          </Section>
          <Section title="Traits">
            <div className="flex flex-wrap gap-1">
              {traits.map((t) => (
                <Badge key={t} variant="outline" className="text-xs">
                  {t}
                </Badge>
              ))}
            </div>
          </Section>
          <Section title="Values">
            <StringList items={sheet.personality.values} />
          </Section>
          <Section title="Fears">
            <StringList items={sheet.personality.fears} />
          </Section>
          <Section title="Goals">
            <StringList items={sheet.personality.goals} />
          </Section>
          <Section title="Speech patterns">
            <StringList items={sheet.personality.speechPatterns} />
          </Section>
          <Section title="Abilities">
            <StringList items={sheet.personality.abilities} />
          </Section>
          <Section title="Coping style">
            <StringList items={sheet.personality.copingStyle} />
          </Section>
          {sheet.personality.notableQuotes.length > 0 && (
            <Section title="Notable quotes">
              {sheet.personality.notableQuotes.map((q, i) => (
                <blockquote
                  key={i}
                  className="border-l-2 border-border pl-2 italic text-muted-foreground"
                >
                  {q}
                </blockquote>
              ))}
            </Section>
          )}
          {Object.keys(sheet.personality.relationships).length > 0 && (
            <Section title="Relationships">
              <table className="w-full text-xs">
                <tbody>
                  {Object.entries(sheet.personality.relationships).map(
                    ([person, rel]) => (
                      <tr key={person} className="border-b border-border last:border-0">
                        <td className="py-1 pr-3 font-medium">{person}</td>
                        <td className="py-1 text-muted-foreground">{rel}</td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </Section>
          )}
          {Object.keys(sheet.personality.knowledgeScope).length > 0 && (
            <Section title="Knowledge scope">
              <table className="w-full text-xs">
                <tbody>
                  {Object.entries(sheet.personality.knowledgeScope).map(
                    ([domain, desc]) => (
                      <tr key={domain} className="border-b border-border last:border-0">
                        <td className="py-1 pr-3 font-medium">{domain}</td>
                        <td className="py-1 text-muted-foreground">{desc}</td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </Section>
          )}
        </div>
      )}

      {/* Toggle */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border-t border-border hover:bg-accent/30 transition-colors"
      >
        {expanded ? "Show less ▲" : "Show full profile ▼"}
      </button>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="font-medium text-foreground mb-1">{title}</p>
      {children}
    </div>
  );
}

function StringList({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="text-muted-foreground">—</p>;
  return (
    <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
bun run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/chat/_components/tool-renderers/character-card.tsx
git commit -m "feat: add CharacterCard tool renderer"
```

---

## Task 5: CharacterDeleteCard renderer

**Files:**
- Create: `frontend/app/chat/_components/tool-renderers/character-delete-card.tsx`

Result from `character_delete` is `SavedCharacterRecord` (the archived record). Input has `{ id: string }`.

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { SavedCharacterRecordSchema } from "@open-ormus/shared";
import { Monogram } from "@/components/ui/monogram";
import { Badge } from "@/components/ui/badge";
import type { ToolRendererProps } from "../tool-call-block";

function Shimmer({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

export function CharacterDeleteCard({ result, isLoading }: ToolRendererProps) {
  if (isLoading) {
    return (
      <div className="my-1 border border-destructive/30 rounded-xl p-3 flex items-center gap-2">
        <Shimmer className="size-8 rounded-full" />
        <Shimmer className="h-3 w-32" />
      </div>
    );
  }

  const parsed = SavedCharacterRecordSchema.safeParse(result);
  const name = parsed.success ? parsed.data.name : "Character";

  return (
    <div className="my-1 border border-destructive/40 bg-destructive/5 rounded-xl p-3 flex items-center gap-3">
      <Monogram name={name} size={32} shape="circle" flat />
      <p className="text-sm font-medium flex-1 truncate">{name}</p>
      <Badge variant="destructive" className="text-xs shrink-0">
        Archived
      </Badge>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
bun run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/chat/_components/tool-renderers/character-delete-card.tsx
git commit -m "feat: add CharacterDeleteCard tool renderer"
```

---

## Task 6: ShowCard renderer

**Files:**
- Create: `frontend/app/chat/_components/tool-renderers/show-card.tsx`

Used as item component inside `ResultSummaryCard` for `show_research`. Item shape is `ShowResult`: `{ title, description, characters, year, genre }`.

- [ ] **Step 1: Create the file**

```tsx
import { Badge } from "@/components/ui/badge";
import type { ShowResult } from "@open-ormus/shared";

export function ShowCard({ show }: { show: ShowResult }) {
  return (
    <div className="border border-border rounded-lg p-3 space-y-1">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold">{show.title}</p>
        <div className="flex items-center gap-1 shrink-0">
          {show.year && (
            <Badge variant="secondary" className="text-xs">
              {show.year}
            </Badge>
          )}
          {show.genre && (
            <Badge variant="outline" className="text-xs">
              {show.genre}
            </Badge>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-3">
        {show.description}
      </p>
      {show.characters.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Characters: {show.characters.join(", ")}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
bun run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/chat/_components/tool-renderers/show-card.tsx
git commit -m "feat: add ShowCard component"
```

---

## Task 7: ResultSummaryCard renderer

**Files:**
- Create: `frontend/app/chat/_components/tool-renderers/result-summary-card.tsx`

Used by `character_list` (no input query), `character_find` (input: `{ query, limit }`), `character_research` (input: `{ query }`), `show_research` (input: `{ query }`).

Result shapes:
- `character_list` / `character_find`: `SavedCharacterRecord[]`
- `character_research`: `CharacterSearchResult[]` (bare sheet, no id/userId)
- `show_research`: `{ results: ShowResult[] }`

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { useState } from "react";
import { z } from "zod";
import {
  SavedCharacterRecordSchema,
  CharacterSearchResultSchema,
  ShowSearchResultSchema,
} from "@open-ormus/shared";
import { CharacterCard } from "./character-card";
import { ShowCard } from "./show-card";
import type { ToolRendererProps } from "../tool-call-block";

function Shimmer({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

export function ResultSummaryCard({ input, result, isLoading }: ToolRendererProps) {
  const [expanded, setExpanded] = useState(false);

  const query =
    typeof input === "object" &&
    input !== null &&
    "query" in input &&
    typeof (input as { query: unknown }).query === "string"
      ? (input as { query: string }).query
      : null;

  if (isLoading) {
    return (
      <div className="my-1 border border-border rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between">
          <Shimmer className="h-3 w-24" />
          {query && <Shimmer className="h-3 w-32" />}
        </div>
        <Shimmer className="h-8 w-full" />
        <Shimmer className="h-8 w-full" />
      </div>
    );
  }

  // Determine item type
  const savedList = z.array(SavedCharacterRecordSchema).safeParse(result);
  const searchList = z.array(CharacterSearchResultSchema).safeParse(result);
  const showResult = ShowSearchResultSchema.safeParse(result);

  const count = savedList.success
    ? savedList.data.length
    : searchList.success
      ? searchList.data.length
      : showResult.success
        ? showResult.data.results.length
        : null;

  if (count === null) {
    return (
      <div className="my-1 border border-border rounded-xl p-3 text-xs text-muted-foreground">
        <pre className="overflow-x-auto">{JSON.stringify(result, null, 2)}</pre>
      </div>
    );
  }

  return (
    <div className="my-1 border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center justify-between w-full px-3 py-2.5 hover:bg-accent/30 transition-colors text-left"
      >
        <span className="text-sm font-medium">
          {count} result{count !== 1 ? "s" : ""}
          {query ? ` for "${query}"` : ""}
        </span>
        <span className="text-xs text-muted-foreground">{expanded ? "▲" : "▼"}</span>
      </button>

      {/* Expanded: item list */}
      {expanded && (
        <div className="border-t border-border px-3 pb-3 pt-2 space-y-2">
          {savedList.success &&
            savedList.data.map((char) => (
              <CharacterCard
                key={char.id}
                input={null}
                result={char}
                isLoading={false}
              />
            ))}
          {!savedList.success &&
            searchList.success &&
            searchList.data.map((char, i) => (
              <CharacterCard
                key={i}
                input={null}
                result={char}
                isLoading={false}
              />
            ))}
          {showResult.success &&
            showResult.data.results.map((show, i) => (
              <ShowCard key={i} show={show} />
            ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
bun run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/chat/_components/tool-renderers/result-summary-card.tsx
git commit -m "feat: add ResultSummaryCard tool renderer"
```

---

## Task 8: SSE route for conversation job streaming

**Files:**
- Create: `frontend/app/api/conversations/jobs/[jobId]/stream/route.ts`

Auth via Supabase cookie. Polls DB every 1s, pushes new turns and status. Closes on terminal state.

- [ ] **Step 1: Create the route file**

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ jobId: string }> };

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const POLL_MS = 1000;

export async function GET(request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await params;
  if (!UUID_RE.test(jobId)) {
    return NextResponse.json({ error: "Invalid jobId" }, { status: 400 });
  }

  const job = await prisma.conversationJob.findFirst({
    where: { id: jobId, userId: user.id },
  });
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const encoder = new TextEncoder();

  function sse(event: string, data: unknown): Uint8Array {
    return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  const stream = new ReadableStream({
    async start(controller) {
      let lastSeenCount = 0;

      try {
        while (true) {
          const currentJob = await prisma.conversationJob.findFirst({
            where: { id: jobId, userId: user.id },
          });

          if (!currentJob) {
            controller.enqueue(
              sse("error", { message: "Job not found" })
            );
            break;
          }

          // Send status update
          controller.enqueue(
            sse("status", {
              status: currentJob.status,
              doneTurns: currentJob.doneTurns,
              totalTurns: currentJob.totalTurns,
            })
          );

          // Fetch all messages for this conversation, ordered by createdAt
          if (currentJob.conversationId) {
            const messages = await prisma.message.findMany({
              where: { conversationId: currentJob.conversationId },
              orderBy: { createdAt: "asc" },
              include: { character: { select: { name: true } } },
              skip: lastSeenCount,
            });

            for (const m of messages) {
              controller.enqueue(
                sse("turn", {
                  id: m.id,
                  conversationId: m.conversationId,
                  characterId: m.characterId,
                  authorUserId: m.authorUserId,
                  characterName: m.character?.name ?? "Unknown",
                  content: m.content,
                  reasoning: m.reasoning,
                  emotion: m.emotion,
                  intensity: m.intensity,
                  subtext: m.subtext,
                  createdAt: m.createdAt.toISOString(),
                })
              );
            }
            lastSeenCount += messages.length;
          }

          if (TERMINAL.has(currentJob.status)) {
            controller.enqueue(sse("done", { status: currentJob.status }));
            break;
          }

          // Wait before next poll
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
      } catch (err) {
        controller.enqueue(
          sse("error", {
            message: err instanceof Error ? err.message : "Stream error",
          })
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
bun run typecheck
```

Expected: 0 errors. If Prisma model name for messages differs, fix the `prisma.message.findMany` call to match the actual model name. Check `prisma/schema.prisma` for the exact model name.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/api/conversations/jobs/[jobId]/stream/route.ts
git commit -m "feat: add SSE route for conversation job turn streaming"
```

---

## Task 9: ConversationPanel renderer

**Files:**
- Create: `frontend/app/chat/_components/tool-renderers/conversation-panel.tsx`

`conversation_start` result: `{ conversationId: string; jobId: string }`.
`conversation_job_status` result: `ConversationJobStatus` — `{ status, doneTurns, totalTurns, messages?: MessageRecord[] }`.

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Monogram } from "@/components/ui/monogram";
import { Badge } from "@/components/ui/badge";
import type { ToolRendererProps } from "../tool-call-block";
import type { MessageRecord } from "@open-ormus/shared";

function Shimmer({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

const ConversationStartResultSchema = z.object({
  conversationId: z.string(),
  jobId: z.string(),
});

const ConversationJobStatusResultSchema = z.object({
  status: z.enum(["pending", "running", "completed", "failed", "cancelled", "awaiting_user"]),
  doneTurns: z.number(),
  totalTurns: z.number(),
  error: z.string().optional(),
  messages: z
    .array(
      z.object({
        id: z.string(),
        conversationId: z.string(),
        characterId: z.string().nullable(),
        authorUserId: z.string().nullable(),
        characterName: z.string(),
        content: z.string(),
        reasoning: z.string().nullable(),
        emotion: z.string(),
        intensity: z.string(),
        subtext: z.string(),
        createdAt: z.string(),
      })
    )
    .optional(),
});

const StatusColors: Record<string, string> = {
  pending: "secondary",
  running: "default",
  completed: "default",
  failed: "destructive",
  cancelled: "secondary",
  awaiting_user: "default",
};

export function ConversationPanel({ input, result, isLoading }: ToolRendererProps) {
  const [turns, setTurns] = useState<MessageRecord[]>([]);
  const [streamStatus, setStreamStatus] = useState<string>("pending");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [doneTurns, setDoneTurns] = useState(0);
  const [totalTurns, setTotalTurns] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  useEffect(() => {
    if (isLoading || !result) return;

    // Extract jobId: from result for conversation_start, from input for conversation_job_status
    const startParsed = ConversationStartResultSchema.safeParse(result);
    const statusParsed = ConversationJobStatusResultSchema.safeParse(result);
    const inputJobId =
      typeof input === "object" &&
      input !== null &&
      "jobId" in input &&
      typeof (input as { jobId: unknown }).jobId === "string"
        ? (input as { jobId: string }).jobId
        : null;

    let jobId: string | null = null;

    if (startParsed.success) {
      jobId = startParsed.data.jobId;
    } else if (statusParsed.success) {
      // Pre-populate existing turns from job status result
      if (statusParsed.data.messages) {
        setTurns(statusParsed.data.messages as MessageRecord[]);
      }
      setStreamStatus(statusParsed.data.status);
      setDoneTurns(statusParsed.data.doneTurns);
      setTotalTurns(statusParsed.data.totalTurns);
      // Use jobId from input to stream remaining turns if job not terminal
      jobId = inputJobId;
    }

    if (!jobId) return;

    const es = new EventSource(`/api/conversations/jobs/${jobId}/stream`);

    es.addEventListener("turn", (e) => {
      const turn = JSON.parse(e.data) as MessageRecord;
      setTurns((prev) => [...prev, turn]);
    });

    es.addEventListener("status", (e) => {
      const s = JSON.parse(e.data) as {
        status: string;
        doneTurns: number;
        totalTurns: number;
      };
      setStreamStatus(s.status);
      setDoneTurns(s.doneTurns);
      setTotalTurns(s.totalTurns);
    });

    es.addEventListener("done", () => {
      es.close();
    });

    es.addEventListener("error", (e) => {
      if ("data" in e) {
        const d = JSON.parse((e as MessageEvent).data) as { message: string };
        setStreamError(d.message);
      } else {
        setStreamError("Connection lost");
      }
      es.close();
    });

    return () => es.close();
  }, [isLoading, input, result]);

  if (isLoading) {
    return (
      <div className="my-1 border border-border rounded-xl overflow-hidden">
        <div className="p-3 border-b border-border space-y-2">
          <Shimmer className="h-4 w-40" />
          <div className="flex gap-1">
            <Shimmer className="size-6 rounded-full" />
            <Shimmer className="size-6 rounded-full" />
          </div>
        </div>
        <div className="p-3 space-y-3">
          <TurnSkeleton />
          <TurnSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="my-1 border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-border flex items-center justify-between">
        <div className="space-y-0.5">
          <p className="text-sm font-semibold">Conversation</p>
          {totalTurns > 0 && (
            <p className="text-xs text-muted-foreground">
              {doneTurns}/{totalTurns} turns
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {streamError && (
            <Badge variant="destructive" className="text-xs">
              {streamError}
            </Badge>
          )}
          <Badge
            variant={
              (StatusColors[streamStatus] as "default" | "secondary" | "destructive" | "outline") ??
              "secondary"
            }
            className="text-xs capitalize"
          >
            {streamStatus}
          </Badge>
        </div>
      </div>

      {/* Turn feed */}
      <div className="max-h-80 overflow-y-auto p-3 space-y-3">
        {turns.length === 0 && streamStatus === "running" && (
          <TurnSkeleton />
        )}
        {turns.map((turn) => (
          <Turn key={turn.id} turn={turn} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function Turn({ turn }: { turn: MessageRecord }) {
  return (
    <div className="flex items-start gap-2">
      <Monogram name={turn.characterName} size={28} shape="circle" flat />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-semibold">{turn.characterName}</span>
          {turn.emotion && (
            <Badge variant="outline" className="text-xs px-1 py-0">
              {turn.emotion}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground whitespace-pre-wrap">{turn.content}</p>
      </div>
    </div>
  );
}

function TurnSkeleton() {
  return (
    <div className="flex items-start gap-2">
      <div className="animate-pulse bg-muted rounded-full size-7 shrink-0" />
      <div className="flex-1 space-y-1">
        <div className="animate-pulse bg-muted rounded h-2.5 w-20" />
        <div className="animate-pulse bg-muted rounded h-2 w-full" />
        <div className="animate-pulse bg-muted rounded h-2 w-3/4" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
bun run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/chat/_components/tool-renderers/conversation-panel.tsx
git commit -m "feat: add ConversationPanel renderer with SSE streaming"
```

---

## Task 10: Wire renderers into tool-call-block registry

**Files:**
- Modify: `frontend/app/chat/_components/tool-call-block.tsx`

Add imports and populate the registry. This is the only change to `tool-call-block.tsx` after Task 3.

- [ ] **Step 1: Add imports and populate registry**

At the top of `tool-call-block.tsx`, after the existing `"use client"` directive and imports, add:

```tsx
import { CharacterCard } from "./tool-renderers/character-card";
import { CharacterDeleteCard } from "./tool-renderers/character-delete-card";
import { ResultSummaryCard } from "./tool-renderers/result-summary-card";
import { ConversationPanel } from "./tool-renderers/conversation-panel";
```

Then replace the empty registry object:

```ts
const toolRenderers: Record<string, ComponentType<ToolRendererProps>> = {
  mcp__openormus__character_create: CharacterCard,
  mcp__openormus__character_update: CharacterCard,
  mcp__openormus__character_delete: CharacterDeleteCard,
  mcp__openormus__character_list: ResultSummaryCard,
  mcp__openormus__character_find: ResultSummaryCard,
  mcp__openormus__character_research: ResultSummaryCard,
  mcp__openormus__show_research: ResultSummaryCard,
  mcp__openormus__conversation_start: ConversationPanel,
  mcp__openormus__conversation_job_status: ConversationPanel,
};
```

- [ ] **Step 2: Verify typecheck passes**

```bash
bun run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Build passes**

```bash
bun run build
```

Expected: Build succeeds. Note: build may warn about missing env vars — those are expected in CI without a `.env.local`. The build itself must not error on TypeScript or module resolution.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/chat/_components/tool-call-block.tsx
git commit -m "feat: wire all tool renderers into ToolCallBlock registry"
```

---

## Verification

After all tasks complete:

```bash
bun run typecheck   # must pass
bun run build       # must pass
bun run dev:frontend  # start dev server, open http://localhost:3000
```

Test in browser:
1. Start a chat session and trigger `character_create` — CharacterCard with skeleton → full profile should appear.
2. Trigger `character_list` — ResultSummaryCard with count, expand to see character cards.
3. Trigger `conversation_start` — ConversationPanel skeleton → turns stream in live.
4. Trigger `character_delete` — CharacterDeleteCard with "Archived" badge.
5. Any tool call should show the fallback accordion for unmapped tools.
