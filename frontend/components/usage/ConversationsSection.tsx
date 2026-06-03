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
