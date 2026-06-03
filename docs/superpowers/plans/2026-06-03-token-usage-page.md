# Token Usage Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/settings/usage` — a page showing LLM token usage and cost grouped by Agent, Conversations, and Other, with four time-range presets.

**Architecture:** Server Component page calls `getUsageSummary()` directly (no self-fetch anti-pattern); same function is exposed via `GET /api/usage/summary` for future use. Period is URL-driven (`?period=today|7d|30d|all`). Expand/collapse per conversation is local client state.

**Tech Stack:** Next.js 16 App Router, Prisma 7, Supabase Auth, `bun:test`, shadcn/ui (`Segmented`), Tailwind CSS, lucide-react.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `frontend/app/api/usage/summary/types.ts` | Create | Shared types: `Period`, `TokenStats`, `ConversationBreakdown`, `UsageSummary` |
| `frontend/app/api/usage/summary/utils.ts` | Create | `getPeriodFilter`, `buildSummary`, `getUsageSummary` |
| `frontend/app/api/usage/summary/__tests__/utils.test.ts` | Create | Unit tests for `getPeriodFilter` and `buildSummary` |
| `frontend/app/api/usage/summary/route.ts` | Create | Thin GET route handler — auth + call `getUsageSummary` |
| `frontend/components/usage/TokenCostDisplay.tsx` | Create | Display primitive: "Xk in · Yk out · $Z.ZZ" |
| `frontend/components/usage/PeriodSelector.tsx` | Create | Client component: `Segmented` tabs updating `?period=` search param |
| `frontend/components/usage/AgentSection.tsx` | Create | Agent section row |
| `frontend/components/usage/OtherSection.tsx` | Create | Other section row |
| `frontend/components/usage/ConversationRow.tsx` | Create | Client component: expandable conversation row |
| `frontend/components/usage/ConversationsSection.tsx` | Create | Conversations section: total row + list of `ConversationRow` |
| `frontend/components/usage/UsageSummaryView.tsx` | Create | Layout shell: header + `PeriodSelector` + three sections |
| `frontend/app/settings/usage/page.tsx` | Create | Server Component: auth guard + `getUsageSummary` + render |
| `frontend/app/settings/usage/loading.tsx` | Create | Skeleton loading state |

---

## Task 1: Types and pure utilities

**Files:**
- Create: `frontend/app/api/usage/summary/types.ts`
- Create: `frontend/app/api/usage/summary/utils.ts`
- Create: `frontend/app/api/usage/summary/__tests__/utils.test.ts`

- [ ] **Step 1: Create types file**

```typescript
// frontend/app/api/usage/summary/types.ts

export type Period = "today" | "7d" | "30d" | "all"

export type TokenStats = {
  inputTokens: number
  outputTokens: number
  costUsd: number | null
}

export type ConversationBreakdown = {
  id: string
  title: string
  totals: TokenStats
  conversation: TokenStats
  orchestrator: TokenStats | null
}

export type UsageSummary = {
  period: Period
  agent: TokenStats & { sessionCount: number }
  conversations: {
    totals: TokenStats
    items: ConversationBreakdown[]
  }
  other: TokenStats
}
```

- [ ] **Step 2: Write failing tests for `getPeriodFilter` and `buildSummary`**

