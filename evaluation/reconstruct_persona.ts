import { runReconstructionPass } from "./reconstruct/pass";

const configPath = process.argv[2];
const evalName = process.argv[3] ?? "eval-01";
if (!configPath) {
  console.error("Usage: bun evaluation/reconstruct_persona.ts <config.yaml> [eval-name]");
  process.exit(1);
}

await runReconstructionPass(configPath, evalName);
