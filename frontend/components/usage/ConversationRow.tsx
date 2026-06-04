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
        className="w-full flex items-center justify-between py-2.5 text-left hover:bg-bg-tinted rounded-[var(--r-sm)] px-1 -mx-1 transition-colors duration-[120ms]"
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
