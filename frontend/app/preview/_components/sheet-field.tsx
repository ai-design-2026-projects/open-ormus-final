import { Ring } from "@/components/ui/ring"

interface SheetFieldProps {
  title: string
  pct: number
  flagged?: boolean
  children: React.ReactNode
}

function SheetField({ title, pct, flagged = false, children }: SheetFieldProps) {
  return (
    <article className={`border rounded-xl overflow-hidden ${flagged ? "border-[color-mix(in_oklch,var(--signal-warn)_40%,transparent)]" : "border-hair"}`}>
      <header className="flex items-center justify-between px-4 py-3 border-b border-hair bg-surface-sunk gap-4">
        <h3 className="t-h6 m-0">{title}</h3>
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono text-[11px]" style={{ color: flagged ? "var(--signal-warn)" : "var(--ink-mute)" }}>
            {Math.round(pct * 100)}% confidence
          </span>
          <div className="w-24 h-1 bg-surface-sunk rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${pct * 100}%`, background: flagged ? "var(--signal-warn)" : "var(--accent-oo)" }}
            />
          </div>
          <Ring value={Math.round(pct * 100)} size={22} stroke={2} {...(flagged ? { color: "var(--signal-warn)" } : {})} />
        </div>
      </header>
      <div className="px-4 py-4 bg-surface-1">{children}</div>
    </article>
  )
}

export function SheetFieldDemo() {
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <SheetField title="Core personality" pct={0.94}>
        <p className="t-body text-ink-dim leading-relaxed">
          A self-described &ldquo;consulting detective&rdquo; whose deductive style and chemical obsessions are inseparable from his contempt for ordinary minds. Vulnerable to boredom; deeply, awkwardly loyal to Watson.
        </p>
      </SheetField>
      <SheetField title="Vocal style" pct={0.62} flagged>
        <p className="t-body text-ink-dim leading-relaxed">Precise, clipped, occasionally condescending.</p>
        <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg bg-[color-mix(in_oklch,var(--signal-warn)_10%,var(--surface-1))] border border-[color-mix(in_oklch,var(--signal-warn)_25%,transparent)]">
          <span className="t-body-s" style={{ color: "oklch(0.45 0.16 78)" }}>Source conflict — Doyle vs. Granada adaptation differ on whether the violin is calming or compulsive.</span>
        </div>
      </SheetField>
    </div>
  )
}
