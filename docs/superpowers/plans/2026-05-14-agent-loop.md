# Agent Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a streaming Claude agent loop at `/api/chat/stream` with MCP tool integration, Exa research sub-tool, character wizard sub-tool, persistent chat history, and a standalone `/chat` frontend page.

**Architecture:** The main agent loop (Claude Agent SDK via `@anthropic-ai/sdk`) runs in a Next.js route handler. It calls six MCP tools on the existing MCP server via HTTP, plus two inline tools (`research_character_online` and `start_character_wizard`). Chat history persists in new `AgentSession`/`AgentTurn` Prisma models. The frontend page streams responses using `fetch()` + `ReadableStream`.

**Tech Stack:** `@anthropic-ai/sdk`, Next.js 16 App Router, Prisma 7, Supabase Auth, Node.js `crypto` (JWT signing), React `useReducer` (stream state), Tailwind/shadcn/ui (existing).

---

## File Structure

```
Modified:
  prisma/schema.prisma                          add AgentSession, AgentTurn, User relation
  .env.example                                  add MCP_SERVER_URL

New:
  frontend/lib/agent/token.ts                   generateToolToken(userId) — HS256 JWT
  frontend/lib/agent/stream.ts                  StreamChunk type + SSE encode helper
  frontend/lib/agent/history.ts                 createSession, appendTurn, getTurns, listSessions
  frontend/lib/agent/mcp_bridge.ts              initMcpSession, callMcpTool, buildMcpTools
  frontend/lib/agent/tools/exa_research.ts      research_character_online handler
  frontend/lib/agent/tools/wizard.ts            start_character_wizard tool def + handler
  frontend/lib/agent/prompt.ts                  AGENT_SYSTEM_PROMPT
  frontend/lib/agent/loop.ts                    runAgentLoop generator
  frontend/app/api/auth/tool-token/route.ts     POST — issue short-lived JWT
  frontend/app/api/chat/stream/route.ts         POST — SSE agent stream
  frontend/app/api/agent-sessions/route.ts      GET — list sessions for sidebar
  frontend/app/chat/_components/session-sidebar.tsx
  frontend/app/chat/_components/message-thread.tsx
  frontend/app/chat/_components/tool-call-block.tsx
  frontend/app/chat/_components/chat-input.tsx
  frontend/app/chat/page.tsx
```

---

## Task 1: Install @anthropic-ai/sdk + update .env.example

**⚠️ AGENTS.md §10:** Adding a new dependency requires explicit user approval. Ask before running `bun add`.

**Files:**
- Modify: `frontend/package.json` (via bun add)
- Modify: `.env.example`

- [ ] **Step 1: Get user approval, then install**

```bash
bun add @anthropic-ai/sdk --cwd frontend
```

Expected output: package added to `frontend/package.json` under `dependencies`.

- [ ] **Step 2: Add MCP_SERVER_URL to .env.example**

In `.env.example`, after the `PORT=3001` line, add:

```
# Agent loop — URL of the MCP server's HTTP endpoint
MCP_SERVER_URL=http://localhost:3001/mcp
```

Also add to your local `.env.local`.

- [ ] **Step 3: Verify SDK import resolves**

```bash
bun run --cwd frontend tsc --noEmit 2>&1 | head -5
```

Expected: no "Cannot find module '@anthropic-ai/sdk'" errors (there may be other errors at this stage — that's fine).

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json bun.lock .env.example
git commit -m "chore: add @anthropic-ai/sdk to frontend, add MCP_SERVER_URL to env"
```

---

## Task 2: Prisma — AgentSession + AgentTurn models

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add AgentSession and AgentTurn models**

Open `prisma/schema.prisma`. After the `Message` model (line 82), append:

```prisma
model AgentSession {
  id        String      @id @default(uuid()) @db.Uuid
  userId    String      @db.Uuid @map("user_id")
  title     String?
  createdAt DateTime    @default(now()) @map("created_at")
  updatedAt DateTime    @updatedAt @map("updated_at")

  user  User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  turns AgentTurn[]

  @@map("agent_sessions")
}

model AgentTurn {
  id        String       @id @default(uuid()) @db.Uuid
  sessionId String       @db.Uuid @map("session_id")
  role      String       // "user" | "assistant"
  content   String
  toolCalls Json?        // serialized tool_use + tool_result blocks from Claude SDK
  createdAt DateTime     @default(now()) @map("created_at")

  session AgentSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId])
  @@map("agent_turns")
}
```

- [ ] **Step 2: Add agentSessions relation to User model**

In `prisma/schema.prisma`, find the `User` model. Add `agentSessions AgentSession[]` after `conversations Conversation[]`:

```prisma
model User {
  id         String      @id @db.Uuid
  email      String      @unique
  createdAt  DateTime    @default(now()) @map("created_at")
  updatedAt  DateTime    @updatedAt @map("updated_at")
  characters Character[]
  conversations Conversation[]
  agentSessions AgentSession[]

  @@map("users")
}
```

- [ ] **Step 3: Run migration**

```bash
bun run prisma:migrate:dev
```

When prompted for a name, enter: `add_agent_session_turn`

Expected: migration applied, no errors.

- [ ] **Step 4: Regenerate Prisma client**

```bash
bun run prisma:generate
```

Expected: client regenerated in `frontend/lib/generated/prisma` and `mcp_server/src/generated/prisma`.

- [ ] **Step 5: Verify types compile**

```bash
bun run --cwd frontend tsc --noEmit 2>&1 | grep -i "agent" | head -10
```

Expected: no errors referencing AgentSession or AgentTurn.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma frontend/lib/generated mcp_server/src/generated
git commit -m "feat: add AgentSession and AgentTurn Prisma models"
```

