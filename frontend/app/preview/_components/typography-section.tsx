export function TypographySection() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        {(["t-h1","t-h2","t-h3","t-h4","t-h5","t-h6"] as const).map((cls) => (
          <div key={cls} className="flex items-baseline gap-4">
            <span className="t-meta w-12 shrink-0">{cls.replace("t-","h")}</span>
            <span className={cls}>Open<em className="t-editorial">Ormus</em></span>
          </div>
        ))}
      </div>
      <div className="hair" />
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline gap-4">
          <span className="t-meta w-12 shrink-0">body-l</span>
          <span className="t-body-l">A studio for creating fictional characters and simulating scenes between them.</span>
        </div>
        <div className="flex items-baseline gap-4">
          <span className="t-meta w-12 shrink-0">body</span>
          <span>A studio for creating fictional characters and simulating scenes between them.</span>
        </div>
        <div className="flex items-baseline gap-4">
          <span className="t-meta w-12 shrink-0">body-s</span>
          <span className="t-body-s">A studio for creating fictional characters and simulating scenes between them.</span>
        </div>
        <div className="flex items-baseline gap-4">
          <span className="t-meta w-12 shrink-0">mono</span>
          <span className="t-mono text-ink-dim">SESSION · 0x12AF · TURN 26 · STREAMING</span>
        </div>
        <div className="flex items-baseline gap-4">
          <span className="t-meta w-12 shrink-0">editorial</span>
          <span className="t-editorial text-[18px]">A foggy Victorian railway platform at dusk.</span>
        </div>
        <div className="flex items-baseline gap-4">
          <span className="t-meta w-12 shrink-0">meta</span>
          <span className="t-meta">CHARACTER · PUBLIC · COMPLETE · 94%</span>
        </div>
      </div>
      <div className="hair" />
      <div>
        <p className="t-meta mb-4">GEIST MONO — data, labels, code</p>
        <div className="p-4 bg-ink-panel rounded-xl text-on-ink font-mono text-[13px] leading-relaxed">
          <span className="text-on-ink-dim">SESSION</span> 0x12AF{" "}
          <span className="text-on-ink-dim">·</span>{" "}
          <span className="text-accent-bright">TURN 26</span>{" "}
          <span className="text-on-ink-dim">· STREAMING · SSE</span>
        </div>
      </div>
    </div>
  )
}
