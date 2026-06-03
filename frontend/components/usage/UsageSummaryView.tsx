import { Suspense } from "react"
import { PeriodSelector } from "./PeriodSelector"
import { AgentSection } from "./AgentSection"
import { ConversationsSection } from "./ConversationsSection"
import { OtherSection } from "./OtherSection"
import type { UsageSummary, Period } from "@/app/api/usage/summary/types"

type Props = { summary: UsageSummary; period: Period }

export function UsageSummaryView({ summary, period }: Props) {
  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold text-ink">Token Usage</h1>
        <Suspense fallback={null}>
          <PeriodSelector period={period} />
        </Suspense>
      </div>

      <div className="divide-y divide-hair border border-hair rounded-xl px-4">
        <AgentSection data={summary.agent} />
        <ConversationsSection data={summary.conversations} />
        <OtherSection data={summary.other} />
      </div>
    </div>
  )
}
