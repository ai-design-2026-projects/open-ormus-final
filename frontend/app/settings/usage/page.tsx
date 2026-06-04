import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getUsageSummary } from "@/app/api/usage/summary/utils"
import { UsageSummaryView } from "@/components/usage/UsageSummaryView"
import type { Period } from "@/app/api/usage/summary/types"

const VALID_PERIODS = new Set<string>(["today", "7d", "30d", "all"])

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { period: rawPeriod } = await searchParams
  const period = (VALID_PERIODS.has(rawPeriod ?? "") ? rawPeriod : "7d") as Period

  let summary
  try {
    summary = await getUsageSummary(user.id, period)
  } catch {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-[560px] mx-auto px-6 md:px-0 py-16 text-center">
          <p className="t-h6 m-0 text-ink-dim">Couldn&apos;t load usage data</p>
          <p className="t-body-s text-ink-mute mt-2">Something went wrong fetching your stats. Try refreshing.</p>
        </div>
      </div>
    )
  }

  return <UsageSummaryView summary={summary} period={period} />
}
