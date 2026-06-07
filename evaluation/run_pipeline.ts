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

console.log(`Evaluating ${dataset}/${evalName}`);

const [judgeResult, reconstructResult, driftResult] = await Promise.allSettled([
  runJudgingPass(JUDGE_CONFIG, evalName),
  runReconstructionPass(RECONSTRUCT_CONFIG, evalName),
  runDriftPass(DRIFT_CONFIG, evalName),
]);

const passEntries = [
  { name: "judge_guessing" as const, result: judgeResult },
  { name: "reconstruct_persona" as const, result: reconstructResult },
  { name: "context_drift" as const, result: driftResult },
];

const completedPasses = passEntries.filter((p) => p.result.status === "fulfilled").map((p) => p.name);
const failedEntries = passEntries.filter((p) => p.result.status === "rejected");

if (failedEntries.length === 0) {
  console.log(`\nEvaluation complete: ${evalDir}`);
  process.exit(0);
}

const pad = (s: string) => s.padEnd(24);
process.stderr.write(`\n${c.boldRed}✗ Evaluation pipeline failed${c.reset}\n`);
process.stderr.write(`  Dataset:  ${dataset} / ${evalName}\n\n`);
for (const p of ALL_PASSES) {
  const entry = passEntries.find((e) => e.name === p);
  if (!entry) continue;
  if (entry.result.status === "fulfilled")
    process.stderr.write(`  ${pad(p)} ${c.green}✓ completed${c.reset}\n`);
  else
    process.stderr.write(`  ${pad(p)} ${c.boldRed}✗ failed${c.reset}\n`);
}
for (const { name, result } of failedEntries) {
  if (result.status === "rejected") {
    const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
    process.stderr.write(`\n  ${c.red}${name}:${c.reset} ${msg}\n`);
    if (process.env["DEBUG"] && result.reason instanceof Error && result.reason.stack) {
      process.stderr.write(`  ${c.dim}Stack:${c.reset}\n${result.reason.stack}\n`);
    }
  }
}

if (completedPasses.length === 0 && existsSync(evalDir)) {
  rmSync(evalDir, { recursive: true, force: true });
} else if (completedPasses.length > 0) {
  process.stderr.write(`\n  Partial results preserved in: ${evalDir}\n`);
}

process.exit(1);
