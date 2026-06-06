import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadDriftConfig } from "./config";
import { runDriftForConversation } from "./index";
import { initDriftOutputDir, writeConversationResults, writeSummary } from "./writer";
import { computeScenarioSummaries } from "./scoring";
import type { CharacterRecord, ScenarioRecord } from "../runner/config";
import type { ConversationResult } from "../runner/conversation";
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
    const files = readdirSync(conversationsDir)
      .filter((f) => f.endsWith(".yaml"))
      .sort();

    if (files.length === 0) {
      throw new Error(`No conversation YAML files found in ${conversationsDir}`);
    }

    const allResults: ConversationDriftResult[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const raw = readFileSync(join(conversationsDir, file), "utf-8");
      const result = parseYaml(raw) as ConversationResult;

      if (!result.messages || result.messages.length === 0) {
        console.log(`[${i + 1}/${files.length}] ${file} — skipped (no messages)`);
        continue;
      }

      if (result.messages.length < config.segments) {
        console.log(
          `[${i + 1}/${files.length}] ${file} — skipped (${result.messages.length} turns < ${config.segments} segments)`,
        );
        continue;
      }

      const scenario = ALL_SCENARIOS.find((s) => s.id === result.scenario_id);
      if (!scenario) throw new Error(`Scenario "${result.scenario_id}" not found (${file})`);

      const characters = result.characters.map((c) => {
        const found = ALL_CHARACTERS.find((r) => r.id === c.id);
        if (!found) throw new Error(`Character "${c.id}" not found (${file})`);
        return found;
      });

      console.log(
        `[${i + 1}/${files.length}] ${result.scenario_id} · ${result.characters.map((c) => c.name).join(" + ")}`,
      );

      const convResult = await runDriftForConversation(
        result,
        file,
        scenario,
        characters,
        config,
        apiKey,
      );
      allResults.push(convResult);
    }

    if (allResults.length === 0) {
      throw new Error("No conversations were successfully processed.");
    }

    writeConversationResults(outputDir, allResults);
    writeSummary(outputDir, computeScenarioSummaries(allResults));

    console.log(`\nDone. ${allResults.length} conversations processed. Results: ${outputDir}/`);
  } catch (err) {
    rmSync(outputDir, { recursive: true, force: true });
    console.error(`\nDrift pass failed — removed incomplete output: ${outputDir}`);
    throw err;
  }
}
