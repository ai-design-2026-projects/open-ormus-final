# OpenOrmus Claude Plugin — Design Spec

**Date:** 2026-06-05  
**Branch:** worktree-claude-plugin  
**Status:** Approved

---

## 1. Goal

Ship a Claude Code plugin that exposes the full OpenOrmus feature set (character management, show research, multi-character conversations, evaluation) to Claude Code and Claude desktop via MCP, secured by OAuth 2.0 browser login backed by Supabase.

---

## 2. Plugin Directory Structure

```
claude-plugin/                              ← repo root
├── .claude-plugin/
│   └── plugin.json                         ← manifest
├── .mcp.json                               ← remote HTTP MCP config, OAuth auto-discovered
├── settings.json                           ← { "agent": "openormus" }
├── skills/
│   ├── create-character/SKILL.md
│   ├── import-from-show/SKILL.md
│   ├── start-conversation/SKILL.md
│   ├── manage-characters/SKILL.md
│   ├── research-character/SKILL.md
│   ├── evaluate-conversation/SKILL.md
│   ├── generate-dataset/SKILL.md
│   ├── improve-context/SKILL.md
│   └── archive-character/SKILL.md
├── agents/
│   ├── openormus.md                        ← master agent (activated by settings.json)
│   └── scene-director.md                  ← subagent for conversation design
├── hooks/
│   └── hooks.json                          ← PreToolUse hook only
└── README.md
```

Plugin name: `openormus`. Skills namespaced as `/openormus:<skill>`.

---

## 3. Plugin Manifest

`.claude-plugin/plugin.json`:

```json
{
  "name": "openormus",
  "description": "Full OpenOrmus integration — create characters, simulate conversations, evaluate LLM fidelity",
  "version": "1.0.0",
  "author": {
    "name": "Davide Andreolli",
    "email": "davide@andreolli.dev"
  },
  "homepage": "https://github.com/andreolli-davide/open-ormus",
  "license": "MIT"
}
```

---

## 4. MCP Configuration

`.mcp.json`:

```json
{
  "mcpServers": {
    "openormus": {
      "type": "http",
      "url": "${OPENORMUS_URL:-http://localhost:3001}/mcp"
    }
  }
}
```

No explicit `oauth` block. Claude Code auto-discovers OAuth when MCP server returns `401 Unauthorized` with `WWW-Authenticate: Bearer resource_metadata="<FRONTEND_URL>/.well-known/oauth-protected-resource"`.

`OPENORMUS_URL` is set by the user to their deployed instance (e.g., `https://mcp.myapp.com`). Falls back to `localhost:3001` for local dev.

---

## 5. OAuth Flow (Approach B — Frontend owns auth)

### 5.1 Discovery Chain

```
Claude Code → POST /mcp → 401 WWW-Authenticate: Bearer resource_metadata=FRONTEND/.well-known/oauth-protected-resource
Claude Code → GET FRONTEND/.well-known/oauth-protected-resource → { authorization_servers: [FRONTEND] }
Claude Code → GET FRONTEND/.well-known/oauth-authorization-server → { authorization_endpoint, token_endpoint }
Claude Code → browser open authorization_endpoint?code_challenge=...&redirect_uri=localhost:PORT/callback&state=...
User logs in → Supabase callback → GET /api/oauth/callback
/api/oauth/callback → issues signed auth_code JWT, redirects to redirect_uri?code=...&state=...
Claude Code → POST /api/oauth/token { code, code_verifier } → { access_token }
Claude Code → uses access_token as Bearer for all MCP requests
```

### 5.2 New Frontend Routes

| Route | Method | Purpose |
|---|---|---|
| `/.well-known/oauth-protected-resource` | GET | RFC 9728 — points to frontend AS |
| `/.well-known/oauth-authorization-server` | GET | RFC 8414 — advertises endpoints |
| `/api/oauth/authorize` | GET | Starts Supabase PKCE login, passes through `redirect_uri`, `state`, `code_challenge` |
| `/api/oauth/callback` | GET | Supabase redirects here after login; exchanges Supabase code for session; issues auth_code JWT; redirects to Claude Code's `redirect_uri` |
| `/api/oauth/token` | POST | Exchanges auth_code JWT + code_verifier for MCP access token |

**Auth code design (stateless):** The authorization code is a short-lived HS256 JWT:
```json
{ "userId": "...", "type": "oauth_code", "code_challenge": "...", "iat": N, "exp": N+120 }
```
Signed with `JWT_SECRET`. The token endpoint validates signature, checks `type === "oauth_code"`, verifies `code_verifier` against stored `code_challenge` (SHA-256), then calls `generateToolToken(userId)` to issue the MCP access token. No DB required.

### 5.3 MCP Server Discovery Endpoints

