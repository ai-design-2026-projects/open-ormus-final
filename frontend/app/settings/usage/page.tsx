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

  const summary = await getUsageSummary(user.id, period)

  return <UsageSummaryView summary={summary} period={period} />
}
