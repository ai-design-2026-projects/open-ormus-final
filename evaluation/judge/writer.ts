import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { stringify, parse as parseYaml } from "yaml";
import type { GuessingScenarioResult } from "./types";
import type { ValidatedJudgeConfig } from "./config";

export function initJudgeOutputDir(
  evalDir: string,
  config: ValidatedJudgeConfig,
): string {
  const judgeDir = join(evalDir, "judge_guessing");
  mkdirSync(judgeDir, { recursive: true });
  writeFileSync(join(judgeDir, "config.yaml"), config.rawConfigText, "utf-8");

  // Update meta.yaml with judge info
  const metaPath = join(evalDir, "meta.yaml");
  const existing = existsSync(metaPath)
    ? (parseYaml(readFileSync(metaPath, "utf-8")) as Record<string, unknown>)
    : {};
  const passes = (existing["passes"] as Record<string, unknown>) ?? {};
  passes["judge"] = {
    judges: config.judges.length,
    models: config.judges.map((j) => j.model),
  };
  existing["passes"] = passes;
  writeFileSync(metaPath, stringify(existing), "utf-8");

  return judgeDir;
}

export function writeGuessingResult(
  judgeDir: string,
  results: GuessingScenarioResult[],
): void {
  writeFileSync(join(judgeDir, "guessing_result.yaml"), stringify(results), "utf-8");
}
