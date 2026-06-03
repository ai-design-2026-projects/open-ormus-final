import { prisma } from "@/lib/prisma"
import { LlmUsageSource } from "@/lib/generated/prisma/client"
import type { Period, TokenStats, ConversationBreakdown, UsageSummary } from "./types"

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

type SumResult = { inputTokens: number | null; outputTokens: number | null; costUsd: number | null }
type AgentRow = { agentSessionId: string | null; _sum: SumResult }
type ConvRow = { conversationId: string | null; source: string; _sum: SumResult }
type OtherAgg = { _sum: SumResult }
type ConvTitle = { id: string; title: string }

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
    costUsd: a.costUsd !== null && b.costUsd !== null ? a.costUsd + b.costUsd : null,
  }
}

const ZERO_STATS: TokenStats = { inputTokens: 0, outputTokens: 0, costUsd: 0 }

export function buildSummary(
  period: Period,
  agentRows: AgentRow[],
  convRows: ConvRow[],
  otherAgg: OtherAgg,
  convTitles: ConvTitle[]
): UsageSummary {
  const agentTotals = agentRows.reduce<TokenStats>(
    (acc, row) => addStats(acc, toStats(row._sum)),
    ZERO_STATS
  )
  const agentCostUsd =
    agentRows.length === 0
      ? null
      : agentRows.some((r) => r._sum.costUsd === null)
        ? null
        : agentTotals.costUsd

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
    items.push({ id, title: titleMap.get(id) ?? "Untitled", totals, conversation: convStats, orchestrator: orch })
  }

  const convTotals =
    items.length === 0
      ? { inputTokens: 0, outputTokens: 0, costUsd: null }
      : items.reduce<TokenStats>((acc, item) => addStats(acc, item.totals), ZERO_STATS)

  return {
    period,
    agent: {
      inputTokens: agentTotals.inputTokens,
      outputTokens: agentTotals.outputTokens,
      costUsd: agentCostUsd,
      sessionCount: agentRows.length,
    },
    conversations: { totals: convTotals, items },
    other: toStats(otherAgg._sum),
  }
}

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
      where: { userId, source: { in: [LlmUsageSource.CONVERSATION, LlmUsageSource.ORCHESTRATOR] }, ...periodFilter },
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    }),
    prisma.llmUsage.aggregate({
      where: { userId, source: { in: [LlmUsageSource.IMPROVE_CONTEXT, LlmUsageSource.OTHER] }, ...periodFilter },
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    }),
  ])

  const conversationIds = [
    ...new Set(convRows.map((r) => r.conversationId).filter((id): id is string => id !== null)),
  ]
  const convTitles = await prisma.conversation.findMany({
    where: { id: { in: conversationIds }, userId },
    select: { id: true, title: true },
  })

  return buildSummary(period, agentRows, convRows, otherAgg, convTitles)
}
