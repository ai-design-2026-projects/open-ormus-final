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