```typescript
// frontend/app/api/usage/summary/__tests__/utils.test.ts

import { describe, test, expect, beforeAll } from "bun:test"
import { getPeriodFilter, buildSummary } from "../utils"

// ── getPeriodFilter ──────────────────────────────────────────────────────────

describe("getPeriodFilter", () => {
  test("all returns empty object", () => {
    expect(getPeriodFilter("all")).toEqual({})
  })

  test("today returns createdAt.gte at start of today", () => {
    const filter = getPeriodFilter("today")
    expect(filter).toHaveProperty("createdAt.gte")
    const gte = (filter as { createdAt: { gte: Date } }).createdAt.gte
    expect(gte).toBeInstanceOf(Date)
    const now = new Date()
    expect(gte.getFullYear()).toBe(now.getFullYear())
    expect(gte.getMonth()).toBe(now.getMonth())
    expect(gte.getDate()).toBe(now.getDate())
    expect(gte.getHours()).toBe(0)
    expect(gte.getMinutes()).toBe(0)
  })

  test("7d returns createdAt.gte roughly 7 days ago", () => {
    const filter = getPeriodFilter("7d")
    const gte = (filter as { createdAt: { gte: Date } }).createdAt.gte
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    expect(Math.abs(gte.getTime() - sevenDaysAgo)).toBeLessThan(5000)
  })

  test("30d returns createdAt.gte roughly 30 days ago", () => {
    const filter = getPeriodFilter("30d")
    const gte = (filter as { createdAt: { gte: Date } }).createdAt.gte
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    expect(Math.abs(gte.getTime() - thirtyDaysAgo)).toBeLessThan(5000)
  })
})

// ── buildSummary ─────────────────────────────────────────────────────────────

const agentRows = [
  { agentSessionId: "sess-1", _sum: { inputTokens: 100, outputTokens: 50, costUsd: 0.01 } },
  { agentSessionId: "sess-2", _sum: { inputTokens: 200, outputTokens: 80, costUsd: null } },
]

const convRows = [
  {
    conversationId: "conv-1",
    source: "CONVERSATION",
    _sum: { inputTokens: 300, outputTokens: 120, costUsd: 0.05 },
  },
  {
    conversationId: "conv-1",
    source: "ORCHESTRATOR",
    _sum: { inputTokens: 50, outputTokens: 20, costUsd: 0.01 },
  },
  {
    conversationId: "conv-2",
    source: "CONVERSATION",
    _sum: { inputTokens: 400, outputTokens: 160, costUsd: null },
  },
]

const otherAgg = { _sum: { inputTokens: 10, outputTokens: 5, costUsd: null } }

const convTitles = [
  { id: "conv-1", title: "Scene A" },
  { id: "conv-2", title: "Scene B" },
]

describe("buildSummary", () => {
  const summary = buildSummary("7d", agentRows, convRows, otherAgg, convTitles)

  test("period passthrough", () => {
    expect(summary.period).toBe("7d")
  })

  test("agent totals sum across sessions", () => {
    expect(summary.agent.inputTokens).toBe(300)
    expect(summary.agent.outputTokens).toBe(130)
    expect(summary.agent.sessionCount).toBe(2)
  })

  test("agent costUsd null when any session has null", () => {
    // costUsd is null when not all sessions have cost data
    expect(summary.agent.costUsd).toBeNull()
  })

  test("conversations items length matches distinct conversationIds", () => {
    expect(summary.conversations.items).toHaveLength(2)
  })

  test("conversation with orchestrator has non-null orchestrator", () => {
    const conv1 = summary.conversations.items.find((i) => i.id === "conv-1")
    expect(conv1).toBeDefined()
    expect(conv1!.orchestrator).not.toBeNull()
    expect(conv1!.orchestrator!.inputTokens).toBe(50)
  })

  test("conversation without orchestrator has null orchestrator", () => {
    const conv2 = summary.conversations.items.find((i) => i.id === "conv-2")
    expect(conv2!.orchestrator).toBeNull()
  })

  test("conversation totals = conversation + orchestrator", () => {
    const conv1 = summary.conversations.items.find((i) => i.id === "conv-1")!
    expect(conv1.totals.inputTokens).toBe(350)
    expect(conv1.totals.outputTokens).toBe(140)
  })

  test("conversations.totals sums all conversation items", () => {
    expect(summary.conversations.totals.inputTokens).toBe(750)
    expect(summary.conversations.totals.outputTokens).toBe(300)
  })

  test("conversation title populated from convTitles", () => {
    const conv1 = summary.conversations.items.find((i) => i.id === "conv-1")!
    expect(conv1.title).toBe("Scene A")
  })

  test("other maps otherAgg", () => {
    expect(summary.other.inputTokens).toBe(10)
    expect(summary.other.outputTokens).toBe(5)
    expect(summary.other.costUsd).toBeNull()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
bun test --cwd frontend frontend/app/api/usage/summary/__tests__/utils.test.ts
```

Expected: `Cannot find module '../utils'`

- [ ] **Step 4: Create utils file**

