import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isEmailAllowed, listDatasets } from "@/lib/eval-access";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isEmailAllowed(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const datasets = listDatasets();
    return NextResponse.json(datasets);
  } catch {
    return NextResponse.json({ error: "Failed to read results directory" }, { status: 500 });
  }
}
