import { runJudgingPass } from "./judge/pass";

const configPath = process.argv[2];
if (!configPath) {
  console.error("Usage: bun evaluation/judge_guessing.ts <judge-config.yaml>");
  process.exit(1);
}

await runJudgingPass(configPath);
