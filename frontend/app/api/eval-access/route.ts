import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/eval-access";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const allowed = Boolean(user?.email && isEmailAllowed(user.email));
  return NextResponse.json({ allowed });
}
