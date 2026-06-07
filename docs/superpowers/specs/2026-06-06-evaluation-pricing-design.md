# Evaluation Pricing — Design Spec

**Date:** 2026-06-06  
**Status:** Approved

---

## Goal

Track the cost of every LLM call made during evaluation passes and dataset generation. Store costs in YAML files alongside existing results. Display a breakdown in a new "Costs" tab in the evaluation page.

No DB changes. No slowdown to eval runs.

---

## Scope

- Post-run cost tracking for all 4 passes: Generation, Judge Guessing, Reconstruction, Drift
- Cost fetched from OpenRouter after each pass completes (async, separate step)
- Frontend "Costs" tab with hierarchical breakdown: pass → role/model → conversation → segment
- Pre-run estimate: **deferred** (out of scope for this iteration)

---

## Data Model

One YAML file per pass, written to:

```
evaluation/results/<dataset>/<evalName>/costs/
  generation.yaml
  judge_guessing.yaml
  reconstruct_persona.yaml
  context_drift.yaml
```

Each file contains an array of `CostRecord`:

```yaml
records:
  - conversationId: conv_001
    segmentIdx: null          # null for generation and judge_guessing
    role: character           # character | orchestrator | judge | reconstructor | comparator
    model: openai/gpt-4o-mini
    generationId: gen-abc123  # OpenRouter ID used to fetch costUsd
    inputTokens: 1200
    outputTokens: 340
    reasoningTokens: null
    cachedTokens: null
    costUsd: 0.00042          # null until post-pass fetch
    latencyMs: 1234
```

---

## New Module: `evaluation/cost/`

### `types.ts`

Defines `CostRecord` and `CostMeta` (the usage data returned by each call site before writing).

### `tracker.ts`

`CostTracker` class:
- `record(meta: CostMeta): void` — accumulates records in memory
- `flush(outputPath: string): Promise<void>` — writes YAML file

### `fetcher.ts`

`fetchPassCosts(yamlPath: string): Promise<void>`:
- Reads the YAML
- For each record where `costUsd` is null, queries `https://openrouter.ai/api/v1/generation?id={generationId}` with exponential retry (3s → 6s → 12s), same pattern as `frontend/lib/llm-usage.ts`
- Rewrites the YAML with fetched costs

---

## Call Site Instrumentation

All 6 LLM call sites are modified to return usage metadata alongside their existing result. The pass orchestration layer handles recording to the tracker — no tracker dependency in shared code.

| File | Function | Role | Notes |
|---|---|---|---|
| `evaluation/judge/call.ts` | `callJudge` | judge | non-streaming; add `response.id` + `response.usage` extraction |
| `evaluation/reconstruct/call.ts` | `callReconstructor` | reconstructor | non-streaming |
| `evaluation/reconstruct/call.ts` | `callComparator` | comparator | non-streaming |
| `evaluation/drift/call.ts` | `callJudge` | judge | non-streaming |
| `packages/shared/conversation/turn.ts` | `generateTurn` | character | streaming; add `stream_options: { include_usage: true }`, capture final chunk usage + first chunk id |
| `packages/shared/conversation/orchestrator.ts` | `selectNextSpeakerWithOrchestrator` | orchestrator | non-streaming |

Return signature pattern (non-streaming):
```ts
// before
return { assignments }
// after
return { assignments, usage: CostMeta | null }
```

For `generateTurn` (streaming):
```ts
// before
return turn: TurnMessage
// after
return { turn: TurnMessage, usage: CostMeta | null }
```

Callers that don't need cost destructure only `turn` and ignore `usage`. This is a **breaking change** to `generateTurn`'s return type — the production caller in `frontend/lib/conversation/next.ts` must be updated to destructure `{ turn }` instead of using the result directly, but can discard `usage` since production cost tracking runs separately via `logLlmUsage`.

---

## Pass Integration

Each CLI entry point gets this pattern at the end:

```ts
await tracker.flush(costsPath)
await fetchPassCosts(costsPath)
```

The tracker is instantiated at the start of each pass and passed down to the orchestration layer (`runJudges`, `runReconstructionForConversation`, `runDriftForConversation`, `runConversation`). Each orchestration function calls `tracker.record(usage)` after every LLM call.

---

## Frontend

### API Route

`GET /api/evaluation/[dataset]/[evalName]/costs`

Reads the 4 cost YAMLs and returns an aggregated JSON tree:

```ts
// TokenStats — reused throughout
type TokenStats = { inputTokens: number; outputTokens: number; costUsd: number | null }

{
  passes: {
    generation: {
      totalCostUsd: number | null,
      totalInputTokens: number,
      totalOutputTokens: number,
      byRole: { character: TokenStats, orchestrator: TokenStats },
      byConversation: ConversationCost[]
    },
    judge_guessing: {
      totalCostUsd: number | null,
      byModel: Record<string, TokenStats>,
      byConversation: ConversationCost[]
    },
    reconstruct_persona: {
      totalCostUsd: number | null,
      byRole: { reconstructor: TokenStats, comparator: TokenStats },
      byConversation: ConversationCost[]  // each has segmentBreakdown
    },
    context_drift: {
      totalCostUsd: number | null,
      byRole: { judge: TokenStats },
      byConversation: ConversationCost[]  // each has segmentBreakdown
    }
  },
  grandTotal: {
    costUsd: number | null,
    inputTokens: number,
    outputTokens: number
  }
}
```

Returns 404 if no cost files exist yet (pass not run).

### Costs Tab

New tab "Costs" in `frontend/app/evaluation/page.tsx`. Component at `frontend/app/evaluation/_components/costs-tab.tsx`. Same pattern as other tabs: `"use client"`, `useEffect` fetch on `[dataset, evalName]`, loading/error states.

**Layout — collapsible rows:**

```
Grand Total: $0.42 · 1.2M in · 340k out

▶ Generation           $0.12 · 800k in · 120k out
▶ Judge Guessing       $0.08 · 200k in · 80k out
▶ Reconstruction       $0.18 · 150k in · 100k out
▶ Drift                $0.04 · 50k in · 40k out
```

Expanding a pass shows:
- **Generation / Drift / Reconstruction**: role breakdown (character, orchestrator, reconstructor, comparator, judge) then per-conversation rows
- **Judge Guessing**: model breakdown then per-conversation rows
- **Reconstruction / Drift conversations**: further expandable to segment-level rows

```
▼ Reconstruction       $0.18
    reconstructor       $0.12
    comparator          $0.06
    ▼ conv_001          $0.009
        segment 0 — reconstructor $0.002 · comparator $0.001
        segment 1 — reconstructor $0.002 · comparator $0.001
```

- `costUsd` null → shows `—`
- Pass not yet run (no YAML file) → pass row shows "not run"

---

## Error Handling

- If OpenRouter cost fetch fails after all retries: leave `costUsd: null`, log warning to stderr. Tab shows `—`.
- If cost YAML does not exist for a pass: API returns partial result with that pass absent.
- If `response.usage` is null on a call site: record tokens as 0, `costUsd` null.

---

## Out of Scope

- Pre-run cost estimation (deferred)
- DB storage of eval costs
- Cost tracking for non-OpenRouter providers (tokens tracked, `costUsd` stays null)
