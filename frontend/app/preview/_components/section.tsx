import { cn } from "@/lib/utils"

interface SectionProps {
  id: string
  kicker: string
  children: React.ReactNode
  className?: string
}

export function Section({ id, kicker, children, className }: SectionProps) {
  return (
    <section id={id} className={cn("scroll-mt-8", className)}>
      <div className="flex items-center gap-3 mb-6">
        <span className="t-meta">{kicker}</span>
        <div className="flex-1 hair" />
      </div>
      {children}
    </section>
  )
}
