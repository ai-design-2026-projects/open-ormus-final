import { cn } from "@/lib/utils"
import type { CSSProperties } from "react"

export type MonogramShape = "rounded" | "circle" | "squircle" | "hexagon" | "shield" | "diamond"
export type MonogramStatus = "ok" | "warn" | "flag" | "public"

export interface MonogramProps {
  name: string
  size?: number
  shape?: MonogramShape
  status?: MonogramStatus
  ring?: boolean
  flat?: boolean
  className?: string
}

function hashHue(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) h = ((h * 31 + str.charCodeAt(i)) >>> 0)
  return h % 360
}

const SHAPES: Record<MonogramShape, CSSProperties> = {
  rounded:  { borderRadius: "var(--r-md)" },
  circle:   { borderRadius: "50%" },
  squircle: { borderRadius: "28%" },
  hexagon:  { borderRadius: 0, clipPath: "polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)" },
  shield:   { borderRadius: 0, clipPath: "polygon(0% 0%,100% 0%,100% 70%,50% 100%,0% 70%)" },
  diamond:  { borderRadius: 0, clipPath: "polygon(50% 0%,100% 50%,50% 100%,0% 50%)" },
}

const STATUS_COLOR: Record<MonogramStatus, string> = {
  ok:     "var(--signal-ok)",
  warn:   "var(--signal-warn)",
  flag:   "var(--signal-flag)",
  public: "var(--accent-bright)",
}

export function Monogram({
  name,
  size = 56,
  shape = "rounded",
  status,
  ring = false,
  flat = false,
  className,
}: MonogramProps) {
  const parts = name.split(/\s+/).slice(0, 2)
  const initials = parts.map((w) => w[0] ?? "").join("").toUpperCase() || "?"
  const hue = hashHue(name)
  const hueB = (hue + 38) % 360
  const background = flat
    ? `oklch(0.28 0.12 ${hue})`
    : `linear-gradient(135deg, oklch(0.32 0.14 ${hue}) 0%, oklch(0.22 0.10 ${hueB}) 100%)`
  const glowColor = `oklch(0.78 0.16 ${hue})`

  return (
    <div
      className={cn(
        "relative inline-flex items-center justify-center shrink-0 overflow-hidden text-white",
        ring
          ? "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),inset_0_-1px_0_rgba(0,0,0,0.20),0_0_0_2px_var(--accent-oo),0_0_0_5px_color-mix(in_oklch,var(--accent-oo)_20%,transparent)]"
          : "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),inset_0_-1px_0_rgba(0,0,0,0.20),0_1px_3px_rgba(20,24,40,0.10)]",
        className,
      )}
      style={{ width: size, height: size, background, ...SHAPES[shape] }}
    >
      {!flat && (
        <span
          className="absolute inset-0 opacity-70 mix-blend-screen pointer-events-none"
          style={{ background: `radial-gradient(circle at 30% 25%, ${glowColor} 0%, transparent 60%)` }}
        />
      )}
      {!flat && (
        <span
          className="absolute inset-0 opacity-60 pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(180deg,transparent 0,transparent 5px,rgba(255,255,255,0.04) 5px,rgba(255,255,255,0.04) 6px)",
          }}
        />
      )}
      <span
        className="relative z-10 font-mono font-medium tracking-[0.02em] [text-shadow:0_1px_0_rgba(0,0,0,0.25)]"
        style={{ fontSize: size * 0.36 }}
      >
        {initials}
      </span>
      {status !== undefined && (
        <span
          className="absolute right-1 bottom-1 z-20 size-2.5 rounded-full shadow-[0_0_0_2px_var(--surface-1)]"
          style={{ background: STATUS_COLOR[status] }}
        />
      )}
    </div>
  )
}
