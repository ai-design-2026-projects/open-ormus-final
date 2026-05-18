const LEVELS = [
  { name: "shadow-0", label: "0 — hairline ring", style: { boxShadow: "var(--shadow-0)" } },
  { name: "shadow-1", label: "1 — card resting", style: { boxShadow: "var(--shadow-1)" } },
  { name: "shadow-2", label: "2 — floating panel", style: { boxShadow: "var(--shadow-2)" } },
  { name: "shadow-3", label: "3 — modal / sheet", style: { boxShadow: "var(--shadow-3)" } },
  { name: "shadow-glow", label: "glow — focus accent", style: { boxShadow: "var(--shadow-glow)" } },
]

export function ElevationSection() {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-5 gap-6">
        {LEVELS.map(({ name, label, style }) => (
          <div key={name} className="flex flex-col items-center gap-3">
            <div
              className="w-full h-24 bg-surface-1 rounded-xl"
              style={style}
            />
            <span className="t-meta text-center">{label}</span>
            <span className="font-mono text-[9px] text-ink-faint">--{name}</span>
          </div>
        ))}
      </div>
      <div>
        <p className="t-meta mb-4">GLASS</p>
        <div className="relative h-28 rounded-xl overflow-hidden grid-field">
          <div className="absolute inset-4 glass rounded-lg flex items-center justify-center">
            <span className="t-body text-ink-dim">Glass surface — backdrop-filter blur(20px)</span>
          </div>
        </div>
      </div>
    </div>
  )
}
