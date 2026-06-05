import { runReconstructionPass } from "./reconstruct/pass";

const configPath = process.argv[2];
if (!configPath) {
  console.error("Usage: bun evaluation/reconstruct_persona.ts <config.yaml>");
  process.exit(1);
}

await runReconstructionPass(configPath);
