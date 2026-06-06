import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import type { ConversationResult } from "./conversation";
import type { ValidatedConfig } from "./config";

export function initOutputDir(
  resultsBase: string,
  config: ValidatedConfig,
): string {
  const evalDir = join(resultsBase, config.datasetDir, config.evalName);
  mkdirSync(join(evalDir, "conversations"), { recursive: true });

  const meta = {
    eval_name: config.evalName,
    created_at: new Date().toISOString(),
    dataset_dir: config.datasetDir,
    passes: {
      generate: {
        model: config.runs[0]?.model ?? "unknown",
        runs: config.runs.length,
      },
    },
  };
  writeFileSync(join(evalDir, "meta.yaml"), stringify(meta), "utf-8");
  writeFileSync(join(evalDir, "generate-config.yaml"), config.rawConfigText, "utf-8");

  return evalDir;
}

export function writeConversation(
  convsDir: string,
  index: number,
  result: ConversationResult,
): void {
  const filename = String(index).padStart(3, "0") + ".yaml";
  writeFileSync(join(convsDir, filename), stringify(result), "utf-8");
}
