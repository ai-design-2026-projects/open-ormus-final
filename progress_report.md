# OpenOrmus — Technical Report

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture](#2-system-architecture)
3. [Frontend — Next.js Application](#3-frontend--nextjs-application)
4. [MCP Server — External Tool Endpoint](#4-mcp-server--external-tool-endpoint)
5. [Shared Package — Single Source of Truth](#5-shared-package--single-source-of-truth)
6. [Database Design](#6-database-design)
7. [Evaluation Track](#7-evaluation-track)
8. [Security and Multi-tenancy](#8-security-and-multi-tenancy)
9. [Key Engineering Decisions](#9-key-engineering-decisions)
10. [Challenges and Solutions](#10-challenges-and-solutions)
11. [Feature Summary](#11-feature-summary)

---

## 1. Project Overview

OpenOrmus is a multi-surface web platform for creating structured fictional characters, simulating multi-character scenes driven by large language models, and **objectively measuring LLM behavioural fidelity** — whether a model remains consistent with a character's defined psychology over many interaction turns.

The platform targets three audiences: writers and storytellers who want to simulate dialogue between franchise characters or original creations; world-builders who need to test the voice and personality of their characters; and researchers or engineering teams benchmarking LLM character consistency.

### Three Access Channels

The same underlying tool logic is exposed through three distinct surfaces:

1. **Web UI** (Next.js) — `/chat` for the AI assistant, `/library` for character CRUD, `/conversations/[id]` for live scene rendering.
2. **Internal AI assistant** — Claude Agent SDK with MCP tool calling and SSE streaming.
3. **External MCP server** — Express 5 + `@modelcontextprotocol/sdk`, exposes all tools to any MCP-compatible client (e.g. Claude Code via plugin).

### Dual-Track Architecture

The system separates two operational modes:

- **Production track** (online, real-time) — live chat, multi-character scene generation as a background job, SSE streaming to the browser.
- **Evaluation track** (offline, batch) — reproduces scenes without writing to the database, uses a separate judge model, and produces structured transcripts and scorecards.

The critical design constraint is that both tracks share the same core turn-generation code (`packages/shared/conversation/turn.ts`). There is no drift between what gets evaluated and what users actually experience.

### Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS 4, shadcn/ui, Supabase Auth |
| MCP server | Express 5, `@modelcontextprotocol/sdk@^1.29`, JWT HS256 |
| Database | PostgreSQL 15+ on Supabase, Prisma 7 (single shared schema) |
| LLM | Any OpenAI-compatible provider (Ollama, OpenRouter, OpenAI) via `@openai/agents` |
| Runtime | Bun ≥ 1.2 |
| Validation | Zod (schema-first, types inferred — never hand-written) |
| External search | Exa API (`exa-js`) |

### Codebase Metrics

- 9 MCP tools registered
- 16 API routes in the frontend
- 10 Prisma models, 2 enums
- 1 shared Zod schema package consumed by both workspaces
- 9 Claude plugin skills
- 16 fictional characters in the evaluation dataset

---

## 2. System Architecture

### High-Level Block Diagram

```
                  ┌────────────────────────────────────┐
                  │  packages/shared                   │
                  │  (Zod schemas, tool descriptions,  │
                  │   services, conversation core)     │
                  └─────┬──────────┬───────────────────┘
                        │          │
              imports   │          │   imports
                        ▼          ▼
   ┌────────────────────────┐   ┌────────────────────────┐
   │  frontend/             │   │  mcp_server/           │
   │  Next.js 16 (:3000)    │   │  Express 5 (:3001)     │
   │                        │   │                        │
   │  /api/chat/stream ────►│   │  POST /mcp (StreamableHTTP)◄──┐
   │  /api/characters       │   │  GET  /mcp/sse              │
   │  /api/conversations    │   │  OAuth Resource Metadata    │
   │  /api/auth/tool-token  │   │  JWT middleware             │
   │  /api/oauth/…          │   │  9 tool registrations       │
   └─────────┬──────────────┘   └────────────▲───────────────┘
             │                               │
             │  JWT HS256, 5-min TTL         │ JWT validate
             └───────────────────────────────┘

                                  ▲
                                  │ HTTPS + OAuth2
                                  │
                       ┌──────────┴───────────┐
                       │  MCP clients         │
                       │  (Claude Code, etc.) │
                       └──────────────────────┘
```

### Database Entity Relationships

```
users ──┬── characters ──── character_pictures (3 sizes: 48/128/512 webp)
        ├── conversations ─┬── conversation_participants
        │                  ├── messages (emotion, intensity, subtext, reasoning)
        │                  ├── conversation_jobs (state machine)
        │                  └── llm_usages (per LLM call)
        ├── agent_sessions ─┬── agent_turns (JSONB item: AgentInputItem)
        │                   └── llm_usages
        └── llm_usages
```

### Cross-Cutting Concerns

**Single tool registry, three consumers.** Tool Zod schemas are defined in `packages/shared/schema/`, tool descriptions in `packages/shared/tool-descriptions.ts`. The MCP server registers them on a `McpServer` instance; the frontend calls them via an `MCPServerStreamableHttp` MCP client; the chat UI renders them as inline cards via tool-renderer components.

**JWT-based tenancy.** `POST /api/auth/tool-token` issues a short-lived HS256 JWT (`{userId, exp}`, max 5 minutes). The MCP server middleware validates the token and sets `req.userId`. User identity is propagated to tool handlers via `AsyncLocalStorage` (`userIdStorage`) — never via tool arguments.

**LLM agnosticism.** `LLM_BASE_URL`, `LLM_API_KEY`, and `CONVERSATION_MODEL` are environment variables. The entire stack uses the OpenAI SDK's `OpenAIChatCompletionsModel` interface, which accepts any OpenAI-compatible endpoint.

**LLM usage tracking.** Every LLM call is logged to the `llm_usages` table with: model name, `prompt_hash` (SHA-256, first 8 chars), `latency_ms`, input/output/cached/reasoning token counts, `cost_usd`, and source enum (`CONVERSATION | ORCHESTRATOR | AGENT_SESSION | IMPROVE_CONTEXT | OTHER`).

### Typical Flow: "Import a Character and Start a Scene"

1. User types "import Walter White from Breaking Bad" in `/chat`.
2. Agent calls `mcp__openormus__show_research` → returns show metadata and character list.
3. Agent calls `mcp__openormus__character_research` in parallel for each name.
4. Agent calls `mcp__openormus__character_create` with the assembled sheet.
5. Service downloads the image URL → Sharp resize to 48/128/512 px → WebP → Supabase Storage.
6. `/library` shows the character with avatar and monogram fallback.
7. User navigates to `/conversations`, clicks "New scene", picks 2+ characters and a strategy (Orchestrator or Round-robin).
8. `POST /api/conversations` creates the conversation and a background job, returns 202 with `conversationId` and `jobId`.
9. Background runner: for each turn, orchestrator LLM picks the next speaker, turn LLM generates dialogue + emotion block.
10. SSE stream → `/conversations/[id]` updates screenplay live.

---

## 3. Frontend — Next.js Application

### Route Map

| Route | Auth | Purpose |
|---|---|---|
| `/` | public | Landing page |
| `/login`, `/register` | public | Supabase email/password auth |
| `/forgot-password`, `/reset-password` | public | Password reset flow |
| `/library` | protected | Character list, search/sort, import wizard |
| `/chat` | protected | AI assistant with streaming tool calls |
| `/conversations` | protected | Scene list, polling on active tab |
| `/conversations/[id]` | protected | Live screenplay with SSE |
| `/settings` | protected | Profile, password |
| `/settings/usage` | protected | Token usage dashboard (cost by source) |
| `/preview` | public | Design system showcase |
| `/oauth/authorized` | callback | OAuth MCP callback |

### API Routes (~16 endpoints)

```
/api/auth/tool-token          POST  → issue short-lived JWT for MCP
/api/agent-sessions           GET, POST
/api/agent-sessions/[id]      GET, DELETE
/api/characters               GET, POST
/api/characters/[id]          GET, PATCH, DELETE
/api/characters/[id]/picture  POST
/api/chat/stream              POST  → SSE, agent loop with MCP
/api/conversations            GET, POST
/api/conversations/improve-context  POST
/api/conversations/[id]       GET, DELETE
/api/conversations/[id]/jobs  POST
/api/conversations/[id]/jobs/[jobId]         GET, DELETE
/api/conversations/[id]/jobs/[jobId]/stream  GET → SSE
/api/internal/conversation-jobs              POST (MCP → frontend bridge)
/api/oauth/authorize, /callback, /token, /register, /.well-known/…
/api/usage/summary            GET
```

### Key Implementation Files

**`lib/agent/loop.ts` — agent runner.**
Wraps the `@openai/agents` `Runner`. `MAX_TURNS = 12` (env-overridable). Distinguishes three outcome types: `MaxTurnsExceededError` (clean stop, accumulated items persisted), `AbortError` (clean stop on client disconnect), and real errors (returned as error payload). Items are always persisted regardless of exit reason.

**`lib/agent/sdk.ts` — logging model.**
`LoggingModel extends OpenAIChatCompletionsModel`. Intercepts every `response_done` event and writes a row to `llm_usages`. The SDK aggregates usage only at run level; this provides per-call granularity. Also implements `injectFilesFetch`, which patches the outbound request body to inject file content into the last user message and the `file-parser` plugin instruction for native PDF parsing.

**`lib/agent/mcp_bridge.ts`.**
Instantiates `MCPServerStreamableHttp` with `Authorization: Bearer <jwt>`. Tool auto-discovery is handled by the MCP SDK.

**`lib/agent/history.ts` — session persistence.**
`appendTurns` acquires a `SELECT … FOR UPDATE` lock on the session row before inserting, serializing concurrent appends and preserving the `seq` ordering. `getSessionMessages` reconstructs `AgentInputItem[]` arrays from the JSONB `item` column, which is the source of truth.

**`app/api/chat/stream/route.ts` — SSE entry point.**
Validates the request body with Zod. Uses `supabase.auth.getUser()` server-side (never `getSession()`, which does not revalidate the cookie). Produces a `ReadableStream<Uint8Array>`. A `safeEnqueue` wrapper absorbs errors thrown when the client has already closed the connection. After the first agent turn, fires a background `autoTitle` call (max 12 tokens, `reasoning_effort: "none"`) to generate a 3–6-word session title.

**`app/conversations/[id]/page.tsx` — screenplay view.**
Three-column layout: "NOW SPEAKING" pane with Plutchik emotion dot, "SCENE" context pane, "CAST STATE" pane with the last emotion per character. The screenplay centre renders `**bold**` as italic stage directions. Consumes SSE event types: `token`, `emotion`, `turn_done`, `thinking`, `thinking_done`, `user_turn`, `user_turn_done`, `error`, `done`. Each emitted token is followed by `await new Promise(r => setTimeout(r, 0))` to yield to the event loop and prevent HTTP chunk bundling.

---

## 4. MCP Server — External Tool Endpoint

### Role and Transport

The MCP server exposes the nine OpenOrmus tools to any MCP-compatible client. It runs as a standalone Express 5 process on port 3001, separate from the Next.js frontend.

Two transport modes are supported:

- **StreamableHTTP** — the modern MCP transport. A single `POST /mcp` endpoint handles both requests and responses.
- **SSE (legacy)** — `GET /mcp/sse` opens the server-sent event stream; `POST /mcp/messages` sends commands. Provided for backward compatibility.

Both modes create a `McpServer` instance per session, keyed by the `mcp-session-id` header. The server detects new sessions via `isInitializeRequest(body)`.

### Authentication Middleware

Every `/mcp` request passes through `src/auth/middleware.ts`:

1. Reads `Authorization: Bearer <jwt>`.
2. Verifies the token against `JWT_SECRET`.
3. Extracts `userId` from the payload.
4. Sets `req.userId`.
5. In development (`MCP_AUTH_DISABLED=true`), falls back to a fixed UUID if the header is absent.

The middleware returns a `WWW-Authenticate: Bearer resource_metadata=…` header on 401 responses, enabling OAuth auto-discovery per RFC 9728.

`userId` is propagated to tool handlers via `AsyncLocalStorage` (`userIdStorage` in `src/auth/context.ts`) without prop drilling.

### Internal Token Bridge

The `conversation_start` tool needs to trigger a background job by calling the frontend's `/api/internal/conversation-jobs` endpoint. This endpoint cannot accept a user-scoped JWT. The MCP server mints a separate internal token (`mintInternalToken(userId)`) signed with a different secret; the frontend validates it with `validateInternalToken`.

### The Nine Registered Tools

| Tool ID | Handler file | Description |
|---|---|---|
| `mcp__openormus__character_create` | `character_save.ts` | Save a complete character sheet |
| `mcp__openormus__character_list` | `character_list.ts` | List user's characters |
| `mcp__openormus__character_find` | `character_db_search.ts` | Fuzzy search by name/description (PostgreSQL trigrams) |
| `mcp__openormus__character_update` | `character_update.ts` | Full sheet replacement by ID |
| `mcp__openormus__character_delete` | `character_delete.ts` | Soft delete (archive) |
| `mcp__openormus__character_research` | `character_search.ts` | Exa API → full profile (basics + details, 2 calls) |
| `mcp__openormus__show_research` | `show_search.ts` | Exa API → show metadata + character list |
| `mcp__openormus__conversation_start` | `conversation_start.ts` | Create conversation + job, return IDs immediately |
| `mcp__openormus__conversation_job_status` | `conversation_job_status.ts` | Poll job status |

Every handler returns `{ content: [{ type: "text", text: JSON.stringify(result) }] }`. Returning a plain object is a silent protocol violation; the wrapper pattern is enforced across all handlers.

### OAuth 2.0 Resource Server (RFC 9728)

The MCP server advertises its protected resource metadata at `GET /.well-known/oauth-protected-resource`. The full OAuth flow (authorize, callback, token mint, dynamic client registration) is implemented in the frontend under `/api/oauth/`. This enables any MCP-compatible client that supports OAuth to connect to OpenOrmus without manual token management.

---

## 5. Shared Package — Single Source of Truth

`packages/shared` contains everything imported by both `frontend/` and `mcp_server/`. It has no dependency on Next.js or Express.

### Structure

```
packages/shared/
├── tool-descriptions.ts          # TOOL_DESCRIPTIONS export (human-readable)
├── schema/                       # Zod schemas — boundary validation
│   ├── character_saved.ts
│   ├── character_search.ts
│   ├── conversation.ts
│   ├── conversation_start.ts
│   └── emotion.ts                # EmotionSchema, parseEmotionBlock
├── services/                     # Business logic (provider-agnostic)
│   ├── character.service.ts
│   ├── character_search.service.ts
│   ├── character_picture.service.ts
│   └── show_search.service.ts
└── conversation/                 # Turn generation core
    ├── turn.ts                   # generateTurn() async generator
    ├── orchestrator.ts           # LLM-based next-speaker selection
    ├── build-messages.ts         # Alternating message construction
    ├── parse-turn.ts
    └── prompts/
        ├── character-roleplay.hbs
        └── helpers.ts
```

### Turn Generation — `generateTurn()`

Signature:
```ts
async function* generateTurn(
  input, config, signal?, onEmotion?
): AsyncGenerator<TurnEvent, TurnResult>
```

Yields three event types:
- `{type: "thinking"}` — model has started its reasoning pass.
- `{type: "thinking_done"}` — reasoning complete, emotion parsed.
- `{type: "token", text}` — a single dialogue token.

**Custom streaming state machine (5 states):**

```
pre_reasoning → in_reasoning → pre_emotion → in_emotion → dialogue
```

The machine incrementally buffers the LLM output stream looking for:
1. An optional `<|reasoning|>…<|reasoning|>` block (private character thought).
2. A mandatory `<|emotion|>{json}<|emotion|>` block with schema `{emotion, intensity, subtext}`, validated by `parseEmotionBlock`.
3. The public dialogue.

Resilience rules: if the model skips reasoning, the machine applies a 300-character lookahead and transitions directly to `pre_emotion`. If the emotion block is absent, the function throws `ConversationError("LITELLM_ERROR", "No emotion block found")`.

Token dial characters flow through without buffering once the state machine reaches `dialogue`, keeping perceived latency low.

`extra_body: { reasoning: { effort: "none" } }` is passed to the provider to suppress extended reasoning on the turn model (reasoning is simulated in-character via the `<|reasoning|>` block, not via the provider's built-in reasoning mechanism).

### Message Construction — `build-messages.ts`

For each character, historical turns are presented as:
- That character's own turns → `assistant` messages (reasoning + emotion visible).
- All other characters' turns → bundled into a single `user` message (reasoning stripped).

This ensures that a character's private thought and emotional state are part of its own context but are invisible to other characters, mirroring real human interaction.

### Orchestrator — `orchestrator.ts`

A separate LLM call with a "conversation director" system prompt. Inputs: participant list (ID, name, sheet), full conversation history. Output: a single `characterId` string. `max_tokens: 64` (the decision is one token). If the returned ID is invalid or the call fails, the system falls back to `messages.length % participants.length` (round-robin). The `excludeUser` flag prevents the user participant from being selected via the fallback.

### Character Roleplay Prompt — `character-roleplay.hbs`

A Handlebars template assembled from the character sheet fields:

- Identity: `name`, `archetype`, `shortDescription`
- Personality: `traits`, `backstory`, `speechPatterns`, `values`, `fears`, `goals`, `notableQuotes`, `abilities`, `copingStyle`, `knowledgeScope`
- Scene: `sceneContext`, `otherNames`
- Instructions: stay in character, vary response length, use subtext, do not break the fourth wall, output must follow the `<|reasoning|>…<|emotion|>…` structure.

All fields must be in English. The system enforces this at every input boundary.

### Zod Schema Philosophy

All types are inferred (`z.infer<typeof Schema>`) — hand-written interfaces duplicate the schema and create drift. Every input boundary (API route body, MCP tool args, LLM structured output) passes through `safeParse`. The known exception is a Zod version mismatch: `packages/shared` uses Zod v4 while `mcp_server` uses Zod v3; resolution pending.

---

## 6. Database Design

Single schema file at `prisma/schema.prisma`. Two Prisma client generators produce separate typed clients:

```prisma
generator client      { output = "../frontend/lib/generated/prisma" }
generator client_mcp  { output = "../mcp_server/src/generated/prisma" }
```

Both clients point to the same PostgreSQL database. There are no cross-imports between them.

### Models

**User** — mirrors the Supabase auth UUID. Relations to all other entities.

**Character** — `sheet: Json` stores the full personality sheet as JSONB (flexible schema, no migrations required for new fields). `archivedAt` implements soft deletion.

**CharacterPicture** — three rows per character (sizes 48, 128, 512). Composite unique on `(characterId, size)`. URLs include `?v=Date.now()` as an explicit cache-busting parameter.

**Conversation** — `turnStrategy` enum: `ORCHESTRATOR | ROUND_ROBIN`. `context` is the scene description.

**ConversationParticipant** — `isUserParticipant` boolean distinguishes human players from AI characters. `characterId` is nullable for user rows. Unique on `(conversationId, turnOrder)`.

**Message** — stores `content`, `reasoning` (private, not sent to other characters), `emotion`, `intensity`, `subtext`. Indexed on `conversationId`.

**AgentSession / AgentTurn** — `AgentTurn.item: Json` holds the complete `AgentInputItem` and is the source of truth for session reconstruction. `content` and `role` columns are denormalized for fast queries. Indexed on `(sessionId, seq)`.

**ConversationJob** — explicit state machine: `pending → running → awaiting_user → running → completed` (or `cancelled | failed`). `errorMessage` stored on failure.

**LlmUsage** — per-call logging. `source` enum distinguishes the five call origins. Nullable foreign keys to `conversationId` and `agentSessionId` to support all call sources.

### Multi-Tenancy Pattern

Every Prisma query explicitly filters by `userId` — belt-and-braces alongside Supabase row-level security. Example:

```ts
// Never:
prisma.character.findFirst({ where: { id } })
// Always:
prisma.character.findFirst({ where: { id, userId } })
```

---

## 7. Evaluation Track

### Philosophy

The evaluation track answers not "does it work?" but "does it work *well*?" It reuses the production turn-generation function (`packages/shared/conversation/turn.ts`) but runs entirely file-based, with no database writes, to guarantee reproducibility.

A separate judge model is used for scoring, enabling independent comparison of generation and evaluation models. All passes use `Promise.all` — conversations within a pass are processed in parallel.

### Four-Pass Pipeline

The four passes run in sequence. Each pass reads the output of the previous one.

```
generate_dataset.ts → judge_guessing.ts → reconstruct_persona.ts → context_drift.ts
       ↓                     ↓                     ↓                      ↓
  conversations/        judge_guessing/      reconstruct_persona/     context_drift/
```

**Pass 1 — Dataset generation (`evaluation/generate_dataset.ts`).**
Calls `generateTurn()` from `packages/shared` for each configured run (character × scenario pairing). Generation uses `temperature: 0` for determinism. Each run retries up to `MAX_ATTEMPTS = 3`; on total failure, the entire output directory is deleted (`rmSync`). Character names are replaced with aliases before writing, preventing judge contamination.

Entry point:
```bash
bun evaluation/generate_dataset.ts evaluation/configs/generate-dataset.yaml
```

Key config fields:
```yaml
output_dir: "dataset-001"
default_model: "xiaomi/mimo-v2-flash"
runs:
  - scenario: scenario_020
    characters: [char_001, char_007]
    turns: 4
    turn_strategy: ROUND_ROBIN   # or ORCHESTRATOR (≥3 characters)
```

Output: `evaluation/results/<output_dir>/conversations/001.yaml`, `002.yaml`, …

**Pass 2 — Judge guessing (`evaluation/judge_guessing.ts`).**
A panel of 1–3 judge LLMs receives each transcript (alias names, profiles shuffled and unlabelled) and must assign each alias to a real character name using three evidence tiers:

- Tier 1 — exact language: verbatim notable quotes are near-conclusive.
- Tier 2 — speech signature: pronoun choice, sentence rhythm, vocabulary register, rhetorical habits.
- Tier 3 — value in action: what the character chooses, refuses, or defends.

The profile shuffle is deterministic (seeded by `scenario_id`, using a linear congruential PRNG) to prevent positional bias while guaranteeing reproducibility. Real names are presented in a separate list, not linked to profiles. Every reason in the output must cite an exact transcript quote and a specific profile field.

Output schema (`JudgeOutputSchema`):
```ts
{ assignments: [{ alias, real_name, reasons: string[] }] }
```

Agreement across judges is reported as `inter_judge_agreement`.

**Pass 3 — Persona reconstruction (`evaluation/reconstruct_persona.ts`).**
A reconstructor LLM infers personality fields from the transcript — blind, no ground truth provided. A comparator panel then scores each reconstructed item against the ground truth with three labels: `match`, `no_match`, `contradiction`. A majority vote resolves disagreements between comparators; `comparator_agreement` quantifies how often they agree.

Six fields are in scope: `personalityTraits`, `speechPatterns`, `values`, `fears`, `goals`, `copingStyle`. Fields like `notableQuotes` and `backstory` are excluded (not reliably observable in short transcripts).

Item scores are numeric: `1` (match), `0` (no_match), `−1` (contradiction). Per-field aggregates:

```
precision = matched / observed_count
recall    = matched / gt_count
F1        = 2 · precision · recall / (precision + recall)
```

The **primary metric is contradiction rate, not recall**. Low recall may mean the scenario did not activate a trait — that is expected. An active contradiction (`score = -1`) is the meaningful failure signal: the model generated behaviour incompatible with the character's profile.

**Drift mode** (optional): set `segments: N` (N ≥ 2) to split each transcript into N equal windows and reconstruct independently per window. This surfaces whether fidelity holds, degrades, or recovers over time. The `gt_divergence_slope` is computed via OLS linear regression on the per-segment F1 values — a negative slope indicates fidelity degrading over the conversation.

**Pair differentiation**: for similar-pair conversations, the comparator runs in four directions on the `varyingAxis` field (A-on-A, B-on-B, A-on-B, B-on-A). A pair is considered *differentiated* when diagonal scores > 0.5 and cross scores < 0.5.

Output: `evaluation/results/<dataset_dir>/reconstruct_persona/<output_name>/`
- `conversations/` — per-conversation result files
- `summary.yaml` — aggregated metrics by field, difficulty, tier, and character pair

**Pass 4 — Context drift (`evaluation/context_drift.ts`).**
Scenario-aware and complementary to Pass 3. Pass 3 is scenario-blind — judges do not know what scenario the character was in. Pass 4 explicitly evaluates: (a) whether the scenario's stress axes were actively engaged across time, and (b) whether each character responded to that pressure in a way consistent with their personality sheet.

The judge scores per-segment using two label sets:

- `scenario_engagement`: `active | touched | absent`
- `character_alignment` (per character): `consistent | neutral | contradicts`

Labels map to scores: `active/consistent → 1.0`, `touched/neutral → 0.5`, `absent/contradicts → 0.0`. Majority vote across judge models produces a consensus label and a `confidence` value.

`total_drift = last_segment_score − first_segment_score`

Verdict thresholds:
```
total_drift < -0.25  → "degrading"
total_drift > +0.25  → "improving"
otherwise            → "stable"
```

Cross-referencing Pass 3 and Pass 4 identifies what specifically failed:

| Pass 3 ↓ \ Pass 4 → | High engagement | Low engagement |
|---|---|---|
| **High fidelity** | Traits expressed AND scenario engaged | Character consistent but scenario ignored |
| **Low fidelity** | Scenario worked but personality weak | Both failed |

### Results Directory Layout

```
evaluation/results/
└── dataset-001/
    ├── config.yaml
    ├── conversations/
    │   ├── 001.yaml
    │   └── ...
    ├── judge_guessing/
    │   └── judge-run-001/
    │       ├── config.yaml
    │       └── guessing_result.yaml
    ├── reconstruct_persona/
    │   └── reconstruct-run-001/
    │       ├── config.yaml
    │       ├── conversations/
    │       └── summary.yaml
    └── context_drift/
        └── drift-run-001/
            ├── config.yaml
            ├── conversations/
            └── summary.yaml
```

### Evaluation Dataset — Vethara

Vethara is a fictional island city-state invented for this project. The decision is methodological: if real characters (e.g. Walter White) are used, LLMs have seen them extensively during training and may produce accurate outputs from memorised knowledge, not from the character sheet. Vethara characters have no training-data footprint, so any fidelity observed is genuinely produced from the sheet.

**World context:** an isolated city-state emerging from 35 years of post-war isolation. Class divide between Ledgered citizens and Unregistered stateless persons. Fragile technocracy. Themes: memory, choice, agency vs. structure.

**Tier 1 — 8 distinctive archetypes** (char_001–char_008), arranged on a 2D grid (moral axis × agency axis):

|             | High Agency | Low Agency |
|-------------|-------------|------------|
| Idealist    | Rebel (char_001) | Martyr (char_002) |
| Cynic       | Schemer (char_003) | Fatalist (char_004) |
| Empath      | Mentor (char_005) | Absorber (char_006) |
| Pragmatist  | Guardian (char_007) | Adapter (char_008) |

**Tier 2 — 4 twin pairs** (char_009–char_016). Within each pair, every character field is word-for-word identical except one (`varyingAxis`). Permitted divergences outside `varyingAxis`: `name`, `archetype` label (A/B), `backstory` for pronoun agreement only, `notableQuotes` only when `varyingAxis` directly shapes speech.

| Pair | IDs | Varying axis | Split |
|---|---|---|---|
| Officials | char_009 / char_010 | `speechPatterns` | Formal measured prose vs. blunt working-class idioms |
| Survivors | char_011 / char_012 | `copingStyle` | Over-preparing/hoarding control vs. withdrawing/compartmentalising |
| Reformers | char_013 / char_014 | `fears` | Fear of being wrong vs. fear of becoming corrupt through success |
| Caregivers | char_015 / char_016 | `goals` | Immediate relief vs. systemic change |

A model that collapses to average behaviour cannot distinguish twin pair members. This is the sharpest signal in the benchmark.

**Scenarios:** 32 scenarios across a 4 × 8 `pressure_source × social_context` matrix, at three difficulty levels (`baseline`: 8, `moderate`: 12, `high`: 12). Twelve distinct `stress_axes` — the most frequent being `loyalty vs principle`, `obedience vs conscience`, and `transparency vs protection` (5 each).

**Universality purity check:** a scenario fails if any single character has 2+ `values` entries that cleanly resolve one of the scenario's stress axes without creating secondary tension. The check was applied to all 24 non-baseline scenarios. **18 failed and were revised** with additional constraints in `initial_prompt` to restore genuine moral tension for all 16 characters. 6 passed without modification.

### Configured Runs (dataset-001)

The reference config defines 7 runs with explicit pairing rationale:

| Run | Scenario | Characters | Turns | Strategy | Rationale |
|---|---|---|---|---|---|
| 1 | scenario_020 | char_001, char_007 | 4 | ROUND_ROBIN | Rebel vs. Guardian on mandatory compliance — the exact moral line where they diverge |
| 2 | scenario_026 | char_001, char_003 | 4 | ROUND_ROBIN | Rebel vs. Schemer on information power — same outcome, opposite motives |
| 3 | scenario_032 | char_002, char_004 | 4 | ROUND_ROBIN | Martyr vs. Fatalist on historical record — Senne's purpose vs. Mireth's cynicism |
| 4 | scenario_027 | char_005, char_006, char_008 | 4 | ORCHESTRATOR | Mentor + Absorber + Adapter — difficult knowledge, 3-way dynamic |
| 5 | scenario_016 | char_009, char_010 | 4 | ROUND_ROBIN | Officials pair on `speechPatterns` — highest speech-visibility scenario |
| 6 | scenario_022 | char_011, char_012 | 4 | ROUND_ROBIN | Survivors pair on `copingStyle` — crisis triage under non-renewable resource pressure |
| 7 | scenario_014 | char_013, char_014 | 4 | ROUND_ROBIN | Reformers pair on `fears` — unsolicited truth, identical hesitation different internal reason |

---

## 8. Security and Multi-tenancy

Multi-tenancy is enforced at three independent layers:

**Layer 1 — Supabase row-level security.** All tables have RLS policies scoped to the authenticated Supabase user.

**Layer 2 — Prisma query filtering.** Every query explicitly includes `userId` in the `where` clause, regardless of RLS. Belt-and-braces: a misconfiguration at the RLS layer does not produce a data leak.

**Layer 3 — JWT-based tool identity.** The MCP server reads `userId` exclusively from the validated JWT payload. Tool arguments cannot carry or override user identity.

**Server-side auth rule.** `supabase.auth.getUser()` is mandatory server-side. `getSession()` is forbidden for security decisions because it reads from the cookie without revalidating against the Supabase server, making it vulnerable to cookie tampering. This rule is codified in `AGENTS.md`.

**OAuth 2.0 with PKCE (RFC 7636).** External MCP clients authenticate via a full browser OAuth flow. `state` and `code_challenge` are HMAC-signed and stored in httpOnly cookies (600-second max-age). Only S256 challenge method is accepted. Dynamic client registration (`POST /api/oauth/register`) allows any compliant MCP client to self-register without manual configuration.

---

## 9. Key Engineering Decisions

### Custom Streaming State Machine

LLM output must carry two structured metadata fields (private reasoning and emotion block) alongside the public dialogue, in a single streaming call. A two-pass approach (generate all, then parse) would add latency and lose the ability to show the emotion dot before the dialogue begins.

The 5-state incremental parser processes the stream one character at a time:
```
pre_reasoning → in_reasoning → pre_emotion → in_emotion → dialogue
```
Dialogue tokens pass through immediately once the machine reaches the final state. The emotion block is available to the UI before the first dialogue token is emitted.

### Dual Prisma Client Generation

A single schema in the repository root generates two typed Prisma clients via two generator blocks:
- `frontend/lib/generated/prisma/` — used by Next.js route handlers and server components.
- `mcp_server/src/generated/prisma/` — used by Express tool handlers.

This avoids importing across workspace boundaries while keeping the schema as the sole source of truth.

### ConversationJob State Machine

Conversation generation is modelled as an explicit state machine (`pending → running → awaiting_user → running → completed / cancelled / failed`). Key implementation points:

- An `AbortController` per job enables clean mid-generation cancellation.
- A `userTurnResolvers` Map allows the runner to pause and resume when the user sends a message.
- A `cancelledJobs` Set guards against a race condition where a cancellation arrives between the DB update to `awaiting_user` and resolver registration.
- Mid-turn cancellation intentionally does not save partial messages.

### Streaming Backpressure

Without intervention, all tokens from the same TCP segment arrive at the client simultaneously, causing dialogue to appear in visible chunks rather than word-by-word. After each emitted token:

```ts
await new Promise(r => setTimeout(r, 0));
```

This yields to the Node.js event loop, allowing the HTTP write buffer to flush before the next token is processed.

### Concurrent Session Persistence

Multiple agent loops running in the same session (e.g., rapid consecutive user messages) can attempt to insert turns in parallel. The `appendTurns` function acquires a `SELECT … FOR UPDATE` lock on the session row before beginning the insert transaction. This serialises appends per session without introducing contention across sessions.

### LLM-Agnostic Orchestrator vs. Dedicated Orchestrator

The project contains two orchestrator implementations:
- `packages/shared/conversation/orchestrator.ts` — pure function, no side effects, used by the evaluation runner.
- `frontend/lib/orchestrator.ts` — same logic, but with structured logging to stderr and `LlmUsageSource.ORCHESTRATOR` tracking, used by the production job runner.

This separation enforces the evaluation isolation constraint: the evaluation runner must not produce DB writes or LLM usage logs.

---

## 10. Challenges and Solutions

### Tool ID Mismatch

MCP tool IDs are strings (`mcp__openormus__<name>`). The agent SDK requires the exact same string in `allowedTools`. A mismatch silently disables the tool — no error is thrown. Resolution: a centralised tool ID registry with a shared constant, enforced by naming convention.

### Streaming Chunks Bundling

Tokens from the same TCP segment were being emitted as a single HTTP chunk, producing a poor word-by-word streaming experience. Resolution: `await new Promise(r => setTimeout(r, 0))` after each emit, explicitly explained in a code comment.

### Reasoning Model Budget on Orchestrator

Models with built-in chain-of-thought reasoning spend their reasoning budget before outputting the orchestrator's one-token response. With `max_tokens: 64`, the reasoning fills the budget and the output is truncated, causing constant fallback to round-robin. Resolution: `max_tokens: 2048` (headroom for reasoning), and `extra_body: { reasoning: { effort: "none" } }` on the turn stream model (not the orchestrator).

### LLM Non-Deterministic Emotion Output

The emotion block is critical: the UI displays it in real time, and the evaluation pipeline uses it for scoring. Resolution: the custom state machine parser validates the `<|emotion|>{json}<|emotion|>` block against a Zod schema. If the block is missing, a `ConversationError` is thrown (not silently ignored).

### Judge Model Bias

A judge LLM presented with character names might match by name recognition rather than by analysing dialogue. Resolution: all character names are replaced with aliases in transcripts; profiles are presented unlabelled and shuffled with a seeded deterministic shuffle. The judge sees real names only in the target list and must resolve them by behavioural evidence.

### Edge Runtime and Prisma

Next.js middleware runs on the Edge runtime, which does not support the Node.js Prisma client. Resolution: all Prisma operations are confined to route handlers and server components, which run on the Node.js runtime. Middleware performs only lightweight cookie/auth checks.

### English Enforcement

Users writing in languages other than English contaminate character sheets and evaluation data. Resolution: the system prompt in every LLM call enforces English output. Tool descriptions include the instruction "All fields must be in English; translate any non-English input before saving." A dedicated plan (`2026-06-03-enforce-english.md`) documents the policy.

### PDF Upload via Agent SDK

`@openai/agents` does not natively handle `file` content type in messages. Resolution: `injectFilesFetch` patches the outbound request body before it is sent, appending file content to the last user message and adding `plugins: [{id: "file-parser", pdf: {engine: "native"}}]` for provider-side PDF parsing.

---

## 11. Feature Summary

### End-User Features (Web UI)

**Character library (`/library`).** Fuzzy search, sort, character cards with monogram fallback. Two-path import: manual multi-step wizard or AI-assisted research (Exa lookup → prefilled form). Soft delete (archive). Avatar pipeline: three resolutions (48/128/512), WebP conversion, Supabase Storage upload.

**AI assistant (`/chat`).** SSE streaming. Tool call results rendered as inline cards (character-card, show-card, conversation-panel, result-summary). Persistent sessions with auto-title. Attachment support (PDF via native provider parsing).

**Scene viewer (`/conversations/[id`).** Live screenplay rendering via SSE. Three-pane layout. Plutchik emotion dot with intensity (8 emotions: Joy, Trust, Fear, Surprise, Sadness, Disgust, Anger, Anticipation). Expandable per-turn reasoning. User can participate, stop, skip, or send a message mid-scene. Two turn strategies: Orchestrator (LLM-selected) and Round-robin.

**Usage dashboard (`/settings/usage`).** Period selector (today, 7 days, 30 days, all time). Token counts and estimated USD cost broken down by LLM usage source.

### Developer / Integration Features

**Claude plugin (`claude-plugin/`).** 9 slash-command skills, 2 agent definitions (`openormus.md`, `scene-director.md`), hooks for proactive behaviour. OAuth 2.0 with PKCE for frictionless connection from Claude Code.

**External MCP server.** Any MCP-compatible client can connect via OAuth2 and use all 9 tools. No vendor lock-in.

### Internal Production-Grade Features

**Concurrent persistence with row-level lock.** Correct `seq` ordering under parallel appends.

**Comprehensive LLM usage tracking.** Per-call granularity across 5 sources, with cost estimation, token breakdown, latency, and prompt hashing.

**Robust streaming.** Backpressure handling, clean cancellation via AbortSignal, partial message suppression on mid-turn cancel, client disconnect resilience.

**Schema-first validation.** Zod schemas as the sole type source; `safeParse` on every input boundary; tool input/output schemas identical between MCP and API routes.

**Evaluation pipeline.** Fully offline and reproducible. 16-character Vethara dataset with twin-pair precision test. Three scoring passes: guessing, reconstruction, and context drift. Field-level F1 with inter-judge agreement.
