import { cn } from "@/lib/utils"

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode
}

export function Kbd({ children, className, ...props }: KbdProps) {
  return (
    <kbd
      className={cn(
        "font-mono text-[10.5px] bg-surface-2 border border-hair-strong rounded-[5px] px-1.5 py-px text-ink-dim shadow-[inset_0_-1px_0_var(--hair-strong)]",
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  )
}
