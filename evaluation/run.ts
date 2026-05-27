import { runEvaluation } from "./runner/index";

const configPath = process.argv[2];
if (!configPath) {
  console.error("Usage: bun evaluation/run.ts <config.yaml>");
  console.error("Example: bun evaluation/run.ts evaluation/example-config.yaml");
  process.exit(1);
}

await runEvaluation(configPath);
