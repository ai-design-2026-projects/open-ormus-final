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
