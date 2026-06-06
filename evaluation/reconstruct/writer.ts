import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import type { ConversationReconstructionResult } from "./types";
import type { ReconstructionSummary } from "./scoring";

export function initReconstructOutputDir(
  datasetDir: string,
  outputName: string,
  rawConfigText: string,
): string {
  const outputDir = join(datasetDir, "reconst_persona", outputName);
  mkdirSync(join(outputDir, "conversations"), { recursive: true });
  writeFileSync(join(outputDir, "config.yaml"), rawConfigText, "utf-8");
  return outputDir;
}

export function writeReconstructResults(
  outputDir: string,
  results: ConversationReconstructionResult[],
): void {
  for (const result of results) {
    writeFileSync(
      join(outputDir, "conversations", result.conversation_file),
      stringify(result),
      "utf-8",
    );
  }
}

export function writeSummary(outputDir: string, summary: ReconstructionSummary): void {
  writeFileSync(join(outputDir, "summary.yaml"), stringify(summary), "utf-8");
}
