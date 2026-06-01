import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

type BadgeTone =
  | "accent"
  | "ok"
  | "warn"
  | "flag"
  | "neutral"
  | "ink"
  | "on-ink"

const toneClasses: Record<BadgeTone, string> = {
  neutral: "bg-surface-sunk text-ink-dim border-hair",
  accent:
    "bg-accent-soft text-accent-deep border-[color-mix(in_oklch,var(--accent-oo)_16%,transparent)]",
  ok: "bg-[color-mix(in_oklch,var(--signal-ok)_12%,var(--surface-1))] text-signal-ok border-transparent",
  warn: "bg-[color-mix(in_oklch,var(--signal-warn)_14%,var(--surface-1))] text-[oklch(0.45_0.16_78)] border-transparent",
  flag: "bg-[color-mix(in_oklch,var(--signal-flag)_12%,var(--surface-1))] text-signal-flag border-transparent",
  ink: "bg-ink-panel text-on-ink border-transparent",
  "on-ink": "bg-[rgba(255,255,255,0.10)] text-on-ink border-hair-on-ink",
}

type BadgeProps = useRender.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    tone?: BadgeTone
    mono?: boolean
    dot?: boolean
  }

function Badge({
  className,
  variant = "default",
  tone,
  mono,
  dot,
  render,
  children,
  ...props
}: BadgeProps) {
  const baseClass = tone
    ? cn(
        // strip variant's bg/text/border by applying tone classes last
        "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
        toneClasses[tone]
      )
    : badgeVariants({ variant })

  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(
          baseClass,
          mono && "font-mono text-[10.5px] tracking-[0.04em] uppercase",
          className
        ),
        children: (
          <>
            {dot && (
              <span className="size-1.5 rounded-full bg-current shadow-[0_0_0_3px_color-mix(in_oklch,currentColor_20%,transparent)]" />
            )}
            {children}
          </>
        ),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
      tone,
    },
  })
}

export { Badge, badgeVariants }
