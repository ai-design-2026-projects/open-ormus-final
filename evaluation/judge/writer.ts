import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import type { GuessingScenarioResult } from "./types";

export function initJudgeOutputDir(
  datasetDir: string,
  outputName: string,
  rawConfigText: string,
): string {
  const judgeRunDir = join(datasetDir, "judge_guessing", outputName);
  mkdirSync(judgeRunDir, { recursive: true });
  writeFileSync(join(judgeRunDir, "config.yaml"), rawConfigText, "utf-8");
  return judgeRunDir;
}

export function writeGuessingResult(
  judgeRunDir: string,
  results: GuessingScenarioResult[],
): void {
  writeFileSync(join(judgeRunDir, "guessing_result.yaml"), stringify(results), "utf-8");
}