---

## Task 3: JWT helper + tool-token endpoint

**Files:**
- Create: `frontend/lib/agent/token.ts`
- Create: `frontend/app/api/auth/tool-token/route.ts`

- [ ] **Step 1: Create `frontend/lib/agent/token.ts`**

```typescript
// frontend/lib/agent/token.ts
import { createHmac } from "crypto";

function base64url(input: string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Generates a short-lived HS256 JWT for MCP server auth.
 * Payload: { userId, iat, exp } — exp is iat + 300s (5 min).
 * Compatible with jsonwebtoken.verify() used in mcp_server.
 */
export function generateToolToken(userId: string): string {
  const secret = process.env["JWT_SECRET"];
  if (!secret) throw new Error("JWT_SECRET not configured");

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ userId, iat: now, exp: now + 300 }),
  );
  const sig = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  return `${header}.${payload}.${sig}`;
}
```

- [ ] **Step 2: Create `frontend/app/api/auth/tool-token/route.ts`**

```typescript
// frontend/app/api/auth/tool-token/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateToolToken } from "@/lib/agent/token";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const token = generateToolToken(user.id);
    return NextResponse.json({ token });
  } catch {
    return NextResponse.json({ error: "token_generation_failed" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Type-check**

```bash
bun run --cwd frontend tsc --noEmit 2>&1 | grep "tool-token\|token\.ts" | head -10
```

Expected: no errors on these files.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/agent/token.ts frontend/app/api/auth/tool-token/route.ts
git commit -m "feat: add JWT tool-token helper and endpoint"
```

---

## Task 4: Stream types + agent history helpers

**Files:**
- Create: `frontend/lib/agent/stream.ts`
- Create: `frontend/lib/agent/history.ts`

- [ ] **Step 1: Create `frontend/lib/agent/stream.ts`**

```typescript
// frontend/lib/agent/stream.ts

export type StreamChunk =
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; tool: string; input: unknown }
  | { type: "tool_result"; tool: string; preview: string }
  | { type: "error"; message: string }
  | { type: "done"; sessionId: string };

const encoder = new TextEncoder();

/** Encodes a StreamChunk as a Server-Sent Events data line. */
export function encodeChunk(chunk: StreamChunk): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`);
}
```

- [ ] **Step 2: Create `frontend/lib/agent/history.ts`**

```typescript
// frontend/lib/agent/history.ts
import type { PrismaClient } from "@/lib/generated/prisma/client";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

export type AgentSessionSummary = {
  id: string;
  title: string | null;
  createdAt: string;
};

/** Creates a new AgentSession row. Returns the new session ID. */
export async function createSession(
  prisma: PrismaClient,
  userId: string,
): Promise<string> {
  const session = await prisma.agentSession.create({
    data: { userId },
  });
  return session.id;
}

/**
 * Appends a user turn and assistant turn to an AgentSession.
 * toolCalls stores the raw Claude SDK content blocks for the assistant turn.
 */
export async function appendTurns(
  prisma: PrismaClient,
  sessionId: string,
  userMessage: string,
  assistantContent: string,
  toolCalls: unknown,
): Promise<void> {
  // Prisma Json? fields accept any JSON-serialisable value; cast through object.
  const toolCallsJson = toolCalls as Record<string, unknown>[] | null | undefined;
  await prisma.agentTurn.createMany({
    data: [
      { sessionId, role: "user", content: userMessage },
      {
        sessionId,
        role: "assistant",
        content: assistantContent,
        ...(toolCallsJson !== null && toolCallsJson !== undefined
          ? { toolCalls: toolCallsJson }
          : {}),
      },
    ],
  });
}

/**
 * Loads all turns for a session as Claude SDK MessageParam objects.
 * Tool calls stored in JSON are rehydrated into content arrays.
 */
export async function getSessionMessages(
  prisma: PrismaClient,
  sessionId: string,
  userId: string,
): Promise<MessageParam[]> {
  const session = await prisma.agentSession.findFirst({
    where: { id: sessionId, userId },
    include: { turns: { orderBy: { createdAt: "asc" } } },
  });

  if (!session) return [];

  return session.turns.map((turn) => {
    if (turn.role === "user") {
      return { role: "user" as const, content: turn.content };
    }
    // assistant turns: reconstruct content blocks from stored toolCalls JSON
    const blocks = turn.toolCalls as unknown;
    if (Array.isArray(blocks) && blocks.length > 0) {
      return { role: "assistant" as const, content: blocks as MessageParam["content"] };
    }
    return { role: "assistant" as const, content: turn.content };
  });
}

/** Returns summaries of all agent sessions for the given user, newest first. */
export async function listSessions(
  prisma: PrismaClient,
  userId: string,
): Promise<AgentSessionSummary[]> {
  const sessions = await prisma.agentSession.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, createdAt: true },
  });
  return sessions.map((s) => ({
    id: s.id,
    title: s.title,
    createdAt: s.createdAt.toISOString(),
  }));
}

