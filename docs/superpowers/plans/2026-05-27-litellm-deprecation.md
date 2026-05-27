# LiteLLM Deprecation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the LiteLLM proxy and `@anthropic-ai/sdk` entirely; route all LLM calls through the OpenAI SDK pointed at a configurable OpenAI-compatible `LLM_BASE_URL`.

**Architecture:** A single `createLLMClient()` factory in `frontend/lib/llm-client.ts` returns an `OpenAI` instance using `LLM_BASE_URL` / `LLM_API_KEY`. All four LLM call sites import it. Tool type definitions in the agent layer switch from the Anthropic SDK `Tool` type to a local `AnthropicTool` type (the intermediate shape that `loop.ts`'s `toOpenAITool()` already adapts). LiteLLM config files and scripts are deleted.

**Tech Stack:** `openai` npm package (already in `frontend/package.json`); Bun; TypeScript strict mode.

---

## File Map

| Action | Path | What changes |
|--------|------|-------------|
| Create | `frontend/lib/llm-client.ts` | Shared `createLLMClient()` factory |
| Create | `frontend/lib/agent/types.ts` | Local `AnthropicTool` type (replaces Anthropic SDK type) |
| Modify | `frontend/lib/agent/loop.ts` | Import `AnthropicTool` from `./types`; use `createLLMClient()` |
| Modify | `frontend/lib/agent/mcp_bridge.ts` | Replace Anthropic SDK `Tool` import with local type |
| Modify | `frontend/lib/agent/tools/exa_research.ts` | Same |
| Modify | `frontend/lib/agent/tools/wizard.ts` | Same |
| Modify | `frontend/lib/conversation/next.ts` | Use `createLLMClient()` (also fixes spurious `/v1` append) |
| Modify | `frontend/app/api/chat/stream/route.ts` | Migrate `autoTitle` to OpenAI SDK |
| Modify | `frontend/app/api/conversations/improve-context/route.ts` | Migrate to OpenAI SDK |
| Modify | `frontend/lib/orchestrator.ts` | Replace raw fetch with OpenAI SDK |
| Modify | `.env.example` | Rename `ANTHROPIC_BASE_URL` → `LLM_BASE_URL`, `ANTHROPIC_API_KEY` → `LLM_API_KEY`; remove LiteLLM section |
| Modify | `package.json` (root) | Remove `dev:llm`, `dev:llm:stop`; remove LiteLLM from `dev`/`start` |
| Modify | `frontend/package.json` | Remove `@anthropic-ai/sdk` dependency |
| Modify | `AGENTS.md` | Update §3 bootstrap, §4 dev commands, §7 external services |
| Delete | `litellm_config.yaml` | No longer needed |
| Delete | `litellm.env.example` | No longer needed |
| Delete | `scripts/dev-llm.sh` | No longer needed |

---

## Task 1: Create local `AnthropicTool` type

**Why:** `mcp_bridge.ts`, `exa_research.ts`, `wizard.ts` annotate tool objects with the Anthropic SDK `Tool` type (which has `input_schema`). `loop.ts` already has this type inline. Extract it once so all files can share it without the SDK dependency.

**Files:**
- Create: `frontend/lib/agent/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// frontend/lib/agent/types.ts
export type AnthropicTool = {
  name: string;
  description?: string;
  input_schema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
};
```

- [ ] **Step 2: Verify file exists**

Run: `ls frontend/lib/agent/types.ts`
Expected: file listed

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/agent/types.ts
git commit -m "feat: add local AnthropicTool type to replace Anthropic SDK type"
```

---

## Task 2: Create shared LLM client factory

**Files:**
- Create: `frontend/lib/llm-client.ts`

- [ ] **Step 1: Create the factory**

```typescript
// frontend/lib/llm-client.ts
import OpenAI from "openai";

export function createLLMClient(): OpenAI {
  return new OpenAI({
    baseURL: process.env["LLM_BASE_URL"] ?? "http://localhost:11434/v1",
    apiKey: process.env["LLM_API_KEY"] ?? "local",
  });
}
```

- [ ] **Step 2: Verify TypeScript is happy**

Run: `bun run typecheck --cwd frontend 2>&1 | head -20`

If no errors related to this file, proceed. (Other errors may exist until migration is complete — that's expected.)

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/llm-client.ts
git commit -m "feat: add createLLMClient factory"
```

---

## Task 3: Migrate tool type annotations (mcp_bridge, exa_research, wizard)

**Files:**
- Modify: `frontend/lib/agent/mcp_bridge.ts`
- Modify: `frontend/lib/agent/tools/exa_research.ts`
- Modify: `frontend/lib/agent/tools/wizard.ts`

- [ ] **Step 1: Update `mcp_bridge.ts`**

Replace line 1:
```typescript
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
```
with:
```typescript
import type { AnthropicTool } from "../types";
```

Then update the return type of `buildMcpTools()` on line 108:
```typescript
export function buildMcpTools(): AnthropicTool[] {
```

- [ ] **Step 2: Update `exa_research.ts`**

Replace line 2:
```typescript
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
```
with:
```typescript
import type { AnthropicTool } from "../types";
```

Then update the three tool variable type annotations (lines 16, 48, and wherever the third tool is declared):
```typescript
export const researchShowTool: AnthropicTool = { ... }
export const researchCharacterBasicsTool: AnthropicTool = { ... }
export const researchCharacterDetailsTool: AnthropicTool = { ... }
```

- [ ] **Step 3: Update `wizard.ts`**

Replace line 1:
```typescript
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
```
with:
```typescript
import type { AnthropicTool } from "../types";
```

Then update line 3:
```typescript
export const wizardTool: AnthropicTool = { ... }
```

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/agent/mcp_bridge.ts frontend/lib/agent/tools/exa_research.ts frontend/lib/agent/tools/wizard.ts
git commit -m "refactor: replace Anthropic SDK Tool type with local AnthropicTool type"
```

---

## Task 4: Update `loop.ts`

**Files:**
- Modify: `frontend/lib/agent/loop.ts`

- [ ] **Step 1: Remove inline type definition and add imports**

At the top of the file, replace:
```typescript
import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionFunctionTool,
} from "openai/resources/chat/completions";
```
with:
```typescript
import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionFunctionTool,
} from "openai/resources/chat/completions";
import { createLLMClient } from "@/lib/llm-client";
import type { AnthropicTool } from "./types";
```

- [ ] **Step 2: Remove the inline `AnthropicTool` type definition**

Delete these lines (currently around lines 21–25):
```typescript
type AnthropicTool = {
  name: string;
  description?: string;
  input_schema: { type: string; properties?: Record<string, unknown>; required?: string[] };
};
```

- [ ] **Step 3: Replace inline client construction**

Replace:
```typescript
  const client = new OpenAI({
    baseURL: process.env["ANTHROPIC_BASE_URL"] ?? "http://localhost:4000",
    apiKey: process.env["ANTHROPIC_API_KEY"] ?? "local",
  });
