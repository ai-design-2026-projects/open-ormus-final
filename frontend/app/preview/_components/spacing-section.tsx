const SPACING = [
  { name: "s-05", px: 2 }, { name: "s-1", px: 4 }, { name: "s-2", px: 8 },
  { name: "s-3", px: 12 }, { name: "s-4", px: 16 }, { name: "s-5", px: 24 },
  { name: "s-6", px: 32 }, { name: "s-7", px: 48 }, { name: "s-8", px: 64 },
]
const RADII = [
  { name: "r-xs", val: "4px" }, { name: "r-sm", val: "8px" }, { name: "r-md", val: "12px" },
  { name: "r-lg", val: "18px" }, { name: "r-xl", val: "24px" }, { name: "r-2xl", val: "32px" },
  { name: "r-pill", val: "999px" },
]

export function SpacingSection() {
  return (
    <div className="flex flex-col gap-10">
      <div>
        <p className="t-meta mb-4">SPACING — 4px base scale</p>
        <div className="flex items-end gap-3">
          {SPACING.map(({ name, px }) => (
            <div key={name} className="flex flex-col items-center gap-1.5">
              <div className="bg-accent-oo rounded-sm" style={{ width: px, height: px }} />
              <span className="t-meta">{px}px</span>
              <span className="font-mono text-[9px] text-ink-faint">--{name}</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">RADII</p>
        <div className="flex items-end gap-4 flex-wrap">
          {RADII.map(({ name, val }) => (
            <div key={name} className="flex flex-col items-center gap-2">
              <div
                className="size-14 bg-surface-sunk border border-hair"
                style={{ borderRadius: `var(--${name})` }}
              />
              <span className="t-meta">{val}</span>
              <span className="font-mono text-[9px] text-ink-faint">--{name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