/** Sets the title of an AgentSession (fire-and-forget safe). */
export async function setSessionTitle(
  prisma: PrismaClient,
  sessionId: string,
  title: string,
): Promise<void> {
  await prisma.agentSession.update({ where: { id: sessionId }, data: { title } });
}
```

- [ ] **Step 3: Type-check**

```bash
bun run --cwd frontend tsc --noEmit 2>&1 | grep "stream\.ts\|history\.ts" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/agent/stream.ts frontend/lib/agent/history.ts
git commit -m "feat: add agent stream types and session history helpers"
```

---

## Task 5: MCP bridge

The bridge initializes a StreamableHTTP session with the MCP server and calls tools via JSON-RPC over HTTP.

**Files:**
- Create: `frontend/lib/agent/mcp_bridge.ts`

- [ ] **Step 1: Create `frontend/lib/agent/mcp_bridge.ts`**

```typescript
// frontend/lib/agent/mcp_bridge.ts
import type { Tool } from "@anthropic-ai/sdk/resources/messages";

const MCP_URL = process.env["MCP_SERVER_URL"] ?? "http://localhost:3001/mcp";

export type McpSession = { sessionId: string; jwt: string };

/**
 * Opens a StreamableHTTP session with the MCP server.
 * Must be called once per agent request before any tool calls.
 */
export async function initMcpSession(jwt: string): Promise<McpSession> {
  const response = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "openormus-agent", version: "1.0.0" },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`MCP init failed ${response.status}: ${body}`);
  }

  const sessionId = response.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("MCP server did not return mcp-session-id header");

  // Send initialized notification to complete handshake
  await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });

  return { sessionId, jwt };
}

/**
 * Calls a named MCP tool and returns the parsed JSON result.
 * MCP tools always return { content: [{ type: "text", text: "..." }] }.
 */
export async function callMcpTool(
  session: McpSession,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.jwt}`,
      "mcp-session-id": session.sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  });

  const data = (await response.json()) as {
    result?: { content?: Array<{ type: string; text?: string }> };
    error?: { message: string };
  };

  if (data.error) throw new Error(data.error.message);

  const text = data.result?.content?.[0]?.text;
  if (text === undefined) throw new Error(`Empty response from MCP tool ${toolName}`);
  return JSON.parse(text) as unknown;
}

/** Tool definitions for the six MCP tools, in Anthropic Tool format. */
export function buildMcpTools(): Tool[] {
  return [
    {
      name: "mcp__openormus__character_list",
      description: "List all characters saved in your collection.",
      input_schema: { type: "object" as const, properties: {}, required: [] },
    },
    {
      name: "mcp__openormus__character_save",
      description: "Save a character to your collection. Use after research_character_online returns results.",
      input_schema: {
        type: "object" as const,
        properties: {
          name: { type: "string" },
          sheet: { type: "object", description: "CharacterSearchResult object" },
        },
        required: ["name", "sheet"],
      },
    },
    {
      name: "mcp__openormus__character_update",
      description: "Update an existing character's sheet by ID.",
      input_schema: {
        type: "object" as const,
        properties: {
          id: { type: "string", description: "UUID of the character to update" },
          sheet: { type: "object", description: "New CharacterSearchResult object" },
        },
        required: ["id", "sheet"],
      },
    },
    {
      name: "mcp__openormus__character_delete",
      description: "Delete a character from your collection by ID.",
      input_schema: {
        type: "object" as const,
        properties: { id: { type: "string", description: "UUID of the character to delete" } },
        required: ["id"],
      },
    },
    {
      name: "mcp__openormus__character_db_search",
      description: "Search your saved characters by name or description using fuzzy similarity.",
      input_schema: {
        type: "object" as const,
        properties: {
          query: { type: "string" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: ["query"],
      },
    },
    {
      name: "mcp__openormus__scene_simulate",
      description: "Simulate a scene between fictional characters. Returns dialogue.",
      input_schema: {
        type: "object" as const,
        properties: {
          characterIds: { type: "array", items: { type: "string" }, description: "Array of character UUIDs" },
          setting: { type: "string", description: "Scene location and context" },
          prompt: { type: "string", description: "What the scene is about" },
        },
        required: ["characterIds", "setting", "prompt"],
      },
    },
  ];
}
```

- [ ] **Step 2: Type-check**

```bash
bun run --cwd frontend tsc --noEmit 2>&1 | grep "mcp_bridge" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/agent/mcp_bridge.ts
git commit -m "feat: add MCP HTTP bridge for agent tool calls"
```

---

## Task 6: Inline tools — Exa research + wizard

**Files:**
- Create: `frontend/lib/agent/tools/exa_research.ts`
- Create: `frontend/lib/agent/tools/wizard.ts`

- [ ] **Step 1: Create `frontend/lib/agent/tools/exa_research.ts`**

This tool orchestrates the Exa services directly (no nested LLM loop — the intelligence is inside `characterSearchHandler` and `showSearchHandler`).

