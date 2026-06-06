import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ValidatedDriftConfig, DriftJudgeConfig } from "./types";

const DriftConfigSchema = z.object({
  dataset_dir: z
    .string()
    .min(1)
    .refine(
      (v) => !v.includes("/") && !v.includes("\\") && !v.includes(".."),
      "dataset_dir must be a simple directory name",
    ),
  output_name: z
    .string()
    .min(1)
    .refine(
      (v) => !v.includes("/") && !v.includes("\\") && !v.includes(".."),
      "output_name must be a simple directory name",
    ),
  segments: z.number().int().min(2, "segments must be ≥ 2"),
  judges: z
    .array(z.object({ model: z.string().min(1) }))
    .min(1, "at least 1 judge required"),
});

export function loadDriftConfig(
  rawConfigText: string,
  resultsBasePath: string = join(process.cwd(), "evaluation", "results"),
): ValidatedDriftConfig {
  const parsed: unknown = parseYaml(rawConfigText);
  const input = DriftConfigSchema.parse(parsed);

  if (!process.env["LLM_API_KEY"]) throw new Error("LLM_API_KEY env var is not set");
  const rawBaseUrl = process.env["LLM_BASE_URL"];
  if (!rawBaseUrl) throw new Error("LLM_BASE_URL env var is not set");
  const baseUrl = rawBaseUrl.replace(/\/v1\/?$/, "");

  const datasetDir = join(resultsBasePath, input.dataset_dir);
  const conversationsDir = join(datasetDir, "conversations");

  if (!existsSync(conversationsDir)) {
    throw new Error(
      `Dataset conversations directory not found: ${conversationsDir}\nRun the generate step first.`,
    );
  }

  const outputDir = join(datasetDir, "context_drift", input.output_name);
  if (existsSync(outputDir)) {
    throw new Error(
      `Output directory already exists: ${outputDir}\nDelete it or choose a different output_name.`,
    );
  }

  const judges: DriftJudgeConfig[] = input.judges.map((j, i) => ({
    label: `judge_${i + 1}`,
    model: j.model,
  }));

  return {
    datasetDir,
    outputName: input.output_name,
    baseUrl,
    segments: input.segments,
    judges,
    rawConfigText,
  };
}
