import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadReconstructConfig } from "./config";
import { runReconstructionForConversation } from "./index";
import { initReconstructOutputDir, writeReconstructResults, writeSummary } from "./writer";
import { computeSummary } from "./scoring";
import type { CharacterRecord, ScenarioRecord } from "../runner/config";
import type { ConversationResult } from "../runner/conversation";
import type { ConversationReconstructionResult } from "./types";

import rawCharacters from "../dataset/characters.yaml";
import rawScenarios from "../dataset/scenarios.yaml";

const ALL_CHARACTERS = rawCharacters as CharacterRecord[];
const ALL_SCENARIOS = rawScenarios as ScenarioRecord[];

export async function runReconstructionPass(configPath: string): Promise<void> {
  const rawConfigText = readFileSync(configPath, "utf-8");
  const config = loadReconstructConfig(rawConfigText);
  const apiKey = process.env["LLM_API_KEY"]!;

  const outputDir = initReconstructOutputDir(config.datasetDir, config.outputName, rawConfigText);

  try {
    const conversationsDir = join(config.datasetDir, "conversations");
    const files = readdirSync(conversationsDir).filter((f) => f.endsWith(".yaml")).sort();

    if (files.length === 0) {
      throw new Error(`No conversation YAML files found in ${conversationsDir}`);
    }

    const allResults: ConversationReconstructionResult[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const raw = readFileSync(join(conversationsDir, file), "utf-8");
      const result = parseYaml(raw) as ConversationResult;

      if (!result.messages || result.messages.length === 0) {
        console.log(`[${i + 1}/${files.length}] ${file} — skipped (failed conversation)`);
        continue;
      }

      const scenario = ALL_SCENARIOS.find((s) => s.id === result.scenario_id);
      if (!scenario) throw new Error(`Scenario "${result.scenario_id}" not found (from ${file})`);

      const characters = result.characters.map((c) => {
        const found = ALL_CHARACTERS.find((r) => r.id === c.id);
        if (!found) throw new Error(`Character "${c.id}" not found (from ${file})`);
        return found;
      });

      console.log(`[${i + 1}/${files.length}] ${result.scenario_id} · ${result.characters.map((c) => c.name).join(" + ")}`);

      const convResult = await runReconstructionForConversation(
        result,
        file,
        scenario,
        characters,
        config,
        apiKey,
      );
      allResults.push(convResult);
    }

    writeReconstructResults(outputDir, allResults);
    writeSummary(outputDir, computeSummary(allResults, config.comparators.map((c) => c.model)));

    console.log(`\nDone. Results written to ${outputDir}/`);
  } catch (err) {
    rmSync(outputDir, { recursive: true, force: true });
    console.error(`\nReconstruction failed — removed incomplete output: ${outputDir}`);
    throw err;
  }
}
