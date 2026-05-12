# MCP Server Setup — Design Spec

**Date:** 2026-05-12  
**Branch:** feature/mcp-setup  
**Status:** Approved

---

## Overview

Wire up the `mcp_server` package from its bare Express skeleton into a fully functional MCP server.
Exposes two transports (StreamableHTTP + SSE) and three domain-stub tools demonstrating the
tool registry pattern the full product will use. No real DB calls — stubs use in-memory state.

---

## Goals

- Install `@modelcontextprotocol/sdk` in `mcp_server`
- Define Zod schemas for character and scene domains in `packages/shared/schema/`
- Implement three tool stubs: `character_create`, `character_get`, `scene_simulate`
- Expose both StreamableHTTP (`POST /mcp`) and SSE (`GET /mcp/sse`, `POST /mcp/messages`)
- Add auth middleware stub with `MCP_AUTH_DISABLED=true` dev bypass
- Keep `index.ts` under 150 lines (AGENTS.md §10)

---

## File Structure

```
mcp_server/src/
  index.ts                      # Express app, mounts middleware + routes (~50 lines)
  auth/
    middleware.ts               # JWT stub; passthrough when MCP_AUTH_DISABLED=true
  transport/
    streamable-http.ts          # POST /mcp — StreamableHTTP session map
    sse.ts                      # GET /mcp/sse + POST /mcp/messages — SSE session map
  registry/
    registry.ts                 # McpServer instance, registers all tools
    tools/
      character_create.ts
      character_get.ts
      scene_simulate.ts

packages/shared/
  schema/
    character.ts                # Zod schemas: CharacterCreateInput, CharacterRecord
    scene.ts                    # Zod schemas: SceneSimulateInput, SceneResult
  types.ts                      # Inferred TS types (re-exported from schemas)
  index.ts                      # Re-exports everything
```

---

## Dependencies

| Package | Where | Action |
|---|---|---|
| `@modelcontextprotocol/sdk` | `mcp_server` | `bun add` |

No other new deps. `jsonwebtoken` already present for future JWT validation.

---

## Transport Layer

### StreamableHTTP — `POST /mcp`

- Session map: `Map<string, StreamableHTTPServerTransport>` keyed by `mcp-session-id` header
- New transport created only when `isInitializeRequest(body)` is true
- Reuse existing session otherwise; return 400 if session missing and body is not init
- Clean up session on `transport.onclose`

### SSE — `GET /mcp/sse` + `POST /mcp/messages`

- `GET /mcp/sse`: creates `SSEServerTransport`, stores in separate session map, begins SSE stream
- `POST /mcp/messages`: looks up session by `mcp-session-id`, routes message to transport
- Return 404 if session not found

Both transports connect to the **same `McpServer` instance** from `registry.ts`.

---

## Tool Registry

Tool IDs follow pattern `mcp__openormus__<tool_name>` (AGENTS.md §6 MCP Server).  
All handlers return: `{ content: [{ type: "text", text: JSON.stringify(result) }] }`.

### `mcp__openormus__character_create`

```
Input:  { name: string, description: string, traits: string[] }
Output: { id: string, name: string, description: string, traits: string[], createdAt: string }
```

Stub behaviour: generates UUID via `crypto.randomUUID()`, stores in in-memory `Map`, returns record.

### `mcp__openormus__character_get`

```
Input:  { id: string }
Output: { id, name, description, traits, createdAt } | { error: "not_found" }
```

Stub behaviour: looks up id in shared in-memory `Map` (same instance as `character_create`).
Pre-seeded with 2 fixture characters on server start.

### `mcp__openormus__scene_simulate`

```
Input:  { characterIds: string[], setting: string, prompt: string }
Output: { sceneId: string, setting: string, prompt: string, dialogue: Array<{ characterId: string, line: string }> }
```

Stub behaviour: round-robins `characterIds`, generates canned dialogue lines. No LLM call.
Returns `{ error: "character_not_found", id }` if any `characterId` is unknown.

---

## Auth Middleware

Location: `src/auth/middleware.ts`  
Applied before all transport routes in `index.ts`.

```
if MCP_AUTH_DISABLED === "true":
  req.userId = "dev-user"   // placeholder
  next()
else:
  validate Authorization: Bearer <token>
  verify JWT with JWT_SECRET
  req.userId = payload.userId
  return 401 if missing or invalid
```

**TODO (M3-04):** Replace stub with real validation once `frontend /api/auth/tool-token` lands.  
`userId` extracted here is the **only** trusted tenancy source — tools must not read it from args.

---

## Env Variables

```bash
PORT=3001
MCP_AUTH_DISABLED=true       # dev only — remove in production
JWT_SECRET=<secret>          # required when MCP_AUTH_DISABLED is unset
```

---

## Zod Schema Boundaries

- Schemas defined once in `packages/shared/schema/` (Zod v4 — matches shared package)
- `mcp_server` imports schemas from `@open-ormus/shared` — does NOT redefine them
- Known drift: `mcp_server` has Zod v3, `packages/shared` has Zod v4.
  Schemas consumed by tools must use the shared package's export, not `mcp_server`'s own Zod.
  Resolution tracked in AGENTS.md §11 (before M3-05).

---

## Out of Scope

- Real Prisma queries (schema empty, lands in M1-02)
- LLM calls in `scene_simulate` (lands after M3-01)
- Frontend JWT token endpoint (lands in M3-04)
- Production JWT enforcement (lands after M3-04)