```typescript
// frontend/app/api/usage/summary/utils.ts

import { prisma } from "@/lib/prisma"
import { LlmUsageSource } from "@/lib/generated/prisma/client"
import type { Period, TokenStats, ConversationBreakdown, UsageSummary } from "./types"

// ── Period filter ─────────────────────────────────────────────────────────────

export function getPeriodFilter(period: Period): { createdAt?: { gte: Date } } {
  if (period === "all") return {}
  if (period === "today") {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return { createdAt: { gte: start } }
  }
  const days = period === "7d" ? 7 : 30
  return { createdAt: { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) } }
}

// ── Types for Prisma results ──────────────────────────────────────────────────

type SumResult = { inputTokens: number | null; outputTokens: number | null; costUsd: number | null }

type AgentRow = { agentSessionId: string | null; _sum: SumResult }

type ConvRow = { conversationId: string | null; source: string; _sum: SumResult }

type OtherAgg = { _sum: SumResult }

type ConvTitle = { id: string; title: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

function toStats(sum: SumResult): TokenStats {
  return {
    inputTokens: sum.inputTokens ?? 0,
    outputTokens: sum.outputTokens ?? 0,
    costUsd: sum.costUsd,
  }
}

function addStats(a: TokenStats, b: TokenStats): TokenStats {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    // null if either is null (incomplete cost data)
    costUsd: a.costUsd !== null && b.costUsd !== null ? a.costUsd + b.costUsd : null,
  }
}

const ZERO_STATS: TokenStats = { inputTokens: 0, outputTokens: 0, costUsd: 0 }

// ── buildSummary ──────────────────────────────────────────────────────────────

export function buildSummary(
  period: Period,
  agentRows: AgentRow[],
  convRows: ConvRow[],
  otherAgg: OtherAgg,
  convTitles: ConvTitle[]
): UsageSummary {
  // Agent section
  const agentTotals = agentRows.reduce<TokenStats>(
    (acc, row) => addStats(acc, toStats(row._sum)),
    ZERO_STATS
  )
  // If any session is missing cost, the total is null (incomplete data)
  const agentCostUsd = agentRows.some((r) => r._sum.costUsd === null)
    ? null
    : agentTotals.costUsd

  // Conversations section
  const titleMap = new Map(convTitles.map((t) => [t.id, t.title]))

  const byConvId = new Map<string, { conv: TokenStats | null; orch: TokenStats | null }>()
  for (const row of convRows) {
    if (!row.conversationId) continue
    const existing = byConvId.get(row.conversationId) ?? { conv: null, orch: null }
    if (row.source === LlmUsageSource.CONVERSATION) {
      existing.conv = toStats(row._sum)
    } else if (row.source === LlmUsageSource.ORCHESTRATOR) {
      existing.orch = toStats(row._sum)
    }
    byConvId.set(row.conversationId, existing)
  }

  const items: ConversationBreakdown[] = []
  for (const [id, { conv, orch }] of byConvId) {
    const convStats = conv ?? ZERO_STATS
    const totals = orch !== null ? addStats(convStats, orch) : convStats
    items.push({
      id,
      title: titleMap.get(id) ?? "Untitled",
      totals,
      conversation: convStats,
      orchestrator: orch,
    })
  }

  const convTotals = items.reduce<TokenStats>(
    (acc, item) => addStats(acc, item.totals),
    ZERO_STATS
  )

  return {
    period,
    agent: {
      inputTokens: agentTotals.inputTokens,
      outputTokens: agentTotals.outputTokens,
      costUsd: agentCostUsd,
      sessionCount: agentRows.length,
    },
    conversations: {
      totals: convTotals,
      items,
    },
    other: toStats(otherAgg._sum),
  }
}

// ── getUsageSummary ───────────────────────────────────────────────────────────

export async function getUsageSummary(userId: string, period: Period): Promise<UsageSummary> {
  const periodFilter = getPeriodFilter(period)

  const [agentRows, convRows, otherAgg] = await Promise.all([
    prisma.llmUsage.groupBy({
      by: ["agentSessionId"],
      where: { userId, source: LlmUsageSource.AGENT_SESSION, ...periodFilter },
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    }),
    prisma.llmUsage.groupBy({
      by: ["conversationId", "source"],
      where: {
        userId,
        source: { in: [LlmUsageSource.CONVERSATION, LlmUsageSource.ORCHESTRATOR] },
        ...periodFilter,
      },
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    }),
    prisma.llmUsage.aggregate({
      where: {
        userId,
        source: { in: [LlmUsageSource.IMPROVE_CONTEXT, LlmUsageSource.OTHER] },
        ...periodFilter,
      },
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    }),
  ])

  const conversationIds = [
    ...new Set(convRows.map((r) => r.conversationId).filter((id): id is string => id !== null)),
  ]
  const convTitles = await prisma.conversation.findMany({
    where: { id: { in: conversationIds } },
    select: { id: true, title: true },
  })

  return buildSummary(period, agentRows, convRows, otherAgg, convTitles)
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun test --cwd frontend frontend/app/api/usage/summary/__tests__/utils.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/api/usage/summary/types.ts \
        frontend/app/api/usage/summary/utils.ts \
        frontend/app/api/usage/summary/__tests__/utils.test.ts
git commit -m "feat(usage): add types, getPeriodFilter, buildSummary, getUsageSummary"
```

