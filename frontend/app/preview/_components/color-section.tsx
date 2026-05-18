interface SwatchProps { label: string; varName: string; className: string }

function Swatch({ label, varName, className }: SwatchProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className={`h-10 rounded-lg border border-hair ${className}`} />
      <span className="t-meta">{label}</span>
      <span className="font-mono text-[10px] text-ink-faint">{varName}</span>
    </div>
  )
}

export function ColorSection() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="t-meta mb-4">SURFACES</p>
        <div className="grid grid-cols-5 gap-4">
          <Swatch label="bg" varName="--bg" className="bg-background" />
          <Swatch label="bg-tinted" varName="--bg-tinted" className="bg-bg-tinted" />
          <Swatch label="surface-1" varName="--surface-1" className="bg-surface-1" />
          <Swatch label="surface-2" varName="--surface-2" className="bg-surface-2" />
          <Swatch label="surface-sunk" varName="--surface-sunk" className="bg-surface-sunk" />
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">INK PANELS</p>
        <div className="grid grid-cols-3 gap-4">
          <Swatch label="ink-panel" varName="--ink-panel" className="bg-ink-panel" />
          <Swatch label="ink-panel-2" varName="--ink-panel-2" className="bg-ink-panel-2" />
          <Swatch label="ink-panel-3" varName="--ink-panel-3" className="bg-ink-panel-3" />
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">ACCENT</p>
        <div className="grid grid-cols-6 gap-4">
          <Swatch label="accent-oo" varName="--accent-oo" className="bg-accent-oo" />
          <Swatch label="accent-deep" varName="--accent-deep" className="bg-accent-deep" />
          <Swatch label="accent-bright" varName="--accent-bright" className="bg-accent-bright" />
          <Swatch label="accent-glow" varName="--accent-glow" className="bg-accent-glow" />
          <Swatch label="accent-soft" varName="--accent-soft" className="bg-accent-soft border!" />
          <Swatch label="accent-tint" varName="--accent-tint" className="bg-accent-tint border!" />
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">SIGNALS</p>
        <div className="grid grid-cols-3 gap-4">
          <Swatch label="signal-ok" varName="--signal-ok" className="bg-signal-ok" />
          <Swatch label="signal-warn" varName="--signal-warn" className="bg-signal-warn" />
          <Swatch label="signal-flag" varName="--signal-flag" className="bg-signal-flag" />
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">INK SCALE (text on light)</p>
        <div className="flex flex-col gap-2 p-4 bg-surface-1 rounded-xl border border-hair">
          {(["ink","ink-dim","ink-mute","ink-faint","ink-ghost"] as const).map((name) => (
            <div key={name} className="flex items-center gap-3">
              <span className={`font-mono text-[12px] w-20 text-${name}`}>--{name}</span>
              <span className={`t-body text-${name}`}>The quick brown fox jumps over the lazy dog</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
