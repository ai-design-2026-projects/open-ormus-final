import { parse as parseYaml } from "yaml";
import { readFileSync } from "node:fs";
import { runReconstructionPass } from "./reconstruct/pass";

const configPath = process.argv[2];
if (!configPath) {
  console.error("Usage: bun evaluation/reconstruct_persona.ts <config.yaml>");
  process.exit(1);
}

const { eval_name: evalName } = parseYaml(readFileSync(configPath, "utf-8")) as { eval_name?: string };
if (!evalName) {
  console.error(`eval_name must be set in ${configPath}`);
  process.exit(1);
}

await runReconstructionPass(configPath, evalName);
