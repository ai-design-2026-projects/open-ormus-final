import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { stringify, parse as parseYaml } from "yaml";
import type { ConversationReconstructionResult } from "./types";
import type { ReconstructionSummary } from "./scoring";
import type { ValidatedReconstructConfig } from "./types";

export function initReconstructOutputDir(
  evalDir: string,
  config: ValidatedReconstructConfig,
): string {
  const outputDir = join(evalDir, "reconstruct_persona");
  mkdirSync(join(outputDir, "conversations"), { recursive: true });
  writeFileSync(join(outputDir, "config.yaml"), config.rawConfigText, "utf-8");

  const metaPath = join(evalDir, "meta.yaml");
  const existing = existsSync(metaPath)
    ? (parseYaml(readFileSync(metaPath, "utf-8")) as Record<string, unknown>)
    : {};
  const passes = (existing["passes"] as Record<string, unknown>) ?? {};
  passes["reconstruct"] = {
    reconstructor: config.reconstructorModel,
    comparators: config.comparators.map((c) => c.model),
    segments: config.segments,
  };
  existing["passes"] = passes;
  writeFileSync(metaPath, stringify(existing), "utf-8");

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