```typescript
// frontend/lib/agent/tools/exa_research.ts
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import {
  characterSearchHandler,
  showSearchHandler,
} from "@open-ormus/shared";
import type { CharacterSearchResult } from "@open-ormus/shared";

export const exaResearchTool: Tool = {
  name: "research_character_online",
  description:
    "Search for a fictional character or show online using Exa. " +
    "Call this autonomously when the user mentions a fictional character name or asks to import characters from a show/film/book. " +
    "Returns an array of CharacterSearchResult objects. " +
    "After this tool returns, call mcp__openormus__character_save for each result to persist them.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description:
          "Character name (e.g. 'Walter White') or show title (e.g. 'Breaking Bad'). " +
          "For a show title, all main characters will be fetched.",
      },
    },
    required: ["query"],
  },
};

/**
 * Determines if a query likely refers to a show/film/book title rather than a single character.
 * Heuristic: no comma, fewer than 4 words, and matches known title patterns.
 */
function looksLikeShowTitle(query: string): boolean {
  const wordCount = query.trim().split(/\s+/).length;
  return !query.includes(",") && wordCount <= 4;
}

/** Handles the research_character_online tool call. */
export async function handleExaResearch(args: {
  query: string;
}): Promise<CharacterSearchResult[] | { error: string }> {
  const { query } = args;

  // If query looks like a show title, get character list first
  if (looksLikeShowTitle(query)) {
    const showResult = await showSearchHandler({ query });
    if ("error" in showResult) {
      // Fall through to direct character search
    } else if (showResult.results.length > 0) {
      const firstShow = showResult.results[0];
      if (firstShow && firstShow.characters.length > 0) {
        // Search up to 5 characters in parallel
        const names = firstShow.characters.slice(0, 5);
        const results = await Promise.all(
          names.map((name) => characterSearchHandler({ query: `${name}, ${firstShow.title}` })),
        );
        const found = results.filter(
          (r): r is CharacterSearchResult => !("error" in r) && r.confidence > 0,
        );
        if (found.length > 0) return found;
      }
    }
  }

  // Direct character search
  const result = await characterSearchHandler({ query });
  if ("error" in result) return { error: result.error };
  return [result];
}
```

- [ ] **Step 2: Create `frontend/lib/agent/tools/wizard.ts`**

```typescript
// frontend/lib/agent/tools/wizard.ts
import type { Tool } from "@anthropic-ai/sdk/resources/messages";

export const wizardTool: Tool = {
  name: "start_character_wizard",
  description:
    "Start the step-by-step wizard to create a custom original character from scratch. " +
    "Call this when the user wants to create a character without searching online. " +
    "After this tool returns, follow the wizard instructions exactly: ask each question ONE AT A TIME, " +
    "wait for the user's answer before asking the next, then call mcp__openormus__character_save when done.",
  input_schema: { type: "object" as const, properties: {}, required: [] },
};

export function handleWizard(): string {
  return JSON.stringify({
    status: "wizard_started",
    instructions:
      "Ask the user these questions STRICTLY ONE AT A TIME in this order. " +
      "Do not ask the next question until the user has answered the current one. " +
      "1) What is the character's name? " +
      "2) What fictional universe do they come from, or are they an original creation? " +
      "3) List 3 to 5 core personality traits. " +
      "4) Summarise their backstory in 2 to 3 sentences. " +
      "5) Give 2 to 3 examples of their speech patterns or notable quotes. " +
      "6) What are their main goals and their deepest fears? " +
      "7) (Optional) Name any key relationships — the user can say 'none' or 'skip'. " +
      "After collecting all answers, call mcp__openormus__character_save with the assembled sheet. " +
      "Set confidence to 1 (manually created). Set firstAppearanceDate to '0000-01-01' if not known. " +
      "Set imageUrl to null.",
  });
}
```

- [ ] **Step 3: Type-check**

```bash
bun run --cwd frontend tsc --noEmit 2>&1 | grep "exa_research\|wizard" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/agent/tools/exa_research.ts frontend/lib/agent/tools/wizard.ts
git commit -m "feat: add research_character_online and start_character_wizard inline tools"
```

---

## Task 7: Agent prompt + main loop

**Files:**
- Create: `frontend/lib/agent/prompt.ts`
- Create: `frontend/lib/agent/loop.ts`

- [ ] **Step 1: Create `frontend/lib/agent/prompt.ts`**

```typescript
// frontend/lib/agent/prompt.ts

export const AGENT_SYSTEM_PROMPT = `You are an assistant for managing a collection of fictional characters.

## What you can do

- **List, search, add, edit, delete** characters using the mcp__openormus__character_* tools.
- **Research characters online**: when a user mentions a specific fictional character by name or asks to import characters from a show/film/book, call \`research_character_online\` immediately — do not ask for confirmation. After it returns, call \`mcp__openormus__character_save\` for each result.
- **Bulk import**: when the user asks to import all characters from a show (e.g. "add all Breaking Bad characters"), announce a brief plan first ("I'll search for X characters: ...") then call \`research_character_online\` once per character, saving each as you go.
- **Custom character wizard**: when the user wants to create an original character from scratch (not based on an existing fictional character), call \`start_character_wizard\`. Follow the returned instructions exactly — ask one question at a time, wait for the user's answer before continuing.
- **Scene simulation**: when the user wants to simulate a scene or conversation between characters, identify the relevant character IDs from the user's collection and call \`mcp__openormus__scene_simulate\`.

## Rules

- Never invent character IDs. Use \`mcp__openormus__character_list\` or \`mcp__openormus__character_db_search\` to find real IDs.
- Do not skip wizard steps. Ask each question in order.
- Keep responses concise. When listing characters, summarise — do not dump full JSON.
- If a tool returns an error, explain it to the user in plain language.`;
```

- [ ] **Step 2: Create `frontend/lib/agent/loop.ts`**

```typescript
// frontend/lib/agent/loop.ts
import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  ToolResultBlockParam,
  ContentBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { encodeChunk } from "./stream";
