import { parse as parseYaml } from "yaml";
import { readFileSync } from "node:fs";
import { runDriftPass } from "./drift/pass";

const configPath = process.argv[2];
if (!configPath) {
  console.error("Usage: bun evaluation/context_drift.ts <config.yaml>");
  process.exit(1);
}

const { eval_name: evalName } = parseYaml(readFileSync(configPath, "utf-8")) as { eval_name?: string };
if (!evalName) {
  console.error(`eval_name must be set in ${configPath}`);
  process.exit(1);
}

await runDriftPass(configPath, evalName);
