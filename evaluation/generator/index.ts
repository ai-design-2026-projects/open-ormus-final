import { join } from "node:path";
import { rmSync } from "node:fs";
import { loadConfig } from "./config";
import type { ValidatedRun } from "./config";
import { runConversation } from "./conversation";
import { initOutputDir, writeConversation } from "./writer";
import { buildAliasMap } from "../judge/alias";
import { CostTracker } from "../cost/tracker";
import { fetchPassCosts } from "../cost/fetcher";

const MAX_ATTEMPTS = 3;

async function executeRun(
  run: ValidatedRun,
  total: number,
  convsDir: string,
  baseUrl: string,
  apiKey: string,
  tracker: CostTracker,
): Promise<void> {
  const label = `[${run.index}/${total}] ${run.scenario.id} · ${run.characters.map((c) => c.id).join(" + ")} · ${run.turns} turns`;
  const aliasMap = buildAliasMap(run.characters.map((c) => c.name));
  console.log(`${label} — started`);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await runConversation(run, baseUrl, apiKey, aliasMap, tracker);
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

  console.log(`Generating dataset: ${config.datasetDir}`);
  const datasetDir = initOutputDir(process.env.EVAL_RESULTS_PATH!, config);
  const tracker = new CostTracker();

  try {
    const convsDir = join(datasetDir, "conversations");
    const total = config.runs.length;
    await Promise.all(
      config.runs.map((run) => executeRun(run, total, convsDir, config.baseUrl, apiKey, tracker)),
    );

    const costsPath = join(datasetDir, "costs", "generation.yaml");
    await tracker.flush(costsPath);
    try { await fetchPassCosts(costsPath); } catch (err) {
      process.stderr.write(`[costs] Cost fetch failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }

    console.log(`\nCompleted. Dataset: ${datasetDir}`);
  } catch (err) {
    rmSync(datasetDir, { recursive: true, force: true });
    console.error(`\nDataset generation failed — removed incomplete directory: ${datasetDir}`);
    throw err;
  }
}
