# LiteLLM Deprecation — Design Spec

**Date:** 2026-05-27
**Branch:** worktree-litellm-deprecation

## Goal

Remove the LiteLLM proxy and replace all LLM call sites with the OpenAI SDK pointed directly at an OpenAI-compatible provider URL. Remove `@anthropic-ai/sdk` entirely.

## Approach

Shared client factory (Option A): one `createLLMClient()` helper exports an `OpenAI` instance. All call sites import it. No inline client construction.

## Env Vars

| Old | New | Notes |
|---|---|---|
| `ANTHROPIC_BASE_URL` | `LLM_BASE_URL` | Direct OpenAI-compat provider URL |
| `ANTHROPIC_API_KEY` | `LLM_API_KEY` | Provider API key |
| `CONVERSATION_MODEL` | `CONVERSATION_MODEL` | Unchanged |

Files deleted: `litellm_config.yaml`, `litellm.env.example`, `litellm.env.local` (gitignored), `scripts/dev-llm.sh`. `dev:llm` script removed from root `package.json`.

## New File

**`frontend/lib/llm-client.ts`**

```ts
import OpenAI from "openai";

export function createLLMClient(): OpenAI {
  return new OpenAI({
    baseURL: process.env["LLM_BASE_URL"] ?? "http://localhost:11434/v1",
    apiKey: process.env["LLM_API_KEY"] ?? "local",
  });
}
```

## Call-Site Changes

### `frontend/lib/agent/loop.ts`
- Replace `new OpenAI({ baseURL, apiKey })` with `createLLMClient()`.

### `frontend/lib/conversation/next.ts`
- Replace `new OpenAI({ baseURL, apiKey })` with `createLLMClient()`.

### `frontend/app/api/chat/stream/route.ts` — `autoTitle`
- Remove `import Anthropic`.
- Replace `client.messages.create({ system, messages })` with `client.chat.completions.create({ messages: [{ role: "system", content: system }, { role: "user", content: firstMessage }] })`.
- Read result from `response.choices[0]?.message.content`.

### `frontend/app/api/conversations/improve-context/route.ts`
- Remove `import Anthropic`.
- Same pattern as autoTitle: system + user messages array, read `choices[0].message.content`.

### `frontend/lib/orchestrator.ts`
- Remove raw `fetch` to `/v1/messages`.
- Use `createLLMClient().chat.completions.create()` with same message array shape.
- Remove Anthropic-specific headers (`anthropic-version`, `x-api-key`).

### `frontend/lib/agent/mcp_bridge.ts`, `exa_research.ts`, `wizard.ts`
- Replace `import type { Tool } from "@anthropic-ai/sdk/resources/messages"` with `import type { ChatCompletionTool } from "openai/resources/chat/completions"`.

## Dependency Change

```
frontend/package.json: remove "@anthropic-ai/sdk"
```

## Error Handling

No changes to existing error handling logic at any call site.

## Verification

1. `bun run typecheck` — catches missed type migrations
2. `bun run build` — confirms no import errors
3. `bun test --cwd mcp_server` — confirms mcp_server unaffected
4. Manual smoke: chat stream, autoTitle, improve-context all function
