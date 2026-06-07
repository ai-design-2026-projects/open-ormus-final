import { NextRequest, NextResponse } from "next/server";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { createClient } from "@/lib/supabase/server";
import { isEmailAllowed, getResultsBasePath } from "@/lib/eval-access";

type Params = { dataset: string; evalName: string; pass: string };

const VALID_PASSES = new Set(["conversations", "judge_guessing", "reconstruct_persona", "context_drift"]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<Params> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isEmailAllowed(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { dataset, evalName, pass } = await params;

  if (!VALID_PASSES.has(pass)) {
    return NextResponse.json({ error: "Invalid pass" }, { status: 400 });
  }

  const base = getResultsBasePath();
  const evalDir = join(base, dataset, evalName);

  if (!existsSync(evalDir)) {
    return NextResponse.json({ error: "Eval not found" }, { status: 404 });
  }

  try {
    if (pass === "conversations") {
      const convsDir = join(base, dataset, "conversations");
      if (!existsSync(convsDir)) return NextResponse.json([]);
      const files = readdirSync(convsDir).filter((f) => f.endsWith(".yaml")).sort();
      const conversations = files.map((f) =>
        parseYaml(readFileSync(join(convsDir, f), "utf-8"))
      );
      return NextResponse.json(conversations);
    }

    if (pass === "judge_guessing") {
      const resultPath = join(evalDir, "judge_guessing", "guessing_result.yaml");
      if (!existsSync(resultPath)) return NextResponse.json(null);
      return NextResponse.json(parseYaml(readFileSync(resultPath, "utf-8")));
    }

    if (pass === "reconstruct_persona") {
      const outputDir = join(evalDir, "reconstruct_persona");
      if (!existsSync(outputDir)) return NextResponse.json(null);
      const convsDir = join(outputDir, "conversations");
      const files = existsSync(convsDir)
        ? readdirSync(convsDir).filter((f) => f.endsWith(".yaml")).sort()
        : [];
      const conversations = files.map((f) =>
        parseYaml(readFileSync(join(convsDir, f), "utf-8"))
      );
      const summaryPath = join(outputDir, "summary.yaml");
      const summary = existsSync(summaryPath)
        ? parseYaml(readFileSync(summaryPath, "utf-8"))
        : null;
      return NextResponse.json({ conversations, summary });
    }

    if (pass === "context_drift") {
      const outputDir = join(evalDir, "context_drift");
      if (!existsSync(outputDir)) return NextResponse.json(null);
      const resultsPath = join(outputDir, "conversation_results.yaml");
      const summaryPath = join(outputDir, "summary.yaml");
      const conversations = existsSync(resultsPath)
        ? parseYaml(readFileSync(resultsPath, "utf-8"))
        : [];
      const summary = existsSync(summaryPath)
        ? parseYaml(readFileSync(summaryPath, "utf-8"))
        : null;
      return NextResponse.json({ conversations, summary });
    }
  } catch {
    return NextResponse.json({ error: "Failed to read pass data" }, { status: 500 });
  }

  return NextResponse.json({ error: "Unknown pass" }, { status: 400 });
}
