import { join } from "node:path";
import { rmSync } from "node:fs";
import { loadConfig } from "./config";
import { runConversation } from "./conversation";
import { initOutputDir, writeConversation } from "./writer";
import { buildAliasMap } from "../judge/alias";

export async function runEvaluation(configPath: string): Promise<void> {
  // loadConfig validates everything upfront — throws on any error
  const config = loadConfig(configPath);

  const apiKey = process.env["LLM_API_KEY"]!; // already validated by loadConfig
  const resultsBase = join(process.cwd(), "evaluation", "results");
  const runDir = initOutputDir(resultsBase, config.outputDir, config.rawConfigText);

  try {
    const convsDir = join(runDir, "conversations");
    const total = config.runs.length;
    const MAX_ATTEMPTS = 3;

    for (const run of config.runs) {
      const label = `[${run.index}/${total}] ${run.scenario.id} · ${run.characters.map((c) => c.id).join(" + ")} · ${run.turns} turns`;
      process.stdout.write(`${label}… `);

      const aliasMap = buildAliasMap(run.characters.map((c) => c.name));

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const result = await runConversation(run, config.baseUrl, apiKey, aliasMap);
          writeConversation(convsDir, run.index, result);
          console.log("✓");
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (attempt < MAX_ATTEMPTS) {
            process.stdout.write(`✗ attempt ${attempt}/${MAX_ATTEMPTS} (${msg}) — retrying… `);
          } else {
            throw new Error(`${label} failed after ${MAX_ATTEMPTS} attempts: ${msg}`);
          }
        }
      }
    }
    console.log(`\nCompleted.`);
  } catch (err) {
    rmSync(runDir, { recursive: true, force: true });
    console.error(`\nDataset generation failed — removed incomplete directory: ${runDir}`);
    throw err;
  }
}
