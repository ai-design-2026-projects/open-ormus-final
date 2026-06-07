import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PROFILE_FIELDS } from "./types";
import type { ValidatedReconstructConfig, ComparatorConfig } from "./types";

const ComparatorInputSchema = z.object({ model: z.string().min(1) });

const ReconstructConfigSchema = z.object({
  dataset_dir: z.string().min(1).refine(
    (v) => !v.includes("/") && !v.includes("\\") && !v.includes(".."),
    "dataset_dir must be a simple directory name",
  ),
  reconstructor: z.object({ model: z.string().min(1) }),
  comparators: z.array(ComparatorInputSchema).min(1).max(3),
  segments: z.number().int().min(1).default(1),
  fields: z.array(z.enum(PROFILE_FIELDS)).optional(),
});

export function loadReconstructConfig(
  rawConfigText: string,
  evalName: string,
  resultsBasePath: string = (() => {
    if (!process.env.EVAL_RESULTS_PATH) throw new Error("EVAL_RESULTS_PATH is not set");
    return process.env.EVAL_RESULTS_PATH;
  })(),
): ValidatedReconstructConfig {
  const parsed: unknown = parseYaml(rawConfigText);
  const input = ReconstructConfigSchema.parse(parsed);

  if (!process.env["LLM_API_KEY"]) throw new Error("LLM_API_KEY env var is not set");
  const rawBaseUrl = process.env["LLM_BASE_URL"];
  if (!rawBaseUrl) throw new Error("LLM_BASE_URL env var is not set");
  const baseUrl = rawBaseUrl.replace(/\/v1\/?$/, "");

  const evalDir = join(resultsBasePath, input.dataset_dir, evalName);
  const conversationsDir = join(resultsBasePath, input.dataset_dir, "conversations");

  if (!existsSync(conversationsDir)) {
    throw new Error(`Conversations directory not found: ${conversationsDir}\nRun the generate step first.`);
  }

  const outputDir = join(evalDir, "reconstruct_persona");
  if (existsSync(outputDir)) {
    throw new Error(`Reconstruct output already exists: ${outputDir}`);
  }

  const comparators: ComparatorConfig[] = input.comparators.map((c, i) => ({
    label: `comparator_${i + 1}`,
    model: c.model,
  }));

  return {
    evalDir,
    conversationsDir,
    baseUrl,
    reconstructorModel: input.reconstructor.model,
    comparators,
    segments: input.segments,
    fields: input.fields ?? [...PROFILE_FIELDS],
    rawConfigText,
  };
}
