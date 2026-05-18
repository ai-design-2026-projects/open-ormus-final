import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const chipVariants = cva(
  "inline-flex items-center gap-1.5 h-[30px] px-3 rounded-full border font-medium text-[12.5px] cursor-pointer transition-all duration-[120ms] select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      active: {
        false: "bg-surface-1 border-hair-strong text-ink-dim hover:text-ink hover:border-ink-faint",
        true:  "bg-ink-panel border-ink-panel text-on-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]",
      },
    },
    defaultVariants: { active: false },
  }
)

export interface ChipProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">,
    VariantProps<typeof chipVariants> {
  children: React.ReactNode
  active?: boolean
  icon?: React.ReactNode
}

export function Chip({ children, active = false, icon, className, ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      data-state={active ? "on" : "off"}
      className={cn(chipVariants({ active }), className)}
      {...props}
    >
      {icon !== undefined && (
        <span className="inline-flex [&_svg]:size-[13px]">{icon}</span>
      )}
      {children}
    </button>
  )
}
