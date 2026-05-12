# AGENTS.md — OpenOrmus

## 1. Project Overview

OpenOrmus is a web app for creating fictional characters, simulating multi-character scenes, and
evaluating LLM behavioural fidelity. The central design is a **single tool registry** consumed by
three channels: traditional UI, an internal AI assistant (Claude Agent SDK loop), and an external
MCP server. Two-track architecture: production chat (live SSE) and evaluation (offline batch,
separate judge model). Source of truth for product behaviour is `PROJECT_EN.md`.

---

## 2. Repository Layout

```
frontend/           Next.js 16 — App Router, Supabase Auth, Prisma client, shadcn/ui
mcp_server/         Express 5 MCP server (port 3001) — tool registry host
packages/shared/    Zod schemas, tool registry types, prompt templates (shared by all)
prisma/             Centralised schema.prisma + migrations (no models yet — see §11)
.env.example        Required env vars — copy to .env.local before starting
PROJECT_EN.md       Product spec: vision, features, data model, evaluation framework
TECH_STACK_EN.md    Stack rationale and ADRs (known drift — see §11)
DEVELOPMENT_PLAN.md 4-week sprint, milestone table, Davide / Leonardo split
```

---

## 3. Development Setup

**Required tools**

- **Bun ≥ 1.2** — package manager and runtime (`bun install`, `bun run`)
- **Node ≥ 20** — needed only by tooling that has no Bun binary (Prisma CLI migrations)
- **PostgreSQL 15+** locally, or a Supabase project with `DATABASE_URL` set
- **LiteLLM proxy on `http://localhost:4000`** — runs *outside* this repo (see §7); the Claude
  Agent SDK routes every LLM call through it via `ANTHROPIC_BASE_URL`

**Bootstrap**

```bash
bun install                                    # install all workspaces
cp .env.example .env.local                     # fill in your values
bun run --cwd frontend prisma migrate dev      # run DB migrations
bun run dev:frontend                           # start Next.js on :3000
bun run --cwd mcp_server dev                   # start MCP server on :3001
```

---

## 4. Development Commands

| Goal | Command (run from repo root) |
| ---- | ---- |
| Frontend dev server | `bun run dev:frontend` |
| MCP server dev (watch) | `bun run --cwd mcp_server dev` |
| Build frontend | `bun run build` |
| Prisma migrate (dev) | `bun run --cwd frontend prisma migrate dev` |
| Prisma generate client | `bun run --cwd frontend prisma generate` |
| Type-check frontend | `bun run --cwd frontend tsc --noEmit` |
| Type-check shared | `bun run --cwd packages/shared tsc --noEmit` |

No test runner is wired up yet. Add commands here when they land.

---

## 5. Architecture & Boundaries

```
                   packages/shared/     ← single source of truth for types, schemas, tool defs
                      ▲      ▲      ▲
        frontend ─────┘      │      └────── mcp_server
        (Next.js)            │              (Express + MCP SDK)
                    /api/chat/stream
                  (Claude Agent SDK loop)
                     │
                     └──► POST http://localhost:3001/mcp  (JWT-authed tool calls)
```

**Hard rules**

- `mcp_server/**` must not import from `frontend/**`, and vice versa.
- Tool input/output types live **only** in `packages/shared/` — both sides import from there.
- `prisma/schema.prisma` is the single schema file. Both workspaces point to it; neither owns it
  independently.
- All Prisma queries must be scoped by `userId` — even when Supabase RLS is active (belt-and-braces).
- **Production track** (chat streaming) and **evaluation track** (offline batch) must not share
  runtime state. They share DB tables and shared types, nothing else.

---

## 6. Stack Conventions

### TypeScript
- Config baseline: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` — do not weaken.
- No `any`. Use `unknown` + Zod `.parse()` at every external boundary (API input, LLM output,
  DB JSON columns).
- Types are generated from Zod schemas in `packages/shared/schema/` — do not write duplicate
  hand-typed interfaces.

### Next.js 16 — App Router
- HTTP endpoints: `app/api/**/route.ts`. SSE: `ReadableStream` inside a `Response`.
- Supabase client **must** be instantiated through `lib/supabase/server.ts` (server components,
  route handlers) or `lib/supabase/client.ts` (client components). Never call
  `createServerClient` / `createBrowserClient` inline.

### Supabase Auth
- Server-side auth: `supabase.auth.getUser()` — **not** `getSession()`. `getSession()` reads the
  cookie without revalidating against the server and must not be trusted for security decisions.
- Every protected route handler starts with the user check:
  ```ts
  const { data: { user }, error } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  ```

### Prisma 7
- Schema path: `prisma/schema.prisma` (root). Frontend `package.json` already overrides this.
- Singleton client: `lib/prisma.ts` (frontend), `src/db.ts` (mcp_server). Never `new PrismaClient()` ad hoc.
- `Character.sheet` is JSONB (`Json` type in Prisma) — do not normalise it into relational columns.

### LLM — Claude Agent SDK + LiteLLM
- SDK connects to LiteLLM: `ANTHROPIC_BASE_URL=http://localhost:4000`.
  `ANTHROPIC_API_KEY` is the LiteLLM master key, not a direct Anthropic key.
