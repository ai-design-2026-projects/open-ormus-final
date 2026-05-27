import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import type { ConversationResult } from "./conversation";

export function initOutputDir(resultsBase: string, outputDir: string, rawConfigText: string): string {
  const runDir = join(resultsBase, outputDir);
  mkdirSync(join(runDir, "conversations"), { recursive: true });
  writeFileSync(join(runDir, "config.yaml"), rawConfigText, "utf-8");
  return runDir;
}

export function writeConversation(conversationsDir: string, index: number, result: ConversationResult): void {
  const filename = String(index).padStart(3, "0") + ".yaml";
  const filePath = join(conversationsDir, filename);
  writeFileSync(filePath, stringify(result), "utf-8");
}
