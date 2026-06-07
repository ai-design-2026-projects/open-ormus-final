import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import type { ConversationResult } from "./conversation";
import type { ValidatedConfig } from "./config";

export function initOutputDir(
  resultsBase: string,
  config: ValidatedConfig,
): string {
  const datasetDir = join(resultsBase, config.datasetDir);
  mkdirSync(join(datasetDir, "conversations"), { recursive: true });

  const meta = {
    created_at: new Date().toISOString(),
    dataset_dir: config.datasetDir,
    generate: {
      model: config.runs[0]?.model ?? "unknown",
      runs: config.runs.length,
    },
  };
  writeFileSync(join(datasetDir, "meta.yaml"), stringify(meta), "utf-8");
  writeFileSync(join(datasetDir, "generate-config.yaml"), config.rawConfigText, "utf-8");

  return datasetDir;
}

export function writeConversation(
  convsDir: string,
  index: number,
  result: ConversationResult,
): void {
  const filename = String(index).padStart(3, "0") + ".yaml";
  writeFileSync(join(convsDir, filename), stringify(result), "utf-8");
}
