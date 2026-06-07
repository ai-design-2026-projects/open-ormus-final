import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { createClient } from "@/lib/supabase/server";
import { isEmailAllowed, getResultsBasePath } from "@/lib/eval-access";
import { aggregateCostRecords } from "./utils";
import type { CostRecord } from "./utils";

type Params = { dataset: string; evalName: string };

const PASS_FILES: Record<string, string> = {
  generation: "costs/generation.yaml",
  judge_guessing: "costs/judge_guessing.yaml",
  reconstruct_persona: "costs/reconstruct_persona.yaml",
  context_drift: "costs/context_drift.yaml",
};

function loadPassRecords(evalDir: string, passFile: string): CostRecord[] | null {
  const filePath = join(evalDir, passFile);
  if (!existsSync(filePath)) return null;
  const parsed = parseYaml(readFileSync(filePath, "utf-8")) as { records?: CostRecord[] };
  return parsed.records ?? [];
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<Params> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isEmailAllowed(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { dataset, evalName } = await params;
  const base = getResultsBasePath();
  const evalDir = join(base, dataset, evalName);

  if (!existsSync(evalDir)) {
    return NextResponse.json({ error: "Eval not found" }, { status: 404 });
  }

  const passes: Record<string, ReturnType<typeof aggregateCostRecords>> = {};
  let grandTotalCostUsd: number | null = 0;
  let grandTotalInputTokens = 0;
  let grandTotalOutputTokens = 0;

  for (const [passKey, passFile] of Object.entries(PASS_FILES)) {
    const records = loadPassRecords(evalDir, passFile);
    if (records === null) continue;
    const agg = aggregateCostRecords(records);
    passes[passKey] = agg;

    if (agg.totalCostUsd === null) grandTotalCostUsd = null;
    if (grandTotalCostUsd !== null) grandTotalCostUsd += agg.totalCostUsd ?? 0;
    grandTotalInputTokens += agg.totalInputTokens;
    grandTotalOutputTokens += agg.totalOutputTokens;
  }

  return NextResponse.json({
    passes,
    grandTotal: {
      costUsd: grandTotalCostUsd,
      inputTokens: grandTotalInputTokens,
      outputTokens: grandTotalOutputTokens,
    },
  });
}
