# Token Usage Page — Design Spec

**Date:** 2026-06-03  
**Route:** `/settings/usage`  
**Status:** Approved

---

## 1. Overview

A page under `/settings/usage` showing LLM generation costs grouped into three sections: Agent, Conversations, and Other. Displays both token counts and USD cost (where available). Supports four time-range presets driven by a URL search param.

---

## 2. Architecture & Data Flow

```
/settings/usage?period=7d
  └── UsagePage (Server Component)
        ├── fetch /api/usage/summary?period=7d  (route handler)
        │     ├── Prisma query A: GROUP BY agentSessionId WHERE source=AGENT_SESSION → sum tokens/cost
        │     ├── Prisma query B: GROUP BY conversationId, source WHERE source IN [CONVERSATION, ORCHESTRATOR]
        │     ├── Prisma query C: SUM WHERE source IN [IMPROVE_CONTEXT, OTHER]
        │     └── Prisma query D: fetch conversation titles for IDs from B (runs after B resolves)
        │     (A, B, C run in parallel via Promise.all; D follows B)
        │
        ├── PeriodSelector (Client Component) — updates ?period= search param, triggers page re-render
        ├── AgentSection — renders query A result
        ├── ConversationsSection — renders query B+D result, expandable rows
        └── OtherSection — renders query C result
```

Period is URL-driven (`?period=today|7d|30d|all`). No client state for data — Next.js re-fetches on param change. Only expand/collapse is local client state in `ConversationRow`.

---

## 3. API

### Endpoint

`GET /api/usage/summary?period=today|7d|30d|all`

File: `frontend/app/api/usage/summary/route.ts`

Auth: `supabase.auth.getUser()` — returns 401 if unauthenticated.

### Response Shape

```ts
type TokenStats = {
  inputTokens: number
  outputTokens: number
  costUsd: number | null  // null when no OpenRouter cost data available
}

type ConversationBreakdown = {
  id: string
  title: string
  totals: TokenStats
  conversation: TokenStats        // source=CONVERSATION
  orchestrator: TokenStats | null // null if ROUND_ROBIN strategy (no orchestrator calls)
}

type UsageSummary = {
  period: "today" | "7d" | "30d" | "all"
  agent: TokenStats & { sessionCount: number }
  conversations: {
    totals: TokenStats
    items: ConversationBreakdown[]
  }
  other: TokenStats
}
```

### DB Query Strategy

Four Prisma operations, A+B+C in parallel, D sequential after B:

```ts
// A: per-session token sums (collapsed to totals in JS)
prisma.llmUsage.groupBy({
  by: ["agentSessionId"],
  where: { userId, source: "AGENT_SESSION", ...periodFilter },
  _sum: { inputTokens: true, outputTokens: true, costUsd: true },
})

// B: per-conversation per-source sums
prisma.llmUsage.groupBy({
  by: ["conversationId", "source"],
  where: { userId, source: { in: ["CONVERSATION", "ORCHESTRATOR"] }, ...periodFilter },
  _sum: { inputTokens: true, outputTokens: true, costUsd: true },
})

// C: other sources total
prisma.llmUsage.aggregate({
  where: { userId, source: { in: ["IMPROVE_CONTEXT", "OTHER"] }, ...periodFilter },
  _sum: { inputTokens: true, outputTokens: true, costUsd: true },
})

// D: conversation titles (after B resolves, extract conversationIds)
prisma.conversation.findMany({
  where: { id: { in: conversationIds } },
  select: { id: true, title: true },
})
```

`periodFilter` maps preset to `createdAt: { gte: startOf(period) }`. `all` omits the filter entirely.

---

## 4. UI Components

```
frontend/app/settings/usage/
  page.tsx              ← Server Component: fetches summary, renders UsageSummaryView
  loading.tsx           ← Skeleton placeholders (shadcn Skeleton)

frontend/components/usage/
  PeriodSelector.tsx    ← Client: [Today | 7d | 30d | All-time] tab buttons, updates ?period= search param
  UsageSummaryView.tsx  ← Layout shell, receives UsageSummary prop, renders three sections
  AgentSection.tsx      ← TokenStats row + "N sessions" sub-label
  ConversationsSection.tsx ← Summary total row + list of ConversationRow items
  ConversationRow.tsx   ← Client: expand/collapse chevron; collapsed=totals row, expanded=conversation+orchestrator sub-rows
  OtherSection.tsx      ← Single TokenStats row
  TokenCostDisplay.tsx  ← Shared primitive: "123k in · 45k out · $0.12" (cost shows "—" if null)
```

### TokenCostDisplay

- Tokens rendered as `Xk` (Math.round(n / 1000))
- Cost rendered as `$X.XX` when non-null, `—` when null
- Used in every row and sub-row

### ConversationRow expand/collapse

- `useState(false)` for open state
- Chevron icon rotates on open
- Sub-rows: one for `CONVERSATION` source, one for `ORCHESTRATOR` (omitted entirely when `orchestrator: null`)

---

## 5. File Map (new files)

| File | Purpose |
|------|---------|
| `frontend/app/settings/usage/page.tsx` | Server Component page |
| `frontend/app/settings/usage/loading.tsx` | Skeleton loading state |
| `frontend/app/api/usage/summary/route.ts` | API route handler |
| `frontend/components/usage/PeriodSelector.tsx` | Period tab selector |
| `frontend/components/usage/UsageSummaryView.tsx` | Layout shell |
| `frontend/components/usage/AgentSection.tsx` | Agent section |
| `frontend/components/usage/ConversationsSection.tsx` | Conversations section |
| `frontend/components/usage/ConversationRow.tsx` | Expandable conversation row |
| `frontend/components/usage/OtherSection.tsx` | Other section |
| `frontend/components/usage/TokenCostDisplay.tsx` | Token+cost display primitive |

No new dependencies. No schema changes. No existing files modified (nav link addition TBD — confirm with user at implementation time).

---

## 6. Out of Scope

- Sorting / pagination of conversations
- Per-model breakdown
- Export (CSV/JSON)
- Real-time updates
- Nav link placement (confirm at implementation)
