# OpenOrmus — Claude Code

@AGENTS.md

## Think Before Coding

- State assumptions explicitly. If uncertain, ask before implementing.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so and push back.
- If something is unclear, name what's confusing and ask.

## Surgical Changes

Every changed line must trace back to the request.

- Don't improve adjacent code, comments, or formatting.
- Don't refactor code that isn't broken.
- Match existing style even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

## Goal-Driven Execution

For multi-step tasks, state a brief plan before acting:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
```

Don't start implementing until the plan is confirmed.

## Context Engineering

- Use the Explore subagent for codebase searches that span > 3 queries — keep main context clean.
- `context7` MCP is available: use it for Next.js, Prisma, Supabase,
  and `@modelcontextprotocol/sdk` docs in preference to web search.
- Use Plan mode by default for any change touching: auth flow, MCP transport, tool registry,
  or Prisma schema — these are load-bearing and hard to reverse.

## Communication

- Language: **English** — responses, code, commits.
- Lead with the answer (BLUF). Reasoning and context only if needed.
- No preamble. Never open with "Sure!", "Happy to help", or any variant.
- No sign-off. Don't restate what you just did at the end of a response.
- Progress updates: one sentence max. What changed and what's next.
- No filler: "It's worth noting", "In conclusion", "As mentioned" → cut.

## Verification

- Never claim something works without running it. Show the output.
- No silent TODOs. If leaving something unimplemented, say so explicitly before finishing.

## Context

- When context compacts, the summary must preserve: list of modified files,
  any open decisions, and the current task's next step.

## Prompt Library

All LLM-facing text must live in dedicated prompt files — never inline in business logic:

- `packages/shared/conversation/prompts/` — shared conversation prompts (character system prompt, orchestrator, scene start, continue instruction)
- `evaluation/<pass>/prompt.ts` — evaluation pass prompts (one per pass: judge, reconstruct, drift)
- `frontend/lib/agent/prompt.ts` — agent assistant prompt

**What counts as a prompt:** system prompt strings, user message templates, instruction text shown to the LLM, scene cue strings. If it's a string that an LLM will read, it belongs in a prompt file.

## Never (Claude Code specifics)

- Don't run `bun add <pkg>` without explicit approval — see `AGENTS.md §10`.
- Don't silently auto-fix lint errors as a side effect of another change — surface them.
- Don't push to `main` or `develop` without explicit confirmation.
- Don't add a `Co-Authored-By: Claude` trailer to commits.
