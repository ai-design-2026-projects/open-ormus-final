import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const iconButtonVariants = cva(
  "inline-flex items-center justify-center border border-transparent cursor-pointer transition-all duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        ghost:    "rounded-[10px] bg-transparent text-ink-dim hover:bg-[color-mix(in_oklch,var(--ink)_5%,transparent)] hover:text-ink",
        bordered: "rounded-[10px] bg-surface-1 border-hair-strong text-ink-dim hover:border-ink-faint",
        "on-ink": "rounded-[10px] bg-transparent text-on-ink-dim hover:bg-white/[0.08] hover:text-on-ink",
      },
      size: {
        sm: "size-7 [&_svg]:size-4",
        md: "size-9 [&_svg]:size-4",
        lg: "size-11 rounded-[12px] [&_svg]:size-[18px]",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  }
)

export interface IconButtonProps
  extends ButtonPrimitive.Props,
    VariantProps<typeof iconButtonVariants> {
  "aria-label": string
}

export function IconButton({ variant, size, className, children, ...props }: IconButtonProps) {
  return (
    <ButtonPrimitive
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </ButtonPrimitive>
  )
}
