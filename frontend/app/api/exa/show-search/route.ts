import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ShowSearchInputSchema, showSearchHandler } from "@open-ormus/shared";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = ShowSearchInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  const result = await showSearchHandler(parsed.data);
  if ("error" in result) return NextResponse.json(result, { status: 502 });
  return NextResponse.json(result);
}
