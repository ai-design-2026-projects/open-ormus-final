import { Monogram } from "@/components/ui/monogram"
import { ChevronRight } from "lucide-react"

interface SessionData {
  chars: string[]; scene: string; turns: number; when: string
  status: "streaming" | "stopped" | "complete"
}

const SESSIONS: SessionData[] = [
  { chars: ["Sherlock Holmes","James Moriarty"], scene: "A foggy Victorian railway platform at dusk. The last train is twelve minutes late.", turns: 26, when: "3 min ago", status: "streaming" },
  { chars: ["Iris Vega","Ada Wren"], scene: "An abandoned greenhouse. Iris is looking for her sister's notebook.", turns: 14, when: "2h ago", status: "stopped" },
  { chars: ["Captain Nemo","Furiosa","Don Quixote"], scene: "A council table. Three commanders, one impossible map.", turns: 42, when: "yesterday", status: "complete" },
]

const STATUS_BADGE: Record<SessionData["status"], React.ReactNode> = {
  streaming: <span className="inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full bg-accent-soft text-accent-deep border border-[color-mix(in_oklch,var(--accent-oo)_16%,transparent)] font-mono text-[10.5px] tracking-[0.04em] uppercase"><span className="size-1.5 rounded-full bg-current" />LIVE</span>,
  stopped:   <span className="inline-flex items-center h-[22px] px-2 rounded-full bg-[color-mix(in_oklch,var(--signal-warn)_14%,var(--surface-1))] text-[oklch(0.45_0.16_78)] font-mono text-[10.5px] tracking-[0.04em] uppercase">STOPPED</span>,
  complete:  <span className="inline-flex items-center h-[22px] px-2 rounded-full bg-surface-sunk text-ink-dim border border-hair font-mono text-[10.5px] tracking-[0.04em] uppercase">DONE</span>,
}

function SessionRow({ s }: { s: SessionData }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-bg-tinted transition-colors duration-[120ms] cursor-pointer group">
      <div className="flex">
        {s.chars.slice(0, 3).map((name, i) => (
          <div key={name} style={{ marginLeft: i === 0 ? 0 : -10, zIndex: 3 - i }}>
            <Monogram name={name} size={36} />
          </div>
        ))}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-[14px] truncate">{s.chars.join(" · ")}</p>
        <p className="t-body-s text-ink-dim truncate t-editorial">{s.scene}</p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="t-meta">{s.when}</span>
        <span className="font-mono text-[11px] text-ink-mute">{s.turns}T</span>
        {STATUS_BADGE[s.status]}
        <ChevronRight className="size-4 text-ink-faint group-hover:text-ink-dim transition-colors" strokeWidth={1.5} />
      </div>
    </div>
  )
}

export function SessionRowDemo() {
  return (
    <div className="flex flex-col divide-y divide-hair">
      {SESSIONS.map((s) => <SessionRow key={s.chars.join()} s={s} />)}
    </div>
  )
}