import type { McpSession } from "./mcp_bridge";
import { buildMcpTools, callMcpTool } from "./mcp_bridge";
// jwtToken lives inside mcpSession.jwt — no separate param needed
import { handleExaResearch, exaResearchTool } from "./tools/exa_research";
import { handleWizard, wizardTool } from "./tools/wizard";
import { AGENT_SYSTEM_PROMPT } from "./prompt";

function extractTextContent(content: ContentBlock[]): string {
  return content
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * Runs the main agent loop for one user turn.
 * Calls onChunk for each SSE byte payload and returns history + assistant output.
 *
 * @param priorMessages - Rehydrated MessageParam[] from AgentTurn history
 * @param userMessage   - The new user message text
 * @param mcpSession    - Initialized MCP session (call initMcpSession first)
 * @param onChunk       - Called with each encoded SSE Uint8Array chunk
 * @returns Updated messages array, final assistant text, and raw content blocks
 */
export async function runAgentLoop(
  priorMessages: MessageParam[],
  userMessage: string,
  mcpSession: McpSession,
  onChunk: (data: Uint8Array) => void,
): Promise<{ messages: MessageParam[]; assistantText: string; toolCallsJson: unknown }> {
  const client = new Anthropic({
    baseURL: process.env["ANTHROPIC_BASE_URL"] ?? "http://localhost:4000",
    apiKey: process.env["ANTHROPIC_API_KEY"] ?? "local",
  });

  const send = (chunk: Parameters<typeof encodeChunk>[0]) => {
    onChunk(encodeChunk(chunk));
  };

  const messages: MessageParam[] = [
    ...priorMessages,
    { role: "user", content: userMessage },
  ];

  const tools = [...buildMcpTools(), exaResearchTool, wizardTool];

  let assistantText = "";
  let lastAssistantContent: ContentBlock[] = [];

  while (true) {
    const stream = client.messages.stream({
      model: process.env["CONVERSATION_MODEL"] ?? "default",
      max_tokens: 4096,
      system: AGENT_SYSTEM_PROMPT,
      tools,
      messages,
    });

    stream.on("text", (text) => {
      assistantText += text;
      send({ type: "text_delta", text });
    });

    const finalMessage = await stream.finalMessage();
    lastAssistantContent = finalMessage.content;
    messages.push({ role: "assistant", content: finalMessage.content });

    if (finalMessage.stop_reason !== "tool_use") break;

    const toolResults: ToolResultBlockParam[] = [];

    for (const block of finalMessage.content) {
      if (block.type !== "tool_use") continue;

      send({ type: "tool_start", tool: block.name, input: block.input });

      let result: unknown;
      try {
        if (block.name === "research_character_online") {
          const input = block.input as { query: string };
          result = await handleExaResearch(input);
        } else if (block.name === "start_character_wizard") {
          result = handleWizard();
        } else {
          result = await callMcpTool(
            mcpSession,
            block.name,
            block.input as Record<string, unknown>,
          );
        }
      } catch (err) {
        result = { error: err instanceof Error ? err.message : "tool_call_failed" };
      }

      const preview = JSON.stringify(result).slice(0, 300);
      send({ type: "tool_result", tool: block.name, preview });

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  // Return the full content blocks so the route handler can persist them
  return {
    messages,
    assistantText: extractTextContent(lastAssistantContent),
    toolCallsJson: lastAssistantContent,
  };
}
```

- [ ] **Step 3: Type-check**

```bash
bun run --cwd frontend tsc --noEmit 2>&1 | grep "loop\.ts\|prompt\.ts" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/agent/prompt.ts frontend/lib/agent/loop.ts
git commit -m "feat: add agent system prompt and main agent loop"
```

---

## Task 8: API routes — /api/chat/stream + /api/agent-sessions

**Files:**
- Create: `frontend/app/api/chat/stream/route.ts`
- Create: `frontend/app/api/agent-sessions/route.ts`

- [ ] **Step 1: Create `frontend/app/api/chat/stream/route.ts`**

```typescript
// frontend/app/api/chat/stream/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { generateToolToken } from "@/lib/agent/token";
import { encodeChunk } from "@/lib/agent/stream";
import {
  createSession,
  appendTurns,
  getSessionMessages,
  setSessionTitle,
} from "@/lib/agent/history";
import { initMcpSession } from "@/lib/agent/mcp_bridge";
import { runAgentLoop } from "@/lib/agent/loop";
import Anthropic from "@anthropic-ai/sdk";

const RequestSchema = z.object({
  message: z.string().min(1).max(8000),
  sessionId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  // 1. Auth
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 2. Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  const { message, sessionId: incomingSessionId } = parsed.data;

  // 3. Load or create session
  const sessionId = incomingSessionId ?? (await createSession(prisma, user.id));
  const priorMessages = await getSessionMessages(prisma, sessionId, user.id);
  const isFirstTurn = priorMessages.length === 0;

  // 4. Issue JWT for MCP
  const jwt = generateToolToken(user.id);

  // 5. Return a ReadableStream SSE response
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const onChunk = (data: Uint8Array) => controller.enqueue(data);

      try {
        // Initialize MCP session
        const mcpSession = await initMcpSession(jwt);

        // Run agent loop
        const { assistantText, toolCallsJson } = await runAgentLoop(
          priorMessages,
          message,
          mcpSession,
          onChunk,
        );

        // Persist turns
        try {
          await appendTurns(prisma, sessionId, message, assistantText, toolCallsJson);
        } catch (err) {
          console.error("Failed to persist AgentTurn:", err);
        }

        // Auto-title on first turn (fire-and-forget)
        if (isFirstTurn) {
          void autoTitle(prisma, sessionId, message, user.id);
        }

        // Send done event
        controller.enqueue(encodeChunk({ type: "done", sessionId }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Agent error";
        controller.enqueue(encodeChunk({ type: "error", message: msg }));
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

async function autoTitle(
  prisma: Parameters<typeof setSessionTitle>[0],
  sessionId: string,
  firstMessage: string,
  userId: string,
): Promise<void> {
  try {
    const client = new Anthropic({
      baseURL: process.env["ANTHROPIC_BASE_URL"] ?? "http://localhost:4000",
      apiKey: process.env["ANTHROPIC_API_KEY"] ?? "local",
    });
    const response = await client.messages.create({
      model: process.env["CONVERSATION_MODEL"] ?? "default",
      max_tokens: 20,
      system: "Generate a 3-6 word title for a chat session. Reply with ONLY the title, no punctuation.",
      messages: [{ role: "user", content: firstMessage }],
    });
    const titleBlock = response.content[0];
    if (titleBlock?.type === "text") {
      await setSessionTitle(prisma, sessionId, titleBlock.text.slice(0, 100));
    }
  } catch (err) {
    console.error("autoTitle failed:", err);
  }
}
```

- [ ] **Step 2: Create `frontend/app/api/agent-sessions/route.ts`**

```typescript
// frontend/app/api/agent-sessions/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { listSessions } from "@/lib/agent/history";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessions = await listSessions(prisma, user.id);
  return NextResponse.json(sessions);
}
```

- [ ] **Step 3: Type-check**

```bash
bun run --cwd frontend tsc --noEmit 2>&1 | grep "chat/stream\|agent-sessions" | head -10
```

Expected: no errors on these files.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/api/chat/stream/route.ts frontend/app/api/agent-sessions/route.ts
git commit -m "feat: add /api/chat/stream SSE route and /api/agent-sessions list route"
```

---

## Task 9: Chat UI components

**Files:**
- Create: `frontend/app/chat/_components/session-sidebar.tsx`
- Create: `frontend/app/chat/_components/tool-call-block.tsx`
- Create: `frontend/app/chat/_components/message-thread.tsx`
- Create: `frontend/app/chat/_components/chat-input.tsx`

- [ ] **Step 1: Create `frontend/app/chat/_components/session-sidebar.tsx`**

```tsx
// frontend/app/chat/_components/session-sidebar.tsx
"use client";

import type { AgentSessionSummary } from "@/lib/agent/history";

interface SessionSidebarProps {
  sessions: AgentSessionSummary[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onNew: () => void;
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  onSelect,
  onNew,
}: SessionSidebarProps) {
  return (
    <aside className="w-56 shrink-0 border-r border-border flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <button
          onClick={onNew}
          className="w-full text-sm font-medium px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          + New session
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {sessions.length === 0 && (
          <p className="text-xs text-muted-foreground px-2 py-4 text-center">No sessions yet</p>
        )}
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={`w-full text-left text-sm px-3 py-2 rounded-md truncate transition-colors ${
              s.id === activeSessionId
                ? "bg-accent text-accent-foreground"
                : "hover:bg-accent/50 text-foreground"
            }`}
          >
            {s.title ?? "Untitled session"}
          </button>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 2: Create `frontend/app/chat/_components/tool-call-block.tsx`**

```tsx
// frontend/app/chat/_components/tool-call-block.tsx
"use client";

import { useState } from "react";

interface ToolCallBlockProps {
  tool: string;
  input: unknown;
  result?: string;
}

export function ToolCallBlock({ tool, input, result }: ToolCallBlockProps) {
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
        {!open && result && (
          <span className="ml-auto text-muted-foreground truncate max-w-[200px]">{result}</span>
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
          {result && (
            <div>
              <p className="text-muted-foreground mb-1">Result preview</p>
              <pre className="bg-muted rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                {result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `frontend/app/chat/_components/message-thread.tsx`**

```tsx
// frontend/app/chat/_components/message-thread.tsx
"use client";

import { useEffect, useRef } from "react";
import { ToolCallBlock } from "./tool-call-block";

export type MessageBlock =
  | { type: "text"; content: string }
  | { type: "tool_call"; tool: string; input: unknown; result?: string }
  | { type: "error"; message: string };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  blocks: MessageBlock[];
};

interface MessageThreadProps {
  messages: ChatMessage[];
  isStreaming: boolean;
}

export function MessageThread({ messages, isStreaming }: MessageThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[80%] space-y-1 ${
              msg.role === "user"
                ? "bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2"
                : "w-full"
            }`}
          >
            {msg.blocks.map((block, i) => {
              if (block.type === "text") {
                return (
                  <p key={i} className="text-sm whitespace-pre-wrap">
                    {block.content}
                  </p>
                );
              }
              if (block.type === "tool_call") {
                return (
                  <ToolCallBlock
                    key={i}
                    tool={block.tool}
                    input={block.input}
                    result={block.result}
                  />
                );
              }
              if (block.type === "error") {
                return (
                  <p key={i} className="text-sm text-destructive">
                    ⚠ {block.message}
                  </p>
                );
              }
              return null;
            })}
            {msg.role === "assistant" && isStreaming && msg === messages[messages.length - 1] && (
              <span className="inline-block w-2 h-4 bg-foreground/60 animate-pulse rounded-sm" />
            )}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
```

- [ ] **Step 4: Create `frontend/app/chat/_components/chat-input.tsx`**

```tsx
// frontend/app/chat/_components/chat-input.tsx
"use client";

import { useRef } from "react";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const value = ref.current?.value.trim();
    if (!value || disabled) return;
    onSend(value);
    if (ref.current) ref.current.value = "";
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-border p-3 flex gap-2 items-end">
      <textarea
        ref={ref}
        disabled={disabled}
        onKeyDown={handleKeyDown}
        placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
        rows={1}
        className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 max-h-32 overflow-y-auto"
        style={{ minHeight: "40px" }}
      />
      <button
        onClick={handleSend}
        disabled={disabled}
        className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors shrink-0"
      >
        Send
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Type-check**

```bash
bun run --cwd frontend tsc --noEmit 2>&1 | grep "_components" | head -10
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/chat/_components/
git commit -m "feat: add chat UI components (sidebar, message thread, tool blocks, input)"
```

---

## Task 10: Chat page

**Files:**
- Create: `frontend/app/chat/page.tsx`

- [ ] **Step 1: Create `frontend/app/chat/page.tsx`**

This page fetches the initial session list server-side, then manages chat state client-side via `useReducer`.

```tsx
// frontend/app/chat/page.tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { listSessions } from "@/lib/agent/history";
import { ChatView } from "./_components/chat-view";

export default async function ChatPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const sessions = await listSessions(prisma, user.id);
  return <ChatView initialSessions={sessions} />;
}
```

- [ ] **Step 2: Create `frontend/app/chat/_components/chat-view.tsx`**

The client component that owns all state.

```tsx
// frontend/app/chat/_components/chat-view.tsx
"use client";

import { useReducer, useCallback } from "react";
import { SessionSidebar } from "./session-sidebar";
import { MessageThread, type ChatMessage, type MessageBlock } from "./message-thread";
import { ChatInput } from "./chat-input";
import type { AgentSessionSummary } from "@/lib/agent/history";
import type { StreamChunk } from "@/lib/agent/stream";

// ---- State ----

type ChatState = {
  messages: ChatMessage[];
  sessionId: string | null;
  isStreaming: boolean;
  sessions: AgentSessionSummary[];
};

type ChatAction =
  | { type: "SEND"; text: string }
  | { type: "TEXT_DELTA"; text: string }
  | { type: "TOOL_START"; tool: string; input: unknown }
  | { type: "TOOL_RESULT"; tool: string; preview: string }
  | { type: "DONE"; sessionId: string }
  | { type: "ERROR"; message: string }
  | { type: "NEW_SESSION" }
  | { type: "SESSION_TITLE"; sessionId: string; title: string };

function uid() {
  return Math.random().toString(36).slice(2);
}

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SEND": {
      const userMsg: ChatMessage = {
        id: uid(),
        role: "user",
        blocks: [{ type: "text", content: action.text }],
      };
      const assistantMsg: ChatMessage = { id: uid(), role: "assistant", blocks: [] };
      return {
        ...state,
        isStreaming: true,
        messages: [...state.messages, userMsg, assistantMsg],
      };
    }
    case "TEXT_DELTA": {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== "assistant") return state;
      const blocks = [...last.blocks];
      const tail = blocks[blocks.length - 1];
      if (tail?.type === "text") {
        blocks[blocks.length - 1] = { type: "text", content: tail.content + action.text };
      } else {
        blocks.push({ type: "text", content: action.text });
      }
      msgs[msgs.length - 1] = { ...last, blocks };
      return { ...state, messages: msgs };
    }
    case "TOOL_START": {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== "assistant") return state;
      const newBlock: MessageBlock = { type: "tool_call", tool: action.tool, input: action.input };
      msgs[msgs.length - 1] = { ...last, blocks: [...last.blocks, newBlock] };
      return { ...state, messages: msgs };
    }
    case "TOOL_RESULT": {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== "assistant") return state;
      // Update the last tool_call block with the result
      const blocks = [...last.blocks];
      for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i];
        if (b?.type === "tool_call" && b.tool === action.tool && !b.result) {
          blocks[i] = { ...b, result: action.preview };
          break;
        }
      }
      msgs[msgs.length - 1] = { ...last, blocks };
      return { ...state, messages: msgs };
    }
    case "DONE": {
      // Add session to sidebar if new
      const exists = state.sessions.some((s) => s.id === action.sessionId);
      const sessions = exists
        ? state.sessions
        : [{ id: action.sessionId, title: null, createdAt: new Date().toISOString() }, ...state.sessions];
      return { ...state, isStreaming: false, sessionId: action.sessionId, sessions };
    }
    case "ERROR": {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant") {
        msgs[msgs.length - 1] = {
          ...last,
          blocks: [...last.blocks, { type: "error", message: action.message }],
        };
      }
      return { ...state, isStreaming: false, messages: msgs };
    }
    case "NEW_SESSION": {
      return { ...state, messages: [], sessionId: null, isStreaming: false };
    }
    case "SESSION_TITLE": {
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.id === action.sessionId ? { ...s, title: action.title } : s,
        ),
      };
    }
    default:
      return state;
  }
}

// ---- Component ----

interface ChatViewProps {
  initialSessions: AgentSessionSummary[];
}

export function ChatView({ initialSessions }: ChatViewProps) {
  const [state, dispatch] = useReducer(chatReducer, {
    messages: [],
    sessionId: null,
    isStreaming: false,
    sessions: initialSessions,
  });

  const handleSend = useCallback(
    async (text: string) => {
      dispatch({ type: "SEND", text });

      try {
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, sessionId: state.sessionId ?? undefined }),
        });

        if (!response.ok || !response.body) {
          dispatch({ type: "ERROR", message: `HTTP ${response.status}` });
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const chunk = JSON.parse(line.slice(6)) as StreamChunk;
              if (chunk.type === "text_delta") dispatch({ type: "TEXT_DELTA", text: chunk.text });
              else if (chunk.type === "tool_start") dispatch({ type: "TOOL_START", tool: chunk.tool, input: chunk.input });
              else if (chunk.type === "tool_result") dispatch({ type: "TOOL_RESULT", tool: chunk.tool, preview: chunk.preview });
              else if (chunk.type === "done") dispatch({ type: "DONE", sessionId: chunk.sessionId });
              else if (chunk.type === "error") dispatch({ type: "ERROR", message: chunk.message });
            } catch {
              // malformed chunk — skip
            }
          }
        }
      } catch (err) {
        dispatch({ type: "ERROR", message: err instanceof Error ? err.message : "Network error" });
      }
    },
    [state.sessionId],
  );

  return (
    <div className="flex h-screen bg-background">
      <SessionSidebar
        sessions={state.sessions}
        activeSessionId={state.sessionId}
        onSelect={(id) => {
          // For now, new-session only — full session resume can be added later
          dispatch({ type: "NEW_SESSION" });
        }}
        onNew={() => dispatch({ type: "NEW_SESSION" })}
      />
      <div className="flex flex-col flex-1 min-w-0">
        <header className="border-b border-border px-4 py-3 flex items-center gap-2 shrink-0">
          <h1 className="text-sm font-semibold">OpenOrmus Assistant</h1>
          {state.isStreaming && (
            <span className="text-xs text-muted-foreground animate-pulse">Thinking…</span>
          )}
        </header>
        {state.messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-muted-foreground text-sm">
              Ask me to list, search, add, or edit your characters — or start a scene.
            </p>
          </div>
        ) : (
          <MessageThread messages={state.messages} isStreaming={state.isStreaming} />
        )}
        <ChatInput onSend={handleSend} disabled={state.isStreaming} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check the full frontend**

```bash
bun run --cwd frontend tsc --noEmit
```

Expected: zero errors. Fix any type issues before committing.

- [ ] **Step 4: Start dev server and smoke-test**

```bash
bun run dev:frontend &
bun run --cwd mcp_server dev &
```

Open `http://localhost:3000/chat`. Verify:
- Page loads without JS errors in the browser console
- Typing a message and pressing Enter sends it
- Agent replies stream in (check that text appears progressively)
- Asking "list my characters" shows a `mcp__openormus__character_list` tool block
- Tool block is collapsible

- [ ] **Step 5: Commit**

```bash
git add frontend/app/chat/
git commit -m "feat: add standalone /chat page with streaming agent UI"
```

---

## Self-Review Checklist (for the implementing engineer)

Before declaring done:

- [ ] `bun run --cwd frontend tsc --noEmit` passes with zero errors
- [ ] `/api/auth/tool-token` returns a JWT when called with a valid Supabase session
- [ ] `/api/chat/stream` streams `text_delta` events for a simple question
- [ ] `/api/chat/stream` shows a `tool_start` + `tool_result` block when asking "list my characters"
- [ ] `research_character_online` fires when asking "add Walter White"
- [ ] `start_character_wizard` fires when asking "create a custom character"
- [ ] Chat history persists — refreshing the page and selecting the session resumes context
- [ ] `/api/agent-sessions` returns the session list
- [ ] `MCP_AUTH_DISABLED=true` in `.env.local` allows local dev without JWT enforcement

---

## Known Gaps (out of scope, do not implement)

- Session resume from sidebar (selecting a past session only triggers new-session currently — full resume UI is a follow-on)
- Zod v3/v4 mismatch in `mcp_server` — tracked in AGENTS.md §11
- Real LLM dialogue in `scene_simulate` — currently returns canned lines
- LLM call logging (`model`, `prompt_hash`, `temperature_ms`, `latency_ms`, `userId`) — required by AGENTS.md §6 but omitted here; add as a follow-on
