import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ValidatedDriftConfig, DriftJudgeConfig } from "./types";

const DriftConfigSchema = z.object({
  dataset_dir: z.string().min(1).refine(
    (v) => !v.includes("/") && !v.includes("\\") && !v.includes(".."),
    "dataset_dir must be a simple directory name",
  ),
  segments: z.number().int().min(2, "segments must be ≥ 2"),
  judges: z.array(z.object({ model: z.string().min(1) })).min(1, "at least 1 judge required"),
});

export function loadDriftConfig(
  rawConfigText: string,
  evalName: string,
  resultsBasePath: string = (() => {
    if (!process.env.EVAL_RESULTS_PATH) throw new Error("EVAL_RESULTS_PATH is not set");
    return process.env.EVAL_RESULTS_PATH;
  })(),
  datasetDir?: string,
): ValidatedDriftConfig {
  const parsed: unknown = parseYaml(rawConfigText);
  const input = DriftConfigSchema.parse(parsed);

  if (!process.env["LLM_API_KEY"]) throw new Error("LLM_API_KEY env var is not set");
  const rawBaseUrl = process.env["LLM_BASE_URL"];
  if (!rawBaseUrl) throw new Error("LLM_BASE_URL env var is not set");
  const baseUrl = rawBaseUrl.replace(/\/v1\/?$/, "");

  const resolvedDatasetDir = datasetDir ?? input.dataset_dir;
  const evalDir = join(resultsBasePath, resolvedDatasetDir, evalName);
  const conversationsDir = join(resultsBasePath, resolvedDatasetDir, "conversations");

  if (!existsSync(conversationsDir)) {
    throw new Error(`Conversations directory not found: ${conversationsDir}\nRun the generate step first.`);
  }

  const outputDir = join(evalDir, "context_drift");
  if (existsSync(outputDir)) {
    throw new Error(`Drift output already exists: ${outputDir}`);
  }

  const judges: DriftJudgeConfig[] = input.judges.map((j, i) => ({
    label: `judge_${i + 1}`,
    model: j.model,
  }));

  return { evalDir, conversationsDir, baseUrl, segments: input.segments, judges, rawConfigText };
}
