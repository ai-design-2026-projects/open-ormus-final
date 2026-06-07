import { readdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runJudgingPass } from "./judge/pass";
import { runReconstructionPass } from "./reconstruct/pass";
import { runDriftPass } from "./drift/pass";

const JUDGE_CONFIG       = "evaluation/configs/judge-guessing.yaml";
const RECONSTRUCT_CONFIG = "evaluation/configs/reconstruct-persona.yaml";
const DRIFT_CONFIG       = "evaluation/configs/context-drift.yaml";

const ALL_PASSES = ["judge_guessing", "reconstruct_persona", "context_drift"] as const;

const dataset = process.argv[2];
if (!dataset) {
  console.error("Usage: bun evaluation/run_pipeline.ts <dataset-name>");
  process.exit(1);
}

const resultsBase = process.env.EVAL_RESULTS_PATH;
if (!resultsBase) throw new Error("EVAL_RESULTS_PATH is not set");

const datasetPath = join(resultsBase, dataset);
const conversationsPath = join(datasetPath, "conversations");
if (!existsSync(conversationsPath)) {
  console.error(`Conversations not found: ${conversationsPath}\nRun generate_dataset.ts first.`);
  process.exit(1);
}

// Auto-create the next available eval-XX directory name
let n = 1;
while (existsSync(join(datasetPath, `eval-${String(n).padStart(2, "0")}`))) n++;
const evalName = `eval-${String(n).padStart(2, "0")}`;
const evalDir = join(datasetPath, evalName);

const tty = process.stderr.isTTY ?? false;
const c = {
  reset:   tty ? "\x1b[0m"    : "",
  bold:    tty ? "\x1b[1m"    : "",
  dim:     tty ? "\x1b[2m"    : "",
  red:     tty ? "\x1b[31m"   : "",
  green:   tty ? "\x1b[32m"   : "",
  boldRed: tty ? "\x1b[1;31m" : "",
};

function handleFailure(
  failedPass: string,
  completedPasses: string[],
  skippedPasses: string[],
  err: unknown,
): never {
  if (completedPasses.length === 0 && existsSync(evalDir)) {
    rmSync(evalDir, { recursive: true, force: true });
  }

  const pad = (s: string) => s.padEnd(24);
  process.stderr.write(`\n${c.boldRed}✗ Evaluation pipeline failed${c.reset}\n`);
  process.stderr.write(`  Dataset:  ${dataset} / ${evalName}\n\n`);
  for (const p of ALL_PASSES) {
    if (completedPasses.includes(p))
      process.stderr.write(`  ${pad(p)} ${c.green}✓ completed${c.reset}\n`);
    else if (p === failedPass)
      process.stderr.write(`  ${pad(p)} ${c.boldRed}✗ failed${c.reset}\n`);
    else
      process.stderr.write(`  ${pad(p)} ${c.dim}— skipped${c.reset}\n`);
  }

  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\n  ${c.red}Error:${c.reset} ${msg}\n`);

  if (completedPasses.length > 0) {
    process.stderr.write(`\n  Partial results preserved in: ${evalDir}\n`);
  }

  if (process.env["DEBUG"] && err instanceof Error && err.stack) {
    process.stderr.write(`\n  ${c.dim}Stack:${c.reset}\n${err.stack}\n`);
  }

  process.exit(1);
}

console.log(`Evaluating ${dataset}/${evalName}`);

const completedPasses: string[] = [];

try {
  await runJudgingPass(JUDGE_CONFIG, evalName);
  completedPasses.push("judge_guessing");
} catch (err) {
  handleFailure("judge_guessing", completedPasses, ["reconstruct_persona", "context_drift"], err);
}

try {
  await runReconstructionPass(RECONSTRUCT_CONFIG, evalName);
  completedPasses.push("reconstruct_persona");
} catch (err) {
  handleFailure("reconstruct_persona", completedPasses, ["context_drift"], err);
}

try {
  await runDriftPass(DRIFT_CONFIG, evalName);
  completedPasses.push("context_drift");
} catch (err) {
  handleFailure("context_drift", completedPasses, [], err);
}

console.log(`\nEvaluation complete: ${evalDir}`);
