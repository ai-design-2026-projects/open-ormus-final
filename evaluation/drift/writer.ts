import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import type { ConversationDriftResult, ScenarioDriftSummary } from "./types";

export function initDriftOutputDir(
  datasetDir: string,
  outputName: string,
  rawConfigText: string,
): string {
  const outputDir = join(datasetDir, "context_drift", outputName);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "config.yaml"), rawConfigText, "utf-8");
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
