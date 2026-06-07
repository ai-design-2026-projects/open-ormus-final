import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ConversationResult } from "../generator/conversation";

export type ConversationEntry = {
  file: string;
  result: ConversationResult;
  i: number;
};

export function loadConversationEntries(conversationsDir: string): ConversationEntry[] {
  const files = readdirSync(conversationsDir)
    .filter((f) => f.endsWith(".yaml"))
    .sort();

  if (files.length === 0) {
    throw new Error(`No conversation YAML files found in ${conversationsDir}`);
  }

  return files.map((file, i) => ({
    file,
    result: parseYaml(readFileSync(join(conversationsDir, file), "utf-8")) as ConversationResult,
    i,
  }));
}
