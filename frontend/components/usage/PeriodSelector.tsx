"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Segmented } from "@/components/ui/segmented"
import type { Period } from "@/app/api/usage/summary/types"

const OPTIONS: ReadonlyArray<{ value: Period; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All time" },
]

export function PeriodSelector({ period }: { period: Period }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function handleChange(v: string) {
    const params = new URLSearchParams(searchParams)
    params.set("period", v)
    router.push(`/settings/usage?${params.toString()}`)
  }

  return <Segmented value={period} onValueChange={handleChange} options={OPTIONS} />
}
