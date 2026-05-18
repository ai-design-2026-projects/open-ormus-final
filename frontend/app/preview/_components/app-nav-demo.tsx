import { Library, Clapperboard, FlaskConical, Network, Search, User } from "lucide-react"
import { Kbd } from "@/components/ui/kbd"
import { Monogram } from "@/components/ui/monogram"
import { IconButton } from "@/components/ui/icon-button"

const NAV_LINKS = [
  { label: "Library", icon: Library, active: true },
  { label: "Scenes", icon: Clapperboard, active: false },
  { label: "P-eval", icon: FlaskConical, active: false },
  { label: "MCP", icon: Network, active: false },
]

export function AppNavDemo() {
  return (
    <div className="bg-background border border-hair rounded-xl overflow-hidden shadow-[var(--shadow-2)]">
      <nav className="flex items-center gap-4 px-4 h-14 border-b border-hair">
        {/* Brand */}
        <div className="flex items-center gap-2 shrink-0">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
            <circle cx="10" cy="12" r="6.5" fill="none" stroke="var(--ink)" strokeWidth="1.4" />
            <circle cx="14" cy="12" r="6.5" fill="none" stroke="var(--accent-oo)" strokeWidth="1.4" />
          </svg>
          <span className="font-medium text-[15px] tracking-[-0.01em]">
            Open<em className="t-editorial">Ormus</em>
          </span>
        </div>

        {/* Nav links */}
        <div className="flex-1 flex items-center gap-0.5 px-4">
          {NAV_LINKS.map(({ label, icon: Icon, active }) => (
            <a
              key={label}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors duration-[120ms] cursor-pointer ${
                active
                  ? "bg-bg-tinted text-ink"
                  : "text-ink-mute hover:text-ink hover:bg-bg-tinted"
              }`}
            >
              <Icon className="size-4" strokeWidth={1.5} />
              {label}
            </a>
          ))}
        </div>

        {/* Right: search + avatar */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-2 h-8 px-3 rounded-lg bg-bg-tinted border border-hair text-ink-mute text-[12.5px] cursor-text">
            <Search className="size-3.5" strokeWidth={1.5} />
            <span>Ask or search…</span>
            <Kbd>⌘K</Kbd>
          </div>
          <IconButton aria-label="Profile" variant="ghost">
            <User strokeWidth={1.5} />
          </IconButton>
          <Monogram name="Sherlock Holmes" size={28} />
        </div>
      </nav>
      <div className="p-4 text-center t-meta text-ink-faint">App content area</div>
    </div>
  )
}
