import { generateDataset } from "./generator/index";

const configPath = process.argv[2];
if (!configPath) {
  console.error("Usage: bun evaluation/generate_dataset.ts <config.yaml>");
  console.error("Example: bun evaluation/generate_dataset.ts evaluation/configs/generate-dataset.yaml");
  process.exit(1);
}

await generateDataset(configPath);
