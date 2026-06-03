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
