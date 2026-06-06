import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { stringify, parse as parseYaml } from "yaml";
import type { ConversationDriftResult, ScenarioDriftSummary, ValidatedDriftConfig } from "./types";

export function initDriftOutputDir(
  evalDir: string,
  config: ValidatedDriftConfig,
): string {
  const outputDir = join(evalDir, "context_drift");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "config.yaml"), config.rawConfigText, "utf-8");

  const metaPath = join(evalDir, "meta.yaml");
  const existing = existsSync(metaPath)
    ? (parseYaml(readFileSync(metaPath, "utf-8")) as Record<string, unknown>)
    : {};
  const passes = (existing["passes"] as Record<string, unknown>) ?? {};
  passes["drift"] = {
    judges: config.judges.length,
    models: config.judges.map((j) => j.model),
    segments: config.segments,
  };
  existing["passes"] = passes;
  writeFileSync(metaPath, stringify(existing), "utf-8");

  return outputDir;
}

export function writeConversationResults(
  outputDir: string,
  results: ConversationDriftResult[],
): void {
  writeFileSync(join(outputDir, "conversation_results.yaml"), stringify(results), "utf-8");
}

export function writeSummary(outputDir: string, summaries: ScenarioDriftSummary[]): void {
  writeFileSync(join(outputDir, "summary.yaml"), stringify(summaries), "utf-8");
}
