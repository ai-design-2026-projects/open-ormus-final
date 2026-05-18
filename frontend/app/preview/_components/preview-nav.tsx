"use client"

import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { id: "colors",         label: "01 · Colors" },
  { id: "typography",     label: "02 · Typography" },
  { id: "spacing",        label: "03 · Spacing & Radii" },
  { id: "elevation",      label: "04 · Elevation" },
  { id: "motion",         label: "05 · Motion" },
  { id: "buttons",        label: "06 · Buttons" },
  { id: "inputs",         label: "07 · Inputs" },
  { id: "badges",         label: "08 · Badges & Tags" },
  { id: "monograms",      label: "09 · Monograms" },
  { id: "character-card", label: "10 · Character card" },
  { id: "screenplay",     label: "11 · Screenplay" },
  { id: "sheet-field",    label: "12 · Sheet field" },
  { id: "cast-state",     label: "13 · Cast state" },
  { id: "emotion-dots",   label: "14 · Emotion dots" },
  { id: "session-row",    label: "15 · Session row" },
  { id: "app-nav",        label: "16 · App nav" },
]

export function PreviewNav() {
  return (
    <nav className="sticky top-8 flex flex-col gap-0.5 w-[200px] shrink-0">
      <span className="t-meta mb-3">CONTENTS</span>
      {NAV_ITEMS.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          onClick={(e) => {
            e.preventDefault()
            document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth" })
          }}
          className={cn("t-body-s text-ink-mute hover:text-ink transition-colors duration-[120ms] py-0.5")}
        >
          {item.label}
        </a>
      ))}
    </nav>
  )
}
