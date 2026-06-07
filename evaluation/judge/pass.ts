import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadJudgeConfig } from "./config";
import { reconstructAliasMap } from "./alias";
import { runJudges } from "./index";
import { initJudgeOutputDir, writeGuessingResult } from "./writer";
import { CostTracker } from "../cost/tracker";
import { fetchPassCosts } from "../cost/fetcher";
import { termColors } from "../utils";
import { ProgressReporter } from "../progress";
import type { CharacterRecord, ScenarioRecord } from "../generator/config";
import type { ConversationResult } from "../generator/conversation";
import type { GuessingScenarioResult } from "./types";

const col = termColors();

import rawCharacters from "../dataset/characters.yaml";
import rawScenarios from "../dataset/scenarios.yaml";

const ALL_CHARACTERS = rawCharacters as CharacterRecord[];
const ALL_SCENARIOS = rawScenarios as ScenarioRecord[];

export async function runJudgingPass(configPath: string, evalName: string): Promise<void> {
  const config = loadJudgeConfig(configPath, evalName);
  const apiKey = process.env["LLM_API_KEY"]!;

  const judgeRunDir = initJudgeOutputDir(config.evalDir, config);
  const tracker = new CostTracker();

  try {
    const { conversationsDir } = config;
    const files = readdirSync(conversationsDir).filter((f) => f.endsWith(".yaml")).sort();

    if (files.length === 0) {
      throw new Error(`No conversation YAML files found in ${conversationsDir}`);
    }

    const total = files.length;

    const entries = files.map((file, i) => ({
      file,
      result: parseYaml(readFileSync(join(conversationsDir, file), "utf-8")) as ConversationResult,
      i,
    }));

    const progress = new ProgressReporter("judge", total);

    let guessingResults: GuessingScenarioResult[];
    try {
      guessingResults = await Promise.all(
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
          const label = `[${i + 1}/${total}] ${result.scenario_id} · ${result.characters.map((ch) => ch.name).join(" + ")}`;
          const conversationId = file.replace(".yaml", "");

          const buf = progress.itemBuffer();
          try {
            const guessingResult = await runJudges(result, aliasMap, characters, scenario, config.judges, config.baseUrl, apiKey, tracker, conversationId, (line) => buf.push(line));
            const allCorrect = guessingResult.judges.every((j) => j.all_correct);
            const wrongCount = guessingResult.judges.filter((j) => !j.all_correct).length;
            const status = allCorrect
              ? `${col.green}✓${col.reset}`
              : `${col.red}✗ ${wrongCount}/${guessingResult.judges.length} judges wrong${col.reset}`;
            buf.push(`${label}  ${status}\n`);
            buf.push("\n");
            return guessingResult;
          } catch (err) {
            buf.push(`${col.boldRed}${label}  ✗ failed${col.reset}\n`);
            buf.push("\n");
            throw new Error(`${label} failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
          } finally {
            progress.tick();
          }
        }),
      );
    } finally {
      progress.flush();
    }

    writeGuessingResult(judgeRunDir, guessingResults);

    const costsPath = join(config.evalDir, "costs", "judge_guessing.yaml");
    await tracker.flush(costsPath);
    try { await fetchPassCosts(costsPath); } catch (err) {
      process.stderr.write(`[costs] Cost fetch failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }

    console.log(`\nDone. Results written to ${judgeRunDir}/guessing_result.yaml`);
  } catch (err) {
    rmSync(judgeRunDir, { recursive: true, force: true });
    console.error(`\nJudging failed — removed incomplete directory: ${judgeRunDir}`);
    throw err;
  }
}
