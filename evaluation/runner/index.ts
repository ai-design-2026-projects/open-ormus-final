import { join } from "node:path";
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
  const convsDir = join(runDir, "conversations");

  const total = config.runs.length;
  let failed = 0;

  for (const run of config.runs) {
    const label = `[${run.index}/${total}] ${run.scenario.id} · ${run.characters.map((c) => c.id).join(" + ")} · ${run.turns} turns`;
    process.stdout.write(`${label}… `);

    const aliasMap = buildAliasMap(run.characters.map((c) => c.name));
    const result = await runConversation(run, config.baseUrl, apiKey, aliasMap);

    try {
      writeConversation(convsDir, run.index, result);
    } catch (writeErr) {
      failed++;
      const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
      console.log(`✗ write error: ${msg}`);
      continue;
    }

    if (result.error) {
      failed++;
      console.log(`✗ ${result.error}`);
    } else {
      console.log("✓");
    }
  }

  console.log(`\n${total - failed}/${total} completed${failed > 0 ? `, ${failed} failed` : ""}.`);

  if (failed > 0) process.exit(1);
}
