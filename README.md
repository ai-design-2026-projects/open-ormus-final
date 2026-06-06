# OpenOrmus

A web app for creating fictional characters, simulating multi-character scenes, and evaluating LLM behavioural fidelity.

The core design is a **single tool registry** consumed by three channels simultaneously:

- **UI** — standard Next.js interface
- **AI assistant** — internal Claude Agent SDK loop with tool access
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

Create the root env file and symlink it into `frontend/` (both workspaces read from the same file):

```bash
cp .env.example .env.local
ln -sf ../.env.local frontend/.env.local
```

| Variable                               | Required    | Description                                                                                                           |
| -------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                         | Yes         | PostgreSQL connection string — Supabase format: `postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres` |
| `NEXT_PUBLIC_SUPABASE_URL`             | Yes         | Your Supabase project URL, e.g. `https://xxxx.supabase.co`                                                            |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes         | Supabase anon/publishable key (`sb_publishable_…`)                                                                    |
| `NEXT_PUBLIC_SITE_URL`                 | Yes         | Base URL used in auth email links — `http://localhost:3000` for local dev                                             |
| `MCP_PORT`                             | No          | MCP server port (default: `3001`)                                                                                     |
| `MCP_AUTH_DISABLED`                    | No          | Set to `"true"` in local dev to skip JWT validation between frontend and MCP server                                   |
| `JWT_SECRET`                           | Conditional | Required when `MCP_AUTH_DISABLED` is not set. Signs the short-lived tokens issued by `/api/auth/tool-token`           |
| `LLM_BASE_URL`                         | Yes         | OpenAI-compatible provider URL, e.g. `http://localhost:11434/v1` (Ollama) or `https://openrouter.ai/api/v1`          |
| `LLM_API_KEY`                          | Yes         | API key for the provider at `LLM_BASE_URL`                                                                            |
| `CONVERSATION_MODEL`                   | Yes         | Model name passed directly to the provider, e.g. `gemini/gemini-2.5-flash-lite`                                      |

> **Note on `MCP_AUTH_DISABLED`:** When set to `"true"`, the MCP server accepts tool calls without a valid JWT. Never enable this in production.

---

## Setup

```bash
# 1. Install all workspace dependencies
bun install

# 2. Configure environment
cp .env.example .env.local
ln -sf ../.env.local frontend/.env.local
# Edit .env.local with your Supabase credentials and DATABASE_URL

# 3. Run database migrations
bun run prisma:migrate:dev

# 4. Start the frontend (Next.js on :3000) — separate terminal
bun run dev:frontend

# 5. Start the MCP server (Express on :3001) — separate terminal
bun run dev:mcp
```

After setup, open [http://localhost:3000](http://localhost:3000).

---

## Commands

### Development

| Command                | Description                                               |
| ---------------------- | --------------------------------------------------------- |
| `bun run dev:frontend` | Start the Next.js dev server on port 3000 with hot reload |
| `bun run dev:mcp`      | Start the MCP server on port 3001 with watch mode         |

### Build & Production

| Command         | Description                               |
| --------------- | ----------------------------------------- |
| `bun run build` | Build the Next.js frontend for production |
| `bun run start` | Start the production Next.js server       |

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