```
with:
```typescript
  const client = createLLMClient();
```

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck --cwd frontend 2>&1 | grep "loop.ts"`
Expected: no errors for `loop.ts`

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/agent/loop.ts
git commit -m "refactor: loop.ts use createLLMClient and import AnthropicTool from types"
```

---

## Task 5: Update `next.ts`

`next.ts` currently appends `/v1` to `ANTHROPIC_BASE_URL`. The new factory already includes the full base URL (e.g. `http://localhost:11434/v1`), so the append must be removed.

**Files:**
- Modify: `frontend/lib/conversation/next.ts`

- [ ] **Step 1: Add import**

Add to the imports at the top:
```typescript
import { createLLMClient } from "@/lib/llm-client";
```

- [ ] **Step 2: Replace client construction**

Find (around line 92–95):
```typescript
  const client = new OpenAI({
    baseURL: `${process.env["ANTHROPIC_BASE_URL"] ?? "http://localhost:4000"}/v1`,
    apiKey: process.env["ANTHROPIC_API_KEY"] ?? "",
  });
```
Replace with:
```typescript
  const client = createLLMClient();
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck --cwd frontend 2>&1 | grep "next.ts"`
Expected: no errors for `next.ts`

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/conversation/next.ts
git commit -m "refactor: next.ts use createLLMClient (also removes incorrect /v1 append)"
```

---

## Task 6: Migrate `autoTitle` in `chat/stream/route.ts`

**Files:**
- Modify: `frontend/app/api/chat/stream/route.ts`

- [ ] **Step 1: Remove Anthropic SDK import, add factory import**

Replace:
```typescript
import Anthropic from "@anthropic-ai/sdk";
```
with:
```typescript
import { createLLMClient } from "@/lib/llm-client";
```

- [ ] **Step 2: Rewrite `autoTitle` function**

Replace the entire `autoTitle` function (currently lines 90–110) with:
```typescript
async function autoTitle(sessionId: string, firstMessage: string): Promise<void> {
  try {
    const client = createLLMClient();
    const response = await client.chat.completions.create({
      model: process.env["CONVERSATION_MODEL"] ?? "default",
      max_tokens: 20,
      messages: [
        {
          role: "system",
          content:
            "Generate a 3-6 word title for a chat session. Reply with ONLY the title, no punctuation.",
        },
        { role: "user", content: firstMessage },
      ],
    });
    const text = response.choices[0]?.message.content ?? "";
    if (text) {
      await setSessionTitle(prisma, sessionId, text.slice(0, 100));
    }
  } catch (err) {
    console.error("autoTitle failed:", err);
  }
}
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck --cwd frontend 2>&1 | grep "stream/route.ts"`
Expected: no errors for this file

- [ ] **Step 4: Commit**

```bash
git add frontend/app/api/chat/stream/route.ts
git commit -m "refactor: autoTitle migrate from Anthropic SDK to OpenAI SDK"
```

---

## Task 7: Migrate `improve-context/route.ts`

**Files:**
- Modify: `frontend/app/api/conversations/improve-context/route.ts`

- [ ] **Step 1: Remove Anthropic import, add factory import**

Replace:
```typescript
import Anthropic from "@anthropic-ai/sdk";
```
with:
```typescript
import { createLLMClient } from "@/lib/llm-client";
```

- [ ] **Step 2: Replace client instantiation and LLM call**

Find (around lines 58–80):
```typescript
  const client = new Anthropic({
    baseURL: process.env["ANTHROPIC_BASE_URL"] ?? "http://localhost:4000",
    apiKey: process.env["ANTHROPIC_API_KEY"] ?? "local",
  });
  const model = process.env["CONVERSATION_MODEL"];
  if (!model) {
    return NextResponse.json({ error: "CONVERSATION_MODEL env var not set" }, { status: 500 });
  }

  const start = Date.now();
  let improved = "";
  let llmError: string | null = null;

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      temperature: 1,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    improved = textBlock?.type === "text" ? textBlock.text.trim() : "";
  } catch (err) {
```

Replace with:
```typescript
  const client = createLLMClient();
  const model = process.env["CONVERSATION_MODEL"];
  if (!model) {
    return NextResponse.json({ error: "CONVERSATION_MODEL env var not set" }, { status: 500 });
  }

  const start = Date.now();
  let improved = "";
  let llmError: string | null = null;

  try {
    const response = await client.chat.completions.create({
      model,
      max_tokens: 1024,
      temperature: 1,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });
    improved = (response.choices[0]?.message.content ?? "").trim();
  } catch (err) {
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck --cwd frontend 2>&1 | grep "improve-context"`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add frontend/app/api/conversations/improve-context/route.ts
git commit -m "refactor: improve-context migrate from Anthropic SDK to OpenAI SDK"
```

---

## Task 8: Migrate `orchestrator.ts`

**Files:**
- Modify: `frontend/lib/orchestrator.ts`

- [ ] **Step 1: Rewrite the file**

Replace the entire file contents with:
```typescript
import { createLLMClient } from "@/lib/llm-client";

type OrchestratorParticipant = {
  characterId: string;
  character: { name: string; sheet: unknown };
};

type OrchestratorMessage = {
  character: { name: string };
  content: string;
};

export async function selectNextSpeakerWithOrchestrator(
  participants: OrchestratorParticipant[],
  messages: OrchestratorMessage[]
): Promise<string> {
  const model = process.env["CONVERSATION_MODEL"];

  if (!model) {
    console.error("[orchestrator] CONVERSATION_MODEL env var not set");
    return fallback(participants, messages);
  }

  const charactersList = participants
    .map(
      (p) =>
        `- id: ${p.characterId} | Name: ${p.character.name}` +
        (p.character.sheet != null
          ? ` | Character sheet: ${JSON.stringify(p.character.sheet)}`
          : "")
    )
    .join("\n");

  const historyText =
    messages.length > 0
      ? messages.map((m) => `[${m.character.name}]: ${m.content}`).join("\n")
      : "(The scene has just begun — no lines have been spoken yet.)";

  const userMessage = [
    "Characters:",
    charactersList,
    "",
    "Conversation so far:",
    historyText,
    "",
    "Which character should speak next? Reply with their characterId only.",
  ].join("\n");

  try {
    const client = createLLMClient();
    const response = await client.chat.completions.create({
      model,
      max_tokens: 64,
      messages: [
        {
          role: "system",
          content:
            "You are a conversation director for a multi-character roleplay scene. " +
            "Given the characters and conversation history below, decide which character " +
            "should speak next to make the conversation feel natural and engaging. " +
            "Reply with only the characterId of the chosen character, nothing else.",
        },
        { role: "user", content: userMessage },
      ],
    });

    const chosen = (response.choices[0]?.message.content ?? "").trim();

    if (participants.some((p) => p.characterId === chosen)) {
      return chosen;
    }

    console.error(`[orchestrator] Invalid characterId returned: "${chosen}"`);
    return fallback(participants, messages);
  } catch (err) {
    console.error("[orchestrator] Error:", err);
    return fallback(participants, messages);
  }
}

function fallback(
  participants: OrchestratorParticipant[],
  messages: OrchestratorMessage[]
): string {
  if (participants.length === 0) throw new Error("[orchestrator] fallback called with empty participants");
  const p = participants[messages.length % participants.length];
  if (p === undefined) throw new Error("[orchestrator] fallback index out of range");
  return p.characterId;
}
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck --cwd frontend 2>&1 | grep "orchestrator"`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/orchestrator.ts
git commit -m "refactor: orchestrator replace raw Anthropic fetch with OpenAI SDK"
```

---

## Task 9: Update env vars and delete LiteLLM files

**Files:**
- Modify: `.env.example`
- Modify: `package.json` (root)
- Delete: `litellm_config.yaml`, `litellm.env.example`, `scripts/dev-llm.sh`

- [ ] **Step 1: Update `.env.example` LLM section**

Replace the LLM proxy and LiteLLM sections (currently lines 29–38):
```
# ── LLM proxy (frontend → LiteLLM) ────────────────────────────────────────────
# Start LiteLLM with: bun run dev:llm
ANTHROPIC_BASE_URL="http://localhost:4000"
ANTHROPIC_API_KEY="any-string"
# Must match a model_name in litellm_config.yaml
CONVERSATION_MODEL="default"

# ── LiteLLM provider credentials ──────────────────────────────────────────────
# LITELLM_MODEL and LITELLM_API_KEY live in litellm.env.local (not here).
# Copy litellm.env.example → litellm.env.local and fill in your provider key.
```
with:
```
# ── LLM provider (OpenAI-compatible) ──────────────────────────────────────────
# URL of any OpenAI-compatible API endpoint.
# Examples:
#   http://localhost:11434/v1   ← Ollama
#   https://openrouter.ai/api/v1  ← OpenRouter
#   https://api.openai.com/v1   ← OpenAI
LLM_BASE_URL="http://localhost:11434/v1"
# API key for the provider above
LLM_API_KEY="your-provider-api-key"
# Model name passed directly to the provider (no alias needed)
CONVERSATION_MODEL="gemini/gemini-2.5-flash-lite"
```

- [ ] **Step 2: Update root `package.json` scripts**

In `package.json` at root, update:

1. `"dev"` script — remove `"./scripts/dev-llm.sh"` from the concurrently command:
```json
"dev": "concurrently --names \"frontend,mcp\" --prefix-colors \"blue,green\" --kill-others-on-fail \"bun run --cwd frontend dev\" \"bun run --cwd mcp_server dev\"",
```

2. `"start"` script — same removal:
```json
"start": "concurrently --names \"frontend,mcp\" --prefix-colors \"blue,green\" --kill-others-on-fail \"bun run --cwd frontend start\" \"bun run --cwd mcp_server start\"",
```

3. Delete the `"dev:llm"` and `"dev:llm:stop"` script entries entirely.

- [ ] **Step 3: Delete LiteLLM files**

```bash
git rm litellm_config.yaml litellm.env.example scripts/dev-llm.sh
```

- [ ] **Step 4: Commit**

```bash
git add .env.example package.json
git commit -m "chore: remove LiteLLM config, rename env vars to LLM_BASE_URL/LLM_API_KEY"
```

---

## Task 10: Remove `@anthropic-ai/sdk` from frontend

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Remove the dependency**

In `frontend/package.json`, delete the line:
```json
"@anthropic-ai/sdk": "^0.96.0",
```

- [ ] **Step 2: Run bun install to update lockfile**

```bash
bun install
```

Expected output includes lockfile updated; no errors about missing packages.

- [ ] **Step 3: Verify no remaining Anthropic SDK imports**

```bash
grep -r "@anthropic-ai/sdk" frontend/
```

Expected: no output (zero matches).

- [ ] **Step 4: Run full typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 5: Run build**

```bash
bun run build
```

Expected: build succeeds.

- [ ] **Step 6: Run mcp_server tests**

```bash
bun test --cwd mcp_server
```

Expected: all pass (mcp_server was not touched; this confirms no cross-workspace breakage).

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json bun.lock
git commit -m "chore: remove @anthropic-ai/sdk dependency"
```

---

## Task 11: Update AGENTS.md

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Update §3 Bootstrap**

Remove the `bun run dev:llm` line and the `litellm.env.local` symlink line from the bootstrap block:

Replace:
```bash
bun install                                    # install all workspaces
cp .env.example .env.local                     # fill in DATABASE_URL, DIRECT_URL, secrets
cp litellm.env.example litellm.env.local       # fill in LITELLM_MODEL and LITELLM_API_KEY
ln -sf ../.env.local frontend/.env.local       # frontend reads from root source of truth
ln -sf ../.env.local mcp_server/.env.local     # mcp_server reads from root source of truth
bun run prisma:migrate:dev                     # run DB migrations
bun run dev:frontend                           # start Next.js on :3000
bun run dev:mcp                                # start MCP server on :3001
```
with:
```bash
bun install                                    # install all workspaces
cp .env.example .env.local                     # fill in DATABASE_URL, DIRECT_URL, LLM_BASE_URL, LLM_API_KEY
ln -sf ../.env.local frontend/.env.local       # frontend reads from root source of truth
ln -sf ../.env.local mcp_server/.env.local     # mcp_server reads from root source of truth
bun run prisma:migrate:dev                     # run DB migrations
bun run dev:frontend                           # start Next.js on :3000
bun run dev:mcp                                # start MCP server on :3001
```

- [ ] **Step 2: Update §3 Env file layout**

Remove the `litellm.env.local` line from the env file layout block:

Replace:
```
.env.local           ← single source of truth (gitignored)
frontend/.env.local  ← symlink → ../.env.local
mcp_server/.env.local← symlink → ../.env.local
litellm.env.local    ← LiteLLM only: LITELLM_MODEL + LITELLM_API_KEY (gitignored)
```
with:
```
.env.local           ← single source of truth (gitignored)
frontend/.env.local  ← symlink → ../.env.local
mcp_server/.env.local← symlink → ../.env.local
```

Remove the sentence: `LiteLLM runs in an isolated env scope — it never sees DATABASE_URL or app secrets.`

- [ ] **Step 3: Update §4 Development Commands table**

Remove the `LiteLLM proxy (dev)` row:
```
| LiteLLM proxy (dev)  | `bun run dev:llm`  |
```

- [ ] **Step 4: Update §6 LLM — LiteLLM proxy section**

Replace the section header and content:
```
### LLM — LiteLLM proxy
- Frontend calls LiteLLM directly via HTTP: `ANTHROPIC_BASE_URL=http://localhost:4000`.
  `ANTHROPIC_API_KEY` is the LiteLLM master key, not a direct Anthropic key.
- **Never hardcode a model name** — pass model as an argument (`CONVERSATION_MODEL` env); LiteLLM config decides routing.
- Every LLM call must be logged: `model`, `prompt_hash`, `temperature_ms`, `latency_ms`, `userId`.
```
with:
```
### LLM — OpenAI-compatible provider
- Frontend calls the provider directly via the OpenAI SDK: `LLM_BASE_URL` is the provider endpoint (any OpenAI-compatible URL), `LLM_API_KEY` is the provider key.
- **Never hardcode a model name** — pass model as an argument (`CONVERSATION_MODEL` env).
- Every LLM call must be logged: `model`, `prompt_hash`, `temperature_ms`, `latency_ms`, `userId`.
```

- [ ] **Step 5: Update §7 External Services — LiteLLM proxy section**

Replace:
```
**LiteLLM proxy**
Runs at `http://localhost:4000` and is *not* part of this repo. It accepts requests in Anthropic
API shape and routes them to the configured provider by model name. The frontend sends all
LLM traffic here via `ANTHROPIC_BASE_URL`. If LiteLLM is unavailable the chat handler must fail fast
with a clear error — no silent retries that bill the wrong provider.
```
with:
```
**LLM provider**
Any OpenAI-compatible API reachable at `LLM_BASE_URL`. The frontend sends all LLM traffic directly
to this endpoint via the OpenAI SDK. If the provider is unavailable the chat handler must fail fast
with a clear error — no silent retries.
```

- [ ] **Step 6: Update §11 References**

Remove the `litellm_config.yaml` line:
```
- `litellm_config.yaml` — LiteLLM proxy routing config (model aliases, providers)
```

- [ ] **Step 7: Update §12 Worktree Setup CLI bootstrap**

In the manual CLI setup block, remove:
```bash
ln -sf "$ROOT/litellm.env.local" litellm.env.local
```

- [ ] **Step 8: Commit**

```bash
git add AGENTS.md
git commit -m "docs: update AGENTS.md to reflect LiteLLM removal"
```

---

## Task 12: Final verification

- [ ] **Step 1: Full typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 2: Full build**

```bash
bun run build
```

Expected: build succeeds with no errors.

- [ ] **Step 3: mcp_server tests**

```bash
bun test --cwd mcp_server
```

Expected: all pass.

- [ ] **Step 4: Confirm no Anthropic SDK references remain**

```bash
grep -r "@anthropic-ai" . --include="*.ts" --include="*.json" --exclude-dir=node_modules --exclude-dir=.git
```

Expected: no output.

- [ ] **Step 5: Confirm no ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY references remain**

```bash
grep -r "ANTHROPIC_BASE_URL\|ANTHROPIC_API_KEY" . --exclude-dir=node_modules --exclude-dir=.git
```

Expected: no output.
