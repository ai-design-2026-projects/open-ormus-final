import { Tag } from "@/components/ui/tag"
import { Kbd } from "@/components/ui/kbd"

interface BadgeProps { tone: string; dot?: boolean; mono?: boolean; children: React.ReactNode }

function OoBadge({ tone, dot, mono, children }: BadgeProps) {
  const BASE = "inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full text-[11.5px] font-medium border border-transparent"
  const TONES: Record<string, string> = {
    neutral: "bg-surface-sunk text-ink-dim border-hair",
    accent:  "bg-accent-soft text-accent-deep border-[color-mix(in_oklch,var(--accent-oo)_16%,transparent)]",
    ok:      "bg-[color-mix(in_oklch,var(--signal-ok)_12%,var(--surface-1))] text-signal-ok",
    warn:    "bg-[color-mix(in_oklch,var(--signal-warn)_14%,var(--surface-1))] text-[oklch(0.45_0.16_78)]",
    flag:    "bg-[color-mix(in_oklch,var(--signal-flag)_12%,var(--surface-1))] text-signal-flag",
    ink:     "bg-ink-panel text-on-ink",
    "on-ink":"bg-white/10 text-on-ink border-hair-on-ink",
  }
  return (
    <span className={`${BASE} ${TONES[tone] ?? TONES["neutral"]} ${mono ? "font-mono text-[10.5px] tracking-[0.04em] uppercase" : ""}`}>
      {dot && <span className="size-1.5 rounded-full bg-current shadow-[0_0_0_3px_color-mix(in_oklch,currentColor_20%,transparent)]" />}
      {children}
    </span>
  )
}

export function BadgesSection() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="t-meta mb-4">BADGE TONES</p>
        <div className="flex flex-wrap gap-2">
          <OoBadge tone="neutral">Neutral</OoBadge>
          <OoBadge tone="accent">Accent</OoBadge>
          <OoBadge tone="ok">OK</OoBadge>
          <OoBadge tone="warn">Warning</OoBadge>
          <OoBadge tone="flag">Flag</OoBadge>
          <OoBadge tone="ink">Ink</OoBadge>
          <div className="bg-ink-panel rounded-lg px-2 py-1"><OoBadge tone="on-ink">On ink</OoBadge></div>
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">MONO + DOT VARIANTS</p>
        <div className="flex flex-wrap gap-2">
          <OoBadge tone="accent" mono dot>PUBLIC</OoBadge>
          <OoBadge tone="ok" mono dot>LIVE</OoBadge>
          <OoBadge tone="warn" mono dot>DRAFT</OoBadge>
          <OoBadge tone="flag" mono dot>FLAGGED</OoBadge>
          <OoBadge tone="neutral" mono>DONE</OoBadge>
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">TAGS (read-only, mono)</p>
        <div className="flex flex-wrap gap-2">
          <Tag tone="neutral">observant</Tag>
          <Tag tone="neutral">arrogant</Tag>
          <Tag tone="neutral">loyal</Tag>
          <Tag tone="accent">consulting detective</Tag>
          <div className="bg-ink-panel rounded-lg px-2 py-1 flex gap-2">
            <Tag tone="on-ink">on-ink variant</Tag>
          </div>
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">KBD</p>
        <div className="flex gap-2 flex-wrap">
          <Kbd>⌘K</Kbd>
          <Kbd>⌘Enter</Kbd>
          <Kbd>Escape</Kbd>
          <Kbd>⌘⇧P</Kbd>
        </div>
      </div>
    </div>
  )
}