Two new unauthenticated routes in `mcp_server/src/index.ts`:

**`GET /.well-known/oauth-protected-resource`** (RFC 9728):
```json
{
  "resource": "https://<OPENORMUS_URL>/mcp",
  "authorization_servers": ["<FRONTEND_URL>"]
}
```

**`GET /.well-known/oauth-authorization-server`** (RFC 8414) — not served by MCP server; served by Next.js at `FRONTEND_URL/.well-known/oauth-authorization-server`.

`FRONTEND_URL` comes from env var `NEXT_PUBLIC_SITE_URL` (already used by Supabase).

### 5.4 MCP Server Auth Change

Current: validates custom JWT issued by `/api/auth/tool-token`.  
No change needed — `generateToolToken` is already used; OAuth token endpoint calls the same function. MCP server keeps validating Bearer JWTs signed with `JWT_SECRET`.

---

## 6. Skills

Each `SKILL.md` has frontmatter `description:` (for Claude auto-invocation) and body instructions. All reference MCP tools by their registered IDs.

**Anti-polling rule (enforced in every skill and agent that touches conversations):** `conversation_job_status` must NOT be called automatically after `conversation_start`. It must only be called when the user explicitly asks for a status update or the final messages. The UI streams live progress; polling is redundant and wastes tool calls.

| Skill | MCP tools used | Key behavior |
|---|---|---|
| `create-character` | `character_create`, `character_research` | Gather all required fields before calling create; offer to research first |
| `import-from-show` | `show_research`, `character_research`, `character_create` | Batch import all main characters from a franchise |
| `start-conversation` | `conversation_start` | Design scene context, pick strategy, set turn count; after calling `conversation_start` stop — do NOT follow up with `conversation_job_status` |
| `manage-characters` | `character_list`, `character_find`, `character_update`, `character_delete` | CRUD operations with ID resolution |
| `research-character` | `character_research` | Preview character profile without saving |
| `evaluate-conversation` | `conversation_job_status` (fetch messages), then judge offline | Retrieve completed conversation messages, run structured evaluation |
| `generate-dataset` | `character_list`, `conversation_job_status` | Pull conversations from DB, format as eval dataset |
| `improve-context` | _(none)_ | Pure LLM skill — guides user to write better scene context through structured questions; no tool call |
| `archive-character` | `character_archive` | Soft-delete with confirmation |

---

## 7. Agents

### `openormus` (master agent)
- Activated by `settings.json` as default agent when plugin is enabled
- System prompt: knows all OpenOrmus MCP tools, their IDs, and when to use them
- Guides users through character creation → conversation → evaluation pipeline
- Delegates complex conversation design to `scene-director` subagent
- **Hard rule in system prompt:** never call `conversation_job_status` unless the user's message explicitly asks for job status or completed messages

### `scene-director` (subagent)
- Specialized for designing multi-character scenes
- Knows ORCHESTRATOR vs ROUND_ROBIN tradeoffs
- Suggests character combinations, context framing, turn count
- Invoked by `openormus` agent or user via `/openormus:start-conversation`

---

## 8. Hooks

`hooks/hooks.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "character_delete",
        "hooks": [{
          "type": "command",
          "command": "jq -r '\"Delete character \" + .tool_input.id + \"? This is permanent. Reply yes to confirm.\"'"
        }]
      }
    ]
  }
}
```

---

## 9. Settings

`settings.json`:

```json
{
  "agent": "openormus"
}
```

Activates the `openormus` master agent as the default Claude Code agent when the plugin is enabled.

---

## 10. New Env Vars Required

| Var | Where | Purpose |
|---|---|---|
| `OPENORMUS_URL` | user shell / plugin env | MCP server base URL (default `http://localhost:3001`) |
| `NEXT_PUBLIC_SITE_URL` | `.env.local` | Frontend base URL for OAuth discovery responses |

`NEXT_PUBLIC_SITE_URL` is likely already set (Supabase requires it for redirect URLs).

---

## 11. Files Changed / Created

### New (plugin)
- `claude-plugin/**` (entire directory)

### New (frontend)
- `frontend/app/.well-known/oauth-protected-resource/route.ts`
- `frontend/app/.well-known/oauth-authorization-server/route.ts`
- `frontend/app/api/oauth/authorize/route.ts`
- `frontend/app/api/oauth/callback/route.ts`
- `frontend/app/api/oauth/token/route.ts`

### New (MCP server)
- `GET /.well-known/oauth-protected-resource` in `mcp_server/src/index.ts`

---

## 12. Out of Scope

- Token refresh (access tokens are 5-min JWTs; Claude Code re-authenticates when expired)
- Plugin marketplace submission (separate step after shipping)
- Evaluation judge integration as a real-time MCP tool (judge runs offline batch; skill fetches completed messages only)
