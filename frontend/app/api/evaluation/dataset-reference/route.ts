import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { createClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/eval-access";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isEmailAllowed(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const datasetBase = join(process.cwd(), "../evaluation/dataset");
    const characters = parseYaml(readFileSync(join(datasetBase, "characters.yaml"), "utf-8"));
    const scenarios = parseYaml(readFileSync(join(datasetBase, "scenarios.yaml"), "utf-8"));
    return NextResponse.json({ characters, scenarios });
  } catch {
    return NextResponse.json({ error: "Failed to read dataset files" }, { status: 500 });
  }
}
