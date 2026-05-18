import { Monogram } from "@/components/ui/monogram"
import { Ring } from "@/components/ui/ring"

interface CastStateData { name: string; emotion: string; intensity: string; coherence: number }

const CAST: CastStateData[] = [
  { name: "Sherlock Holmes", emotion: "Anticipation", intensity: "rising", coherence: 0.93 },
  { name: "James Moriarty", emotion: "Trust · feigned", intensity: "steady", coherence: 0.88 },
]

function CastRow({ c }: { c: CastStateData }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <Monogram name={c.name} size={28} />
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-medium truncate">{c.name}</p>
        <p className="t-meta">{c.emotion.toUpperCase()} · {c.intensity}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <Ring value={Math.round(c.coherence * 100)} size={26} stroke={2.5} />
        <span className="font-mono text-[10px] text-ink-dim">{Math.round(c.coherence * 100)}</span>
      </div>
    </div>
  )
}

export function CastStateDemo() {
  return (
    <div className="bg-surface-1 border border-hair rounded-xl p-4 max-w-xs">
      <p className="t-meta mb-3">CAST STATE</p>
      <div className="flex flex-col divide-y divide-hair">
        {CAST.map((c) => <CastRow key={c.name} c={c} />)}
      </div>
    </div>
  )
}
