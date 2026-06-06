import { runDriftPass } from "./drift/pass";

const configPath = process.argv[2];
const evalName = process.argv[3] ?? "eval-01";
if (!configPath) {
  console.error("Usage: bun evaluation/context_drift.ts <config.yaml> [eval-name]");
  process.exit(1);
}

await runDriftPass(configPath, evalName);
