import { cn } from "@/lib/utils"

export interface RingProps {
  value: number
  size?: number
  stroke?: number
  color?: string
  track?: string
  className?: string
}

export function Ring({
  value,
  size = 36,
  stroke = 3,
  color = "var(--accent-oo)",
  track = "var(--hair-strong)",
  className,
}: RingProps) {
  const clamped = Math.max(0, Math.min(100, value))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const off = c - (clamped / 100) * c
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={stroke}
        strokeDasharray={c} strokeDashoffset={off}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  )
}
