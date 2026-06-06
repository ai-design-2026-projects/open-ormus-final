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
  const resultsBase = join(process.cwd(), "evaluation", "results");
  const config = loadConfig(configPath, resultsBase);
  const apiKey = process.env["LLM_API_KEY"]!;

  console.log(`Starting eval run: ${config.datasetDir}/${config.evalName}`);
  const evalDir = initOutputDir(resultsBase, config);

  try {
    const convsDir = join(evalDir, "conversations");
    const total = config.runs.length;
    await Promise.all(
      config.runs.map((run) => executeRun(run, total, convsDir, config.baseUrl, apiKey)),
    );
    console.log(`\nCompleted. Results: ${evalDir}`);
  } catch (err) {
    rmSync(evalDir, { recursive: true, force: true });
    console.error(`\nDataset generation failed — removed incomplete directory: ${evalDir}`);
    throw err;
  }
}
