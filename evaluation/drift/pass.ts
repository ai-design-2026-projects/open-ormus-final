import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadDriftConfig } from "./config";
import { runDriftForConversation } from "./index";
import { initDriftOutputDir, writeConversationResults, writeSummary } from "./writer";
import { computeScenarioSummaries } from "./scoring";
import type { CharacterRecord, ScenarioRecord } from "../generator/config";
import type { ConversationResult } from "../generator/conversation";
import type { ConversationDriftResult } from "./types";

import rawCharacters from "../dataset/characters.yaml";
import rawScenarios from "../dataset/scenarios.yaml";

const ALL_CHARACTERS = rawCharacters as CharacterRecord[];
const ALL_SCENARIOS = rawScenarios as ScenarioRecord[];

export async function runDriftPass(configPath: string): Promise<void> {
  const rawConfigText = readFileSync(configPath, "utf-8");
  const config = loadDriftConfig(rawConfigText);
  const apiKey = process.env["LLM_API_KEY"]!;

  const outputDir = initDriftOutputDir(config.datasetDir, config.outputName, rawConfigText);

  try {
    const conversationsDir = join(config.datasetDir, "conversations");
    const files = readdirSync(conversationsDir).filter((f) => f.endsWith(".yaml")).sort();

    if (files.length === 0) {
      throw new Error(`No conversation YAML files found in ${conversationsDir}`);
    }

    // Parse all files synchronously upfront, then fan out LLM calls in parallel.
    const entries = files.map((file, i) => ({
      file,
      result: parseYaml(readFileSync(join(conversationsDir, file), "utf-8")) as ConversationResult,
      i,
    }));

    const processable = entries.filter(({ file, result, i }) => {
      if (!result.messages || result.messages.length === 0) {
        console.log(`[${i + 1}/${files.length}] ${file} — skipped (no messages)`);
        return false;
      }
      if (result.messages.length < config.segments) {
        console.log(`[${i + 1}/${files.length}] ${file} — skipped (${result.messages.length} turns < ${config.segments} segments)`);
        return false;
      }
      return true;
    });

    if (processable.length === 0) {
      throw new Error("No conversations were successfully processed.");
    }

    // On first failure Promise.all rejects immediately; sibling calls continue until
    // they complete or fail on their own — they cannot be cancelled from here.
    // The catch block removes the output dir regardless of how many finished.
    const allResults: ConversationDriftResult[] = await Promise.all(
      processable.map(async ({ file, result, i }) => {
        const scenario = ALL_SCENARIOS.find((s) => s.id === result.scenario_id);
        if (!scenario) throw new Error(`Scenario "${result.scenario_id}" not found (${file})`);

        const characters = result.characters.map((c) => {
          const found = ALL_CHARACTERS.find((r) => r.id === c.id);
          if (!found) throw new Error(`Character "${c.id}" not found (${file})`);
          return found;
        });

        const label = `[${i + 1}/${files.length}] ${result.scenario_id} · ${result.characters.map((c) => c.name).join(" + ")}`;
        console.log(`${label} — started`);
        try {
          const convResult = await runDriftForConversation(result, file, scenario, characters, config, apiKey);
          console.log(`${label} ✓`);
          return convResult;
        } catch (err) {
          throw new Error(`${label} failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
        }
      }),
    );

    writeConversationResults(outputDir, allResults);
    writeSummary(outputDir, computeScenarioSummaries(allResults));

    console.log(`\nDone. ${allResults.length} conversations processed. Results: ${outputDir}/`);
  } catch (err) {
    rmSync(outputDir, { recursive: true, force: true });
    console.error(`\nDrift pass failed — removed incomplete output: ${outputDir}`);
    throw err;
  }
}
