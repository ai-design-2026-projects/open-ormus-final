import { rmSync } from "node:fs";
import { join } from "node:path";
import { loadJudgeConfig } from "./config";
import { reconstructAliasMap } from "./alias";
import { runJudges } from "./index";
import { initJudgeOutputDir, writeGuessingResult } from "./writer";
import { loadConversationEntries } from "../shared/loader";
import { PASS_DIRS } from "../shared/constants";
import { CostTracker } from "../cost/tracker";
import { fetchPassCosts } from "../cost/fetcher";
import { buildFailureBlock } from "../utils";
import { track, permanentWrite } from "../progress";
import type { CharacterRecord, ScenarioRecord } from "../generator/config";
import type { GuessingScenarioResult } from "./types";

import rawCharacters from "../dataset/characters.yaml";
import rawScenarios from "../dataset/scenarios.yaml";

const ALL_CHARACTERS = rawCharacters as CharacterRecord[];
const ALL_SCENARIOS = rawScenarios as ScenarioRecord[];

export async function runJudgingPass(configPath: string, evalName: string, datasetDir?: string): Promise<void> {
  const config = loadJudgeConfig(configPath, evalName, undefined, datasetDir);
  const apiKey = process.env["LLM_API_KEY"]!;

  const judgeRunDir = initJudgeOutputDir(config.evalDir, config);
  const tracker = new CostTracker();

  try {
    const entries = loadConversationEntries(config.conversationsDir);
    const total = entries.length;

    const handle = track("judge", total);

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
        const label = `${result.scenario_id} · ${result.characters.map((ch) => ch.name).join(" + ")}`;
        const conversationId = file.replace(".yaml", "");

        const detail: string[] = [];
        try {
          const guessingResult = await runJudges(
            result, aliasMap, characters, scenario, config.judges, config.baseUrl, apiKey,
            tracker, conversationId, (line) => detail.push(line),
          );
          handle.tick(true);
          return guessingResult;
        } catch (err) {
          const block = buildFailureBlock(
            "judge",
            `[${i + 1}/${total}]`,
            err,
            detail,
          );
          handle.fail(block);
          handle.tick(false);
          throw new Error(`[${i + 1}/${total}] ${label} failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
        }
      }),
    );

    writeGuessingResult(judgeRunDir, guessingResults);

    const costsPath = join(config.evalDir, "costs", `${PASS_DIRS.judge}.yaml`);
    await tracker.flush(costsPath);
    try { await fetchPassCosts(costsPath); } catch (err) {
      permanentWrite(`[costs] Cost fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } catch (err) {
    rmSync(judgeRunDir, { recursive: true, force: true });
    process.stderr.write(`\nJudging failed — removed incomplete directory: ${judgeRunDir}\n`);
    throw err;
  }
}