---

## Task 2: API route handler

**Files:**
- Create: `frontend/app/api/usage/summary/route.ts`

- [ ] **Step 1: Create route handler**

```typescript
// frontend/app/api/usage/summary/route.ts

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getUsageSummary } from "./utils"
import type { Period } from "./types"

const VALID_PERIODS = new Set<string>(["today", "7d", "30d", "all"])

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (!user || error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rawPeriod = req.nextUrl.searchParams.get("period") ?? "7d"
  if (!VALID_PERIODS.has(rawPeriod)) {
    return NextResponse.json({ error: "Invalid period" }, { status: 400 })
  }

  const summary = await getUsageSummary(user.id, rawPeriod as Period)
  return NextResponse.json(summary)
}
```

- [ ] **Step 2: Type-check**

```bash
bun run typecheck --cwd frontend
```

Expected: no errors in the new files.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/api/usage/summary/route.ts
git commit -m "feat(usage): add GET /api/usage/summary route"
```

---

## Task 3: `TokenCostDisplay` component

**Files:**
- Create: `frontend/components/usage/TokenCostDisplay.tsx`

- [ ] **Step 1: Create component**

```tsx
// frontend/components/usage/TokenCostDisplay.tsx

import { cn } from "@/lib/utils"
import type { TokenStats } from "@/app/api/usage/summary/types"

