import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getUsageSummary } from "./utils"
import type { Period } from "./types"

const VALID_PERIODS = new Set<string>(["today", "7d", "30d", "all"])

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (!user || error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rawPeriod = req.nextUrl.searchParams.get("period") ?? "7d"
  if (!VALID_PERIODS.has(rawPeriod)) {
    return NextResponse.json({ error: "Invalid period" }, { status: 400 })
  }

  const summary = await getUsageSummary(user.id, rawPeriod as Period)
  return NextResponse.json(summary)
}
