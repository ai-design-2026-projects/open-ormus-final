"use client"

import { useState } from "react"

const DURATIONS = [
  { name: "d-1", ms: 120, label: "120ms — micro-interactions" },
  { name: "d-2", ms: 220, label: "220ms — panel transitions" },
  { name: "d-3", ms: 360, label: "360ms — page overlays" },
  { name: "d-4", ms: 560, label: "560ms — dramatic reveals" },
]

export function MotionSection() {
  const [active, setActive] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-6">
      <p className="t-body-s text-ink-mute">
        Click a duration to preview. Easing: <span className="font-mono text-[12px]">cubic-bezier(0.22, 1, 0.36, 1)</span> (ease-out).
      </p>
      <div className="flex flex-col gap-4">
        {DURATIONS.map(({ name, ms, label }) => (
          <div key={name} className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => setActive(name)}
              className="t-meta w-24 text-left hover:text-ink-dim transition-colors"
            >
              --{name}
            </button>
            <div className="flex-1 h-8 bg-surface-sunk rounded-full relative overflow-hidden">
              <div
                className="absolute left-0 top-0 h-full bg-accent-oo rounded-full"
                style={{
                  width: active === name ? "100%" : "0%",
                  transitionProperty: "width",
                  transitionDuration: `${ms}ms`,
                  transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                }}
                onTransitionEnd={() => setActive(null)}
              />
            </div>
            <span className="t-meta w-48">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
