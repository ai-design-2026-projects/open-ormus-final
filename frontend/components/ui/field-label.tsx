import { cn } from "@/lib/utils"

export interface FieldLabelProps {
  children: React.ReactNode
  hint?: string
  htmlFor?: string
  className?: string
}

export function FieldLabel({ children, hint, htmlFor, className }: FieldLabelProps) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn("flex items-baseline justify-between gap-2 mb-1.5", className)}
    >
      <span className="t-meta t-meta-bright">{children}</span>
      {hint !== undefined && <span className="t-meta text-ink-faint">{hint}</span>}
    </label>
  )
}