- **Never hardcode a model name** — pass model as an argument; LiteLLM config decides routing.
  Production chat → one model; eval judge → a separate low-RLHF model (see `PROJECT_EN.md §6.7`).
- Every LLM call must be logged: `model`, `prompt_hash`, `temperature_ms`, `latency_ms`, `userId`.

### MCP Server
- Transport: `StreamableHTTP` from `@modelcontextprotocol/sdk@^1.29`.
- Session map keyed by `mcp-session-id` header. Create a new session only when
  `isInitializeRequest(body)` is true; reuse otherwise.
- Every tool returns: `{ content: [{ type: "text", text: JSON.stringify(result) }] }`.
  Returning a plain object is a silent protocol violation.
- Tool IDs follow the pattern `mcp__openormus__<tool_name>` exactly. This string is also used
  in `allowedTools` on the agent side — a mismatch silently disables the tool.

### JWT (frontend ↔ mcp_server auth)
- `frontend /api/auth/tool-token` issues a JWT (max 5 min), payload `{ userId, exp }`,
  signed with `JWT_SECRET`.
- `mcp_server` validates the JWT on every request. `userId` extracted from the token is the
  **only** trusted tenancy source — never read it from the tool arguments.

### Zod
- A single major version must be used across all workspaces. Currently mismatched (`packages/shared`
  v4, `mcp_server` v3) — see §11. Resolve before shared schemas are consumed in tools.
- Schemas are defined once in `packages/shared/schema/`, exported as Zod objects + inferred types.
  Both API validation (frontend) and MCP tool validation (mcp_server) import from there.

---

## 7. External Services (not managed by this repo)

**LiteLLM proxy**
Runs at `http://localhost:4000` and is *not* part of this repo. It accepts requests in Anthropic
API shape and routes them to the configured provider by model name. The Claude Agent SDK sends all
LLM traffic here via `ANTHROPIC_BASE_URL`. If LiteLLM is unavailable the agent loop must fail fast
with a clear error — no silent retries that bill the wrong provider.

**Supabase**
PostgreSQL + Auth + (optionally) Storage. The repo stores only connection strings in `.env.local`.
Row Level Security policies live in Supabase, not in this repo.

---

## 8. Debug / Observability

Each long-running operation (chat session, eval run, character import) writes a structured log to:

```
debug/{component}/{YYYYMMDD_HHMMSS_<uuid>}_log.json
```

Minimum fields: `session_id`, `userId`, `component`, `event`, `timestamp`. If the log write fails,
log the failure to `stderr` — never swallow it silently.

---

## 9. Commit & PR Conventions

- Language: **English** (code and commits).
- Format: Conventional Commits — `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`.
- One commit per logical change. No squash-everything-at-the-end PRs.
- No `Co-Authored-By:` trailers.
- Ask for explicit confirmation before pushing to `main` or `develop`.

---

## 10. Do Not

| Don't | Do instead |
| ---- | ---- |
| Add a new dependency without asking | State the alternative and rationale; wait for approval |
| Hardcode a model name in source (`"claude-opus-4-7"`) | Accept model as an argument; LiteLLM routes it |
| Hardcode MCP tool IDs as string literals in `allowedTools` | Derive from the shared registry: `toolIds(toolRegistry)` |
| Import Prisma in Next.js middleware (runs on Edge runtime) | Keep all Prisma in Node-runtime route handlers / Server Components |
| Call `supabase.auth.getSession()` server-side | Use `supabase.auth.getUser()` — see §6 Supabase Auth |
| Add a new MCP tool without first updating `packages/shared/schema/` | Schema-first: add Zod schema → infer types → implement handler |
| Grow `mcp_server/src/index.ts` past ~150 lines | Extract to `src/transport/`, `src/auth/`, `src/registry/` |
| Refactor code adjacent to the requested change | Surgical changes only; mention unrelated issues but don't touch them |
| Introduce a pattern not in `PROJECT_EN.md` (event bus, CQRS, …) | Surface the gap as a question; do not invent |
| Push to `main` / `develop` without confirmation | Always ask first |

---

## 11. Known Drift (code ≠ spec — do not treat as bugs to fix silently)

| Spec says | Code has | Status |
| ---- | ---- | ---- |
| NextAuth (TECH_STACK_EN.md) | `@supabase/ssr` + Supabase Auth | Doc-only PR needed |
| Prisma 5, Next.js 14 (TECH_STACK_EN.md) | Prisma 7.8, Next.js 16.2.6 | Doc-only PR needed |
| `packages/shared` zod v4, `mcp_server` zod v3 | Workspace mismatch | Must converge before M3-05 |
| Prisma models (PROJECT_EN.md §7) | schema.prisma is datasource-only | Lands in M1-02 |
| `@anthropic-ai/claude-agent-sdk`, `@modelcontextprotocol/sdk` | Not yet installed | M3-01 / M3-04 |
| OPENROUTER_API_KEY in .env.example | LiteLLM replaces OpenRouter direct | .env.example update needed |

---

## 12. References

- `PROJECT_EN.md` — product spec (vision, features, data model, evaluation framework)
- `DEVELOPMENT_PLAN.md` — 4-week sprint plan and milestone ownership
- `TECH_STACK_EN.md` — stack rationale and ADRs (note: known drift, see §11)
