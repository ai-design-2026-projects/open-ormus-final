import { Monogram } from "@/components/ui/monogram"
import { Tag } from "@/components/ui/tag"
import { Ring } from "@/components/ui/ring"

interface CharData {
  name: string; role: string; traits: string[]; completeness: number
  source: "public" | "personal"; status: "complete" | "draft"
}

const CHARS: CharData[] = [
  { name: "Sherlock Holmes", role: "Consulting detective · Conan Doyle", traits: ["observant","arrogant","loyal"], completeness: 94, source: "public", status: "complete" },
  { name: "Iris Vega", role: "Original · noir, near-future", traits: ["cynical","soft-spoken","grieving"], completeness: 48, source: "personal", status: "draft" },
  { name: "Captain Nemo", role: "Anti-hero · Verne", traits: ["vengeful","aristocratic","reclusive"], completeness: 82, source: "public", status: "complete" },
]

function CharCard({ c, featured }: { c: CharData; featured?: boolean }) {
  return (
    <article className={`bg-surface-1 border border-hair rounded-[18px] shadow-[var(--shadow-inset),var(--shadow-1)] p-5 flex flex-col gap-4 ${featured ? "col-span-2" : ""}`}>
      <div className="flex items-start justify-between">
        <Monogram
          name={c.name}
          size={featured ? 88 : 56}
          {...(c.source === "public" ? { status: "public" as const } : c.status === "draft" ? { status: "warn" as const } : {})}
        />
        <div className="flex gap-1.5 flex-wrap justify-end">
          {c.source === "public"
            ? <span className="inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full bg-accent-soft text-accent-deep border border-[color-mix(in_oklch,var(--accent-oo)_16%,transparent)] font-mono text-[10.5px] tracking-[0.04em] uppercase"><span className="size-1.5 rounded-full bg-current" />PUBLIC</span>
            : <span className="inline-flex items-center h-[22px] px-2 rounded-full bg-surface-sunk text-ink-dim border border-hair font-mono text-[10.5px] tracking-[0.04em] uppercase">PERSONAL</span>
          }
          {c.status === "draft" && (
            <span className="inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full bg-[color-mix(in_oklch,var(--signal-warn)_14%,var(--surface-1))] text-[oklch(0.45_0.16_78)] font-mono text-[10.5px] tracking-[0.04em] uppercase"><span className="size-1.5 rounded-full bg-current" />DRAFT</span>
          )}
        </div>
      </div>
      <div>
        <h3 className={`font-medium m-0 tracking-[-0.015em] ${featured ? "t-h4" : "t-h6"}`}>{c.name}</h3>
        <p className="t-body-s text-ink-mute mt-0.5">{c.role}</p>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {c.traits.map((t) => <Tag key={t}>{t}</Tag>)}
      </div>
      <div className="flex items-center gap-2 mt-auto pt-2 border-t border-hair">
        <span className="font-mono text-[11px] text-ink-mute flex-1">{c.completeness}% complete</span>
        <div className="flex-1 h-1 bg-surface-sunk rounded-full overflow-hidden">
          <div className="h-full bg-accent-oo rounded-full" style={{ width: `${c.completeness}%` }} />
        </div>
        <Ring value={c.completeness} size={24} stroke={2.5} />
      </div>
    </article>
  )
}

export function CharacterCardDemo() {
  return (
    <div className="grid grid-cols-2 gap-4">
      <CharCard c={CHARS[0]!} featured />
      {CHARS.slice(1).map((c) => <CharCard key={c.name} c={c} />)}
    </div>
  )
}
