import { runJudgingPass } from "./judge/pass";

const configPath = process.argv[2];
const evalName = process.argv[3] ?? "eval-01";
if (!configPath) {
  console.error("Usage: bun evaluation/judge_guessing.ts <config.yaml> [eval-name]");
  console.error("Example: bun evaluation/judge_guessing.ts evaluation/configs/judge-guessing.yaml eval-01");
  process.exit(1);
}

await runJudgingPass(configPath, evalName);
