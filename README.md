# OpenOrmus

A web app for creating fictional characters, simulating multi-character scenes, and evaluating LLM behavioural fidelity.

The core design is a **single tool registry** consumed by three channels simultaneously:

- **UI** — standard Next.js interface
- **AI assistant** — internal OpenAI SDK chat loop with tool access
- **MCP server** — external Model Context Protocol endpoint for agent clients

Two tracks: production chat (live SSE streaming) and evaluation (offline batch with a separate judge model).

---

## Architecture

| Workspace          | Purpose                                                   | Port |
| ------------------ | --------------------------------------------------------- | ---- |
| `frontend/`        | Next.js 16 app — App Router, Supabase Auth, Prisma client | 3000 |
| `mcp_server/`      | Express 5 MCP server — tool registry host                 | 3001 |
| `packages/shared/` | Zod schemas, tool registry types, prompt templates        | —    |
| `prisma/`          | Centralised `schema.prisma` + migrations                  | —    |

---

## Tech Stack

- **Runtime / package manager:** Bun ≥ 1.2
- **Frontend:** Next.js 16, React 19, Tailwind CSS 4, shadcn/ui
- **Database:** PostgreSQL 15+ (hosted on Supabase)
- **ORM:** Prisma 7.8 — schema at `prisma/schema.prisma`, consumed by both workspaces
- **Auth:** Supabase Auth (`@supabase/ssr`) for users; short-lived JWT for frontend → MCP calls
- **LLM:** OpenAI SDK pointed at any OpenAI-compatible provider via `LLM_BASE_URL`
- **MCP transport:** `StreamableHTTP` from `@modelcontextprotocol/sdk ^1.29`
- **Validation:** Zod — schemas defined once in `packages/shared/`, imported everywhere

---

## Prerequisites

| Tool          | Version | Notes                                   |
| ------------- | ------- | --------------------------------------- |
| Bun           | ≥ 1.2   | Primary package manager and runtime     |
| Node          | ≥ 20    | Required only for Prisma CLI migrations |
| PostgreSQL    | 15+     | Local instance or a Supabase project    |
| LLM provider  | any     | Any OpenAI-compatible API (e.g. Ollama, OpenRouter, OpenAI). Set `LLM_BASE_URL` + `LLM_API_KEY` in `.env.local` |

---

## Environment Variables

Create the root env file and symlink it into both workspaces:

```bash
cp .env.example .env.local
ln -sf ../.env.local frontend/.env.local
ln -sf ../.env.local mcp_server/.env.local
```

| Variable                               | Required    | Description                                                                                                           |
| -------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                         | Yes         | Pooled connection string (Transaction mode, port 6543) — used for runtime queries                                     |
| `DIRECT_URL`                           | Yes         | Direct connection string (no pooler, port 5432) — used by Prisma CLI for migrations                                   |
| `NEXT_PUBLIC_SUPABASE_URL`             | Yes         | Your Supabase project URL, e.g. `https://xxxx.supabase.co`                                                            |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes         | Supabase anon/publishable key (`sb_publishable_…`)                                                                    |
| `SUPABASE_SERVICE_ROLE_KEY`            | Yes         | Supabase service role key — server-side only, never expose to the client                                              |
| `NEXT_PUBLIC_SITE_URL`                 | Yes         | Base URL used in auth email links — `http://localhost:3000` for local dev                                             |
| `EXA_API_KEY`                          | No          | API key for Exa search (required only if search tools are enabled)                                                    |
| `MCP_PORT`                             | No          | MCP server port (default: `3001`)                                                                                     |
| `MCP_SERVER_URL`                       | No          | Full MCP endpoint URL (default: `http://localhost:3001/mcp`)                                                          |
| `MCP_PUBLIC_URL`                       | No          | Public-facing MCP base URL — used in OAuth discovery (default: `http://localhost:3001`)                               |
| `FRONTEND_INTERNAL_URL`                | No          | URL the MCP server uses to call frontend internal API routes (default: `http://localhost:3000`)                        |
| `MCP_AUTH_DISABLED`                    | No          | Set to `"true"` in local dev to skip JWT validation between frontend and MCP server                                   |
| `JWT_SECRET`                           | Conditional | Required when `MCP_AUTH_DISABLED` is not set. Signs the short-lived tokens issued by `/api/auth/tool-token`           |
| `LLM_BASE_URL`                         | Yes         | OpenAI-compatible provider URL, e.g. `http://localhost:11434/v1` (Ollama) or `https://openrouter.ai/api/v1`          |
| `LLM_API_KEY`                          | Yes         | API key for the provider at `LLM_BASE_URL`                                                                            |
| `CONVERSATION_MODEL`                   | Yes         | Model name passed directly to the provider, e.g. `gemini/gemini-2.5-flash-lite`                                      |
| `EVAL_ALLOWED_EMAILS`                  | No          | Comma-separated list of emails allowed to access the evaluation dashboard                                             |
| `EVAL_RESULTS_PATH`                    | No          | Absolute path to the directory where evaluation results are stored                                                    |

> **Note on `MCP_AUTH_DISABLED`:** When set to `"true"`, the MCP server accepts tool calls without a valid JWT. Never enable this in production.

---

## Setup

```bash
# 1. Install all workspace dependencies
bun install

# 2. Configure environment
cp .env.example .env.local
ln -sf ../.env.local frontend/.env.local
ln -sf ../.env.local mcp_server/.env.local
# Edit .env.local with your credentials (DATABASE_URL, DIRECT_URL, LLM_BASE_URL, …)

# 3. Run database migrations
bun run prisma:migrate:dev

# 4. Start both servers (frontend on :3000, MCP on :3001)
bun run dev
```

After setup, open [http://localhost:3000](http://localhost:3000).

---

## Commands

### Development

| Command       | Description                                                              |
| ------------- | ------------------------------------------------------------------------ |
| `bun run dev` | Start both the Next.js dev server (port 3000) and MCP server (port 3001) |

### Build & Production

| Command         | Description                               |
| --------------- | ----------------------------------------- |
| `bun run build` | Build the Next.js frontend for production                                    |
| `bun run start` | Start both the frontend and MCP server in production mode                    |

### Database (Prisma)

| Command                         | Description                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `bun run prisma:migrate:dev`    | Create and apply a new migration in development (prompts for a migration name) |
| `bun run prisma:migrate:deploy` | Apply pending migrations — use this in CI/CD and production                    |
| `bun run prisma:migrate:status` | Show which migrations have been applied and which are pending                  |
| `bun run prisma:generate`       | Regenerate the Prisma client after schema changes                              |
| `bun run prisma:studio`         | Open Prisma Studio (visual DB browser) at `http://localhost:5555`              |

### Type Checking

| Command                      | Description                                   |
| ---------------------------- | --------------------------------------------- |
| `bun run typecheck`          | Type-check all workspaces (frontend + shared) |
| `bun run typecheck:frontend` | Type-check the frontend only                  |
| `bun run typecheck:shared`   | Type-check the shared package only            |

---

## Evaluation

The offline evaluation pipeline measures LLM behavioural fidelity end-to-end across four sequential passes (generate → judge → reconstruct → drift). See [`evaluation/README.md`](evaluation/README.md) for the full reference.
