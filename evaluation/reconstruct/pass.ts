import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadReconstructConfig } from "./config";
import { runReconstructionForConversation } from "./index";
import { initReconstructOutputDir, writeReconstructResults, writeSummary } from "./writer";
import { computeSummary } from "./scoring";
import { CostTracker } from "../cost/tracker";
import { fetchPassCosts } from "../cost/fetcher";
import type { CharacterRecord, ScenarioRecord } from "../generator/config";
import type { ConversationResult } from "../generator/conversation";
import type { ConversationReconstructionResult } from "./types";
import { ProgressReporter } from "../progress";

import rawCharacters from "../dataset/characters.yaml";
import rawScenarios from "../dataset/scenarios.yaml";

const ALL_CHARACTERS = rawCharacters as CharacterRecord[];
const ALL_SCENARIOS = rawScenarios as ScenarioRecord[];

export async function runReconstructionPass(configPath: string, evalName: string): Promise<void> {
  const rawConfigText = readFileSync(configPath, "utf-8");
  const config = loadReconstructConfig(rawConfigText, evalName);
  const apiKey = process.env["LLM_API_KEY"]!;

  const outputDir = initReconstructOutputDir(config.evalDir, config);
  const tracker = new CostTracker();

  try {
    const { conversationsDir } = config;
    const files = readdirSync(conversationsDir).filter((f) => f.endsWith(".yaml")).sort();

    if (files.length === 0) {
      throw new Error(`No conversation YAML files found in ${conversationsDir}`);
    }

    const entries = files.map((file, i) => ({
      file,
      result: parseYaml(readFileSync(join(conversationsDir, file), "utf-8")) as ConversationResult,
      i,
    }));

    const processable = entries.filter(({ file, result, i }) => {
      if (!result.messages || result.messages.length === 0) {
        console.log(`[${i + 1}/${files.length}] ${file} — skipped (failed conversation)`);
        return false;
      }
      return true;
    });

    if (processable.length === 0) {
      throw new Error("No processable conversations found — all files were skipped or empty.");
    }

    const progress = new ProgressReporter("reconstruct", processable.length);

    let allResults: ConversationReconstructionResult[];
    try {
      allResults = await Promise.all(
        processable.map(async ({ file, result }, idx) => {
          const scenario = ALL_SCENARIOS.find((s) => s.id === result.scenario_id);
          if (!scenario) throw new Error(`Scenario "${result.scenario_id}" not found (from ${file})`);

          const characters = result.characters.map((c) => {
            const found = ALL_CHARACTERS.find((r) => r.id === c.id);
            if (!found) throw new Error(`Character "${c.id}" not found (from ${file})`);
            return found;
          });

          const label = `[${idx + 1}/${processable.length}] ${result.scenario_id} · ${result.characters.map((c) => c.name).join(" + ")}`;
          const conversationId = file.replace(".yaml", "");

          const buf = progress.itemBuffer();
          buf.push(`${label} — started\n`);
          try {
            const convResult = await runReconstructionForConversation(
              result, file, scenario, characters, config, apiKey, tracker, conversationId,
              (line) => buf.push(line),
            );
            buf.push(`${label} ✓\n`);
            return convResult;
          } catch (err) {
            throw new Error(`${label} failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
          } finally {
            progress.tick();
          }
        }),
      );
    } finally {
      progress.flush();
    }

    writeReconstructResults(outputDir, allResults);
    writeSummary(outputDir, computeSummary(allResults, config.comparators.map((c) => c.model), config.segments));

    const costsPath = join(config.evalDir, "costs", "reconstruct_persona.yaml");
    await tracker.flush(costsPath);
    try { await fetchPassCosts(costsPath); } catch (err) {
      process.stderr.write(`[costs] Cost fetch failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }

    console.log(`\nDone. Results written to ${outputDir}/`);
  } catch (err) {
    rmSync(outputDir, { recursive: true, force: true });
    console.error(`\nReconstruction failed — removed incomplete output: ${outputDir}`);
    throw err;
  }
}
