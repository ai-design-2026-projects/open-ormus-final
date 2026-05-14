import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateToolToken } from "@/lib/agent/token";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const token = generateToolToken(user.id);
    return NextResponse.json({ token });
  } catch {
    return NextResponse.json({ error: "token_generation_failed" }, { status: 500 });
  }
}
