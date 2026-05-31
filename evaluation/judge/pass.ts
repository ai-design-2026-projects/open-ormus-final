import { readdirSync, readFileSync, rmSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadJudgeConfig } from "./config";
import { reconstructAliasMap } from "./alias";
import { runJudges } from "./index";
import { initJudgeOutputDir, writeGuessingResult } from "./writer";
import type { CharacterRecord, ScenarioRecord } from "../runner/config";
import type { ConversationResult } from "../runner/conversation";
import type { GuessingScenarioResult } from "./types";

import rawCharacters from "../dataset/characters.yaml";
import rawScenarios from "../dataset/scenarios.yaml";

const ALL_CHARACTERS = rawCharacters as CharacterRecord[];
const ALL_SCENARIOS = rawScenarios as ScenarioRecord[];

export async function runJudgingPass(configPath: string): Promise<void> {
  const config = loadJudgeConfig(configPath);
  const apiKey = process.env["LLM_API_KEY"]!;

  const judgeRunDir = initJudgeOutputDir(config.datasetDir, config.outputName, config.rawConfigText);

  try {
    const conversationsDir = join(config.datasetDir, "conversations");
    const files = readdirSync(conversationsDir)
      .filter((f) => f.endsWith(".yaml"))
      .sort();

    if (files.length === 0) {
      throw new Error(`No conversation YAML files found in ${conversationsDir}`);
    }

    const guessingResults: GuessingScenarioResult[] = [];
    const total = files.length;

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const raw = readFileSync(join(conversationsDir, file), "utf-8");
      const result = parseYaml(raw) as ConversationResult;

      const scenario = ALL_SCENARIOS.find((s) => s.id === result.scenario_id);
      if (!scenario) {
        throw new Error(`Scenario "${result.scenario_id}" not found in dataset (from ${file})`);
      }

      const convCharIds = result.characters.map((c) => c.id);
      const characters = convCharIds.map((id) => {
        const found = ALL_CHARACTERS.find((c) => c.id === id);
        if (!found) throw new Error(`Character "${id}" not found in dataset (from ${file})`);
        return found;
      });

      const aliasMap = reconstructAliasMap(result.characters, ALL_CHARACTERS);

      console.log(`[${i + 1}/${total}] ${result.scenario_id} · ${result.characters.map((c) => c.name).join(" + ")}`);

      const guessingResult = await runJudges(
        result,
        aliasMap,
        characters,
        scenario,
        config.judges,
        config.baseUrl,
        apiKey,
      );

      guessingResults.push(guessingResult);
    }

    writeGuessingResult(judgeRunDir, guessingResults);
    console.log(`\nDone. Results written to ${judgeRunDir}/guessing_result.yaml`);
  } catch (err) {
    rmSync(judgeRunDir, { recursive: true, force: true });
    try { rmdirSync(join(judgeRunDir, "..")); } catch { /* not empty — leave it */ }
    console.error(`\nJudging failed — removed incomplete directory: ${judgeRunDir}`);
    throw err;
  }
}
