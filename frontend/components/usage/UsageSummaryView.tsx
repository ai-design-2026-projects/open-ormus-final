import { Suspense } from "react"
import { AppNav } from "@/components/app-shell/AppNav"
import { PeriodSelector } from "./PeriodSelector"
import { AgentSection } from "./AgentSection"
import { ConversationsSection } from "./ConversationsSection"
import { OtherSection } from "./OtherSection"
import type { UsageSummary, Period, TokenStats } from "@/app/api/usage/summary/types"

type Props = { summary: UsageSummary; period: Period }

function addStats(a: TokenStats, b: TokenStats): TokenStats {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: a.costUsd !== null && b.costUsd !== null ? a.costUsd + b.costUsd : null,
  }
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

const PERIOD_LABEL: Record<Period, string> = {
  today:  "today",
  "7d":   "last 7 days",
  "30d":  "last 30 days",
  all:    "all time",
}

export function UsageSummaryView({ summary, period }: Props) {
  const sources: TokenStats[] = [
    summary.agent as TokenStats,
    summary.conversations.totals,
    summary.other,
  ]
  const grandTotal = sources.reduce(addStats)
  const isEmpty = grandTotal.inputTokens === 0 && grandTotal.outputTokens === 0
  // hasCost: true if any source with actual records has cost data
  const hasCost = !isEmpty && sources.some((s) => s.costUsd !== null)
  // Sum costs treating null-from-empty-period as $0
  const totalCost = hasCost ? sources.reduce((sum, s) => sum + (s.costUsd ?? 0), 0) : null

  return (
    <div className="min-h-screen bg-background">
      <AppNav />

      <div className="max-w-[560px] mx-auto px-6 md:px-0">
        {/* Header */}
        <div className="flex items-end justify-between py-8 border-b border-hair">
          <div>
            <div className="t-meta">USAGE</div>
            <h1 className="t-h2 mt-2 mb-0">Token usage</h1>
          </div>
          <Suspense fallback={<div className="h-8 w-44 rounded-lg bg-surface-sunk animate-pulse" />}>
            <PeriodSelector period={period} />
          </Suspense>
        </div>

        {/* Grand total */}
        <div className="py-7 border-b border-hair">
          <div className="t-meta text-ink-mute mb-2">Total · {PERIOD_LABEL[period]}</div>
          {isEmpty ? (
            <p className="text-[22px] font-medium text-ink-faint">No activity</p>
          ) : hasCost ? (
            <div className="flex items-baseline gap-4">
              <span className="text-[40px] font-medium text-ink tabular-nums leading-none">
                ${totalCost!.toFixed(2)}
              </span>
              <span className="t-mono text-xs text-ink-faint">
                {fmtTokens(grandTotal.inputTokens)} in · {fmtTokens(grandTotal.outputTokens)} out
              </span>
            </div>
          ) : (
            <div className="flex items-baseline gap-4">
              <span className="text-[40px] font-medium text-ink tabular-nums leading-none">
                {fmtTokens(grandTotal.inputTokens + grandTotal.outputTokens)}
                <span className="text-[20px] text-ink-dim ml-1">tokens</span>
              </span>
              <span className="t-mono text-xs text-ink-faint">
                {fmtTokens(grandTotal.inputTokens)} in · {fmtTokens(grandTotal.outputTokens)} out
              </span>
            </div>
          )}
        </div>

        {/* Sections */}
        <div className="divide-y divide-hair pb-14">
          <AgentSection data={summary.agent} />
          <ConversationsSection data={summary.conversations} />
          <OtherSection data={summary.other} />
        </div>
      </div>
    </div>
  )
}
