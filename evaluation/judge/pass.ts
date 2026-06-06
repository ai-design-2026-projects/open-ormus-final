import { readdirSync, readFileSync, rmSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadJudgeConfig } from "./config";
import { reconstructAliasMap } from "./alias";
import { runJudges } from "./index";
import { initJudgeOutputDir, writeGuessingResult } from "./writer";
import type { CharacterRecord, ScenarioRecord } from "../generator/config";
import type { ConversationResult } from "../generator/conversation";
import type { GuessingScenarioResult } from "./types";

import rawCharacters from "../dataset/characters.yaml";
import rawScenarios from "../dataset/scenarios.yaml";

const ALL_CHARACTERS = rawCharacters as CharacterRecord[];
const ALL_SCENARIOS = rawScenarios as ScenarioRecord[];

export async function runJudgingPass(configPath: string, evalName: string): Promise<void> {
  const config = loadJudgeConfig(configPath, evalName);
  const apiKey = process.env["LLM_API_KEY"]!;

  const judgeRunDir = initJudgeOutputDir(config.evalDir, config);

  try {
    const conversationsDir = join(config.evalDir, "conversations");
    const files = readdirSync(conversationsDir).filter((f) => f.endsWith(".yaml")).sort();

    if (files.length === 0) {
      throw new Error(`No conversation YAML files found in ${conversationsDir}`);
    }

    const total = files.length;

    // Parse all files synchronously upfront, then fan out LLM calls in parallel.
    const entries = files.map((file, i) => ({
      file,
      result: parseYaml(readFileSync(join(conversationsDir, file), "utf-8")) as ConversationResult,
      i,
    }));

    // On first failure Promise.all rejects immediately; sibling calls continue until
    // they complete or fail on their own — they cannot be cancelled from here.
    // The catch block removes the output dir regardless of how many finished.
    const guessingResults: GuessingScenarioResult[] = await Promise.all(
      entries.map(async ({ file, result, i }) => {
        const scenario = ALL_SCENARIOS.find((s) => s.id === result.scenario_id);
        if (!scenario) throw new Error(`Scenario "${result.scenario_id}" not found in dataset (from ${file})`);

        const convCharIds = result.characters.map((c) => c.id);
        const characters = convCharIds.map((id) => {
          const found = ALL_CHARACTERS.find((c) => c.id === id);
          if (!found) throw new Error(`Character "${id}" not found in dataset (from ${file})`);
          return found;
        });

        const aliasMap = reconstructAliasMap(result.characters, ALL_CHARACTERS);
        const label = `[${i + 1}/${total}] ${result.scenario_id} · ${result.characters.map((c) => c.name).join(" + ")}`;

        console.log(`${label} — started`);
        try {
          const guessingResult = await runJudges(result, aliasMap, characters, scenario, config.judges, config.baseUrl, apiKey);
          console.log(`${label} ✓`);
          return guessingResult;
        } catch (err) {
          throw new Error(`${label} failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
        }
      }),
    );

    writeGuessingResult(judgeRunDir, guessingResults);
    console.log(`\nDone. Results written to ${judgeRunDir}/guessing_result.yaml`);
  } catch (err) {
    rmSync(judgeRunDir, { recursive: true, force: true });
    try { rmdirSync(join(judgeRunDir, "..")); } catch { /* not empty — leave it */ }
    console.error(`\nJudging failed — removed incomplete directory: ${judgeRunDir}`);
    throw err;
  }
}
