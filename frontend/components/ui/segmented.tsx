"use client"

import { cva } from "class-variance-authority"
import { cn } from "@/lib/utils"

const containerVariants = cva(
  "inline-flex bg-surface-sunk border border-hair rounded-lg gap-0.5",
  { variants: { size: { md: "p-[3px]", sm: "p-[2px]" } }, defaultVariants: { size: "md" } }
)

const itemVariants = cva(
  "inline-flex items-center gap-1.5 rounded-[8px] font-medium cursor-pointer text-ink-mute transition-all duration-[120ms] select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:shrink-0",
  {
    variants: {
      size: {
        md: "px-3 py-1.5 text-[12.5px] [&_svg]:size-[14px]",
        sm: "px-2.5 py-1 text-[12px] [&_svg]:size-[13px]",
      },
      active: {
        true:  "bg-surface-2 text-ink shadow-[var(--shadow-1),0_0_0_1px_var(--hair-strong)]",
        false: "hover:text-ink",
      },
    },
    defaultVariants: { size: "md", active: false },
  }
)

export interface SegmentedOption {
  value: string
  label: string
  icon?: React.ReactNode
}

export interface SegmentedProps {
  value: string
  onValueChange: (v: string) => void
  options: ReadonlyArray<SegmentedOption>
  size?: "md" | "sm"
  className?: string
}

export function Segmented({ value, onValueChange, options, size = "md", className }: SegmentedProps) {
  return (
    <div className={cn(containerVariants({ size }), className)} role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onValueChange(o.value)}
          className={itemVariants({ size, active: o.value === value })}
        >
          {o.icon !== undefined && <span className="inline-flex">{o.icon}</span>}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  )
}