function fmt(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

type Props = { stats: TokenStats; className?: string }

export function TokenCostDisplay({ stats, className }: Props) {
  return (
    <span className={cn("text-sm text-ink-mute tabular-nums whitespace-nowrap", className)}>
      {fmt(stats.inputTokens)} in · {fmt(stats.outputTokens)} out
      {stats.costUsd !== null ? (
        <> · <span className="text-ink">${stats.costUsd.toFixed(2)}</span></>
      ) : (
        <> · <span>—</span></>
      )}
    </span>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
bun run typecheck --cwd frontend
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/usage/TokenCostDisplay.tsx
git commit -m "feat(usage): add TokenCostDisplay component"
```

---

## Task 4: `PeriodSelector` component

**Files:**
- Create: `frontend/components/usage/PeriodSelector.tsx`

- [ ] **Step 1: Create component**

```tsx
// frontend/components/usage/PeriodSelector.tsx

"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Segmented } from "@/components/ui/segmented"
import type { Period } from "@/app/api/usage/summary/types"

const OPTIONS: ReadonlyArray<{ value: Period; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All time" },
]

export function PeriodSelector({ period }: { period: Period }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function handleChange(v: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("period", v)
    router.push(`/settings/usage?${params.toString()}`)
  }

  return <Segmented value={period} onValueChange={handleChange} options={OPTIONS} />
}
```

- [ ] **Step 2: Type-check**

```bash
bun run typecheck --cwd frontend
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/usage/PeriodSelector.tsx
git commit -m "feat(usage): add PeriodSelector component"
```

---

## Task 5: `AgentSection` and `OtherSection` components

**Files:**
- Create: `frontend/components/usage/AgentSection.tsx`
- Create: `frontend/components/usage/OtherSection.tsx`

- [ ] **Step 1: Create `AgentSection`**

```tsx
// frontend/components/usage/AgentSection.tsx

import { TokenCostDisplay } from "./TokenCostDisplay"
import type { UsageSummary } from "@/app/api/usage/summary/types"

export function AgentSection({ data }: { data: UsageSummary["agent"] }) {
  return (
    <section className="flex items-center justify-between py-3">
      <div>
        <p className="text-sm font-medium text-ink">Agent</p>
        <p className="text-xs text-ink-mute mt-0.5">
          {data.sessionCount} {data.sessionCount === 1 ? "session" : "sessions"}
        </p>
      </div>
      <TokenCostDisplay stats={data} />
    </section>
  )
}
```

- [ ] **Step 2: Create `OtherSection`**

```tsx
// frontend/components/usage/OtherSection.tsx

import { TokenCostDisplay } from "./TokenCostDisplay"
import type { UsageSummary } from "@/app/api/usage/summary/types"

export function OtherSection({ data }: { data: UsageSummary["other"] }) {
  return (
    <section className="flex items-center justify-between py-3">
      <p className="text-sm font-medium text-ink">Other</p>
      <TokenCostDisplay stats={data} />
    </section>
  )
}
```

- [ ] **Step 3: Type-check**

```bash
bun run typecheck --cwd frontend
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/usage/AgentSection.tsx \
        frontend/components/usage/OtherSection.tsx
git commit -m "feat(usage): add AgentSection and OtherSection components"
```

---

## Task 6: `ConversationRow` and `ConversationsSection` components

**Files:**
- Create: `frontend/components/usage/ConversationRow.tsx`
- Create: `frontend/components/usage/ConversationsSection.tsx`

- [ ] **Step 1: Create `ConversationRow`**

```tsx
// frontend/components/usage/ConversationRow.tsx

"use client"

import { useState } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { TokenCostDisplay } from "./TokenCostDisplay"
import type { ConversationBreakdown } from "@/app/api/usage/summary/types"

export function ConversationRow({ item }: { item: ConversationBreakdown }) {
  const [open, setOpen] = useState(false)

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between py-2.5 text-left hover:bg-surface-hover rounded px-1 -mx-1 transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <ChevronRight
            className={cn(
              "shrink-0 size-3.5 text-ink-mute transition-transform duration-150",
              open && "rotate-90"
            )}
          />
          <span className="text-sm text-ink truncate">{item.title}</span>
        </span>
        <TokenCostDisplay stats={item.totals} className="ml-4" />
      </button>

      {open && (
        <div className="ml-5 border-l border-hair pl-3 pb-1 space-y-0.5">
          <div className="flex items-center justify-between py-1">
            <span className="text-xs text-ink-mute">Characters</span>
            <TokenCostDisplay stats={item.conversation} />
          </div>
          {item.orchestrator !== null && (
            <div className="flex items-center justify-between py-1">
              <span className="text-xs text-ink-mute">Orchestrator</span>
              <TokenCostDisplay stats={item.orchestrator} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create `ConversationsSection`**

```tsx
// frontend/components/usage/ConversationsSection.tsx

import { TokenCostDisplay } from "./TokenCostDisplay"
import { ConversationRow } from "./ConversationRow"
import type { UsageSummary } from "@/app/api/usage/summary/types"

export function ConversationsSection({ data }: { data: UsageSummary["conversations"] }) {
  return (
    <section className="py-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-ink">Conversations</p>
        <TokenCostDisplay stats={data.totals} />
      </div>

      {data.items.length === 0 ? (
        <p className="text-xs text-ink-mute py-1">No conversations in this period.</p>
      ) : (
        <div className="space-y-0.5">
          {data.items.map((item) => (
            <ConversationRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 3: Type-check**

```bash
bun run typecheck --cwd frontend
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/usage/ConversationRow.tsx \
        frontend/components/usage/ConversationsSection.tsx
git commit -m "feat(usage): add ConversationRow and ConversationsSection components"
```

---

## Task 7: `UsageSummaryView` layout shell

**Files:**
- Create: `frontend/components/usage/UsageSummaryView.tsx`

- [ ] **Step 1: Create component**

```tsx
// frontend/components/usage/UsageSummaryView.tsx

import { PeriodSelector } from "./PeriodSelector"
import { AgentSection } from "./AgentSection"
import { ConversationsSection } from "./ConversationsSection"
import { OtherSection } from "./OtherSection"
import type { UsageSummary } from "@/app/api/usage/summary/types"
import type { Period } from "@/app/api/usage/summary/types"

type Props = { summary: UsageSummary; period: Period }

export function UsageSummaryView({ summary, period }: Props) {
  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold text-ink">Token Usage</h1>
        <PeriodSelector period={period} />
      </div>

      <div className="divide-y divide-hair border border-hair rounded-xl px-4">
        <AgentSection data={summary.agent} />
        <ConversationsSection data={summary.conversations} />
        <OtherSection data={summary.other} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
bun run typecheck --cwd frontend
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/usage/UsageSummaryView.tsx
git commit -m "feat(usage): add UsageSummaryView layout shell"
```

---

## Task 8: Page and loading skeleton

**Files:**
- Create: `frontend/app/settings/usage/page.tsx`
- Create: `frontend/app/settings/usage/loading.tsx`

- [ ] **Step 1: Create page**

```tsx
// frontend/app/settings/usage/page.tsx

import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getUsageSummary } from "@/app/api/usage/summary/utils"
import { UsageSummaryView } from "@/components/usage/UsageSummaryView"
import type { Period } from "@/app/api/usage/summary/types"

const VALID_PERIODS = new Set<string>(["today", "7d", "30d", "all"])

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { period: rawPeriod } = await searchParams
  const period = (VALID_PERIODS.has(rawPeriod ?? "") ? rawPeriod : "7d") as Period

  const summary = await getUsageSummary(user.id, period)

  return <UsageSummaryView summary={summary} period={period} />
}
```

- [ ] **Step 2: Create loading skeleton**

```tsx
// frontend/app/settings/usage/loading.tsx

export default function UsageLoading() {
  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div className="h-6 w-28 rounded bg-surface-sunk animate-pulse" />
        <div className="h-8 w-48 rounded-lg bg-surface-sunk animate-pulse" />
      </div>
      <div className="border border-hair rounded-xl px-4 divide-y divide-hair">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center justify-between py-4">
            <div className="h-4 w-24 rounded bg-surface-sunk animate-pulse" />
            <div className="h-4 w-40 rounded bg-surface-sunk animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Type-check the full frontend**

```bash
bun run typecheck --cwd frontend
```

Expected: no errors.

- [ ] **Step 4: Run all tests**

```bash
bun test --cwd frontend
bun test --cwd mcp_server
```

Expected: all previously passing tests still pass, new utils tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/settings/usage/page.tsx \
        frontend/app/settings/usage/loading.tsx
git commit -m "feat(usage): add /settings/usage page and loading skeleton"
```

---

## Self-Review

**Spec coverage:**
- ✅ `/settings/usage` route — Task 8
- ✅ Period presets today/7d/30d/all — Tasks 1 + 4
- ✅ Token counts + cost display — Task 3
- ✅ Agent section — Task 5
- ✅ Conversations section with expandable rows — Task 6
- ✅ Orchestrator sub-row (null when ROUND_ROBIN) — Task 6
- ✅ Other section (single row, no breakdown) — Task 5
- ✅ Loading skeleton — Task 8
- ✅ `GET /api/usage/summary` — Task 2
- ✅ Nav link — explicitly deferred per spec §6 (Out of Scope)

**Types consistent across tasks:**
- `TokenStats`, `ConversationBreakdown`, `UsageSummary`, `Period` — all from `types.ts`, imported everywhere
- `ZERO_STATS` in `buildSummary` — used for `reduce` initial value; note it has `costUsd: 0` (not null). The `addStats` logic correctly propagates null from child items. Final `convTotals` will be null if any item has a null costUsd. This is correct behavior.

**Placeholder scan:** None found.
