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
- `context7` MCP is available: use it for Next.js, Prisma, Supabase, Claude Agent SDK,
  and `@modelcontextprotocol/sdk` docs in preference to web search.
- Use Plan mode by default for any change touching: auth flow, MCP transport, tool registry,
  or Prisma schema — these are load-bearing and hard to reverse.

## Never (Claude Code specifics)

- Don't run `bun add <pkg>` without explicit approval — see `AGENTS.md §10`.
- Don't silently auto-fix lint errors as a side effect of another change — surface them.
- Don't push to `main` or `develop` without explicit confirmation.
- Don't add a `Co-Authored-By: Claude` trailer to commits.
