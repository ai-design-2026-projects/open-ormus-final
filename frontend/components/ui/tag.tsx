import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const tagVariants = cva(
  "inline-flex items-center h-[22px] px-2 rounded-[6px] font-mono text-[10.5px] tracking-[0.03em] font-medium",
  {
    variants: {
      tone: {
        neutral:  "bg-surface-sunk text-ink-dim",
        accent:   "bg-accent-soft text-accent-deep",
        "on-ink": "bg-white/[0.08] text-on-ink-dim",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
)

export interface TagProps extends VariantProps<typeof tagVariants> {
  children: React.ReactNode
  className?: string
}

export function Tag({ children, tone, className }: TagProps) {
  return <span className={cn(tagVariants({ tone }), className)}>{children}</span>
}
