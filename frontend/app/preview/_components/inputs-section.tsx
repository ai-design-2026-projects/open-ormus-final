"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FieldLabel } from "@/components/ui/field-label"
import { Segmented } from "@/components/ui/segmented"
import { Search } from "lucide-react"

export function InputsSection() {
  const [view, setView] = useState("grid")
  const [tone, setTone] = useState("balanced")

  return (
    <div className="flex flex-col gap-10">
      <div>
        <p className="t-meta mb-4">TEXT INPUT</p>
        <div className="flex flex-col gap-4 max-w-sm">
          <div>
            <FieldLabel htmlFor="name-input" hint="Required">Character name</FieldLabel>
            <Input id="name-input" placeholder="e.g. Sherlock Holmes" />
          </div>
          <div>
            <FieldLabel htmlFor="search-input">Search</FieldLabel>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ink-faint" strokeWidth={1.5} />
              <Input id="search-input" placeholder="Filter by name, trait…" className="pl-9" />
            </div>
          </div>
          <div>
            <FieldLabel htmlFor="disabled-input">Disabled</FieldLabel>
            <Input id="disabled-input" placeholder="Not editable" disabled />
          </div>
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">TEXTAREA</p>
        <div className="max-w-sm">
          <FieldLabel htmlFor="bio-input" hint="0 / 500">Short biography</FieldLabel>
          <Textarea id="bio-input" placeholder="Describe the character's background…" rows={4} />
        </div>
      </div>
      <div>
        <p className="t-meta mb-4">SEGMENTED CONTROL</p>
        <div className="flex flex-col gap-3">
          <Segmented
            value={view}
            onValueChange={setView}
            options={[{ value: "grid", label: "Grid" }, { value: "list", label: "List" }, { value: "table", label: "Table" }]}
          />
          <Segmented
            size="sm"
            value={tone}
            onValueChange={setTone}
            options={[
              { value: "balanced", label: "Balanced" },
              { value: "faithful", label: "Faithful" },
              { value: "creative", label: "Creative" },
            ]}
          />
        </div>
      </div>
    </div>
  )
}
