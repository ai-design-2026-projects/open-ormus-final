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
