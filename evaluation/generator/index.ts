import { join } from "node:path";
import { rmSync } from "node:fs";
import { loadConfig } from "./config";
import type { ValidatedRun } from "./config";
import { runConversation } from "./conversation";
import { initOutputDir, writeConversation } from "./writer";
import { buildAliasMap } from "../judge/alias";

const MAX_ATTEMPTS = 3;

async function executeRun(
  run: ValidatedRun,
  total: number,
  convsDir: string,
  baseUrl: string,
  apiKey: string,
): Promise<void> {
  const label = `[${run.index}/${total}] ${run.scenario.id} · ${run.characters.map((c) => c.id).join(" + ")} · ${run.turns} turns`;
  const aliasMap = buildAliasMap(run.characters.map((c) => c.name));

  console.log(`${label} — started`);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await runConversation(run, baseUrl, apiKey, aliasMap);
      writeConversation(convsDir, run.index, result);
      console.log(`${label} ✓`);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS) {
        console.log(`${label} ✗ attempt ${attempt}/${MAX_ATTEMPTS} (${msg}) — retrying`);
      } else {
        throw new Error(`${label} failed after ${MAX_ATTEMPTS} attempts: ${msg}`, { cause: err });
      }
    }
  }
}

export async function generateDataset(configPath: string): Promise<void> {
  const config = loadConfig(configPath);
  const apiKey = process.env["LLM_API_KEY"]!;
  const resultsBase = join(process.cwd(), "evaluation", "results");
  const runDir = initOutputDir(resultsBase, config.outputDir, config.rawConfigText);

  try {
    const convsDir = join(runDir, "conversations");
    const total = config.runs.length;

    // On first failure Promise.all rejects immediately; sibling runs continue until
    // they complete or fail on their own — they cannot be cancelled from here.
    // The catch block deletes the output dir regardless of how many runs finished.
    await Promise.all(
      config.runs.map((run) => executeRun(run, total, convsDir, config.baseUrl, apiKey)),
    );

    console.log("Completed.");
  } catch (err) {
    rmSync(runDir, { recursive: true, force: true });
    console.error(`\nDataset generation failed — removed incomplete directory: ${runDir}`);
    throw err;
  }
}
