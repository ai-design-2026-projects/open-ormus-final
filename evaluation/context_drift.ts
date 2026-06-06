import { runDriftPass } from "./drift/pass";

const configPath = process.argv[2];
if (!configPath) {
  console.error("Usage: bun evaluation/context_drift.ts <config.yaml>");
  process.exit(1);
}

await runDriftPass(configPath);
