import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { IconButton } from "@/components/ui/icon-button"
import { Search, Plus, Play, Square, X } from "lucide-react"

export function ButtonsSection() {
  return (
    <div className="flex flex-col gap-10">
      <div>
        <p className="t-meta mb-4">BUTTON VARIANTS</p>
        <div className="flex flex-wrap gap-3">
          <Button variant="default">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Danger</Button>
          <Button variant="link">Link</Button>
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">SIZES</p>
        <div className="flex items-center gap-3">
          <Button size="xs">Extra small</Button>
          <Button size="sm">Small</Button>
          <Button size="default">Default</Button>
          <Button size="lg">Large</Button>
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">WITH ICONS</p>
        <div className="flex flex-wrap gap-3">
          <Button><Play className="size-4" strokeWidth={1.5} /> Start scene</Button>
          <Button variant="secondary"><Plus className="size-4" strokeWidth={1.5} /> New character</Button>
          <Button variant="ghost"><Search className="size-4" strokeWidth={1.5} /> Search</Button>
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">ICON BUTTONS</p>
        <div className="flex items-center gap-3">
          <IconButton aria-label="Search" variant="ghost" size="sm"><Search strokeWidth={1.5} /></IconButton>
          <IconButton aria-label="Add" variant="ghost"><Plus strokeWidth={1.5} /></IconButton>
          <IconButton aria-label="Search" variant="bordered"><Search strokeWidth={1.5} /></IconButton>
          <div className="bg-ink-panel rounded-xl p-3 flex gap-2">
            <IconButton aria-label="Play" variant="on-ink"><Play strokeWidth={1.5} /></IconButton>
            <IconButton aria-label="Stop" variant="on-ink"><Square strokeWidth={1.5} /></IconButton>
          </div>
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">DISABLED STATE</p>
        <div className="flex gap-3">
          <Button disabled>Primary</Button>
          <Button variant="secondary" disabled>Secondary</Button>
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">CHIP (toggleable)</p>
        <div className="flex gap-2 flex-wrap">
          <Chip active icon={<Play strokeWidth={1.5} />}>All · 8</Chip>
          <Chip icon={<X strokeWidth={1.5} />}>Public · 5</Chip>
          <Chip>Personal · 3</Chip>
          <Chip>Drafts · 2</Chip>
        </div>
      </div>
    </div>
  )
}
