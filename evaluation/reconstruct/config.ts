import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PROFILE_FIELDS } from "./types";
import type { ProfileField, ValidatedReconstructConfig, ComparatorConfig } from "./types";

const ComparatorInputSchema = z.object({ model: z.string().min(1) });

const ReconstructConfigSchema = z.object({
  dataset_dir: z.string().min(1).refine(
    (v) => !v.includes("/") && !v.includes("\\") && !v.includes(".."),
    "dataset_dir must be a simple directory name",
  ),
  output_name: z.string().min(1).refine(
    (v) => !v.includes("/") && !v.includes("\\") && !v.includes(".."),
    "output_name must be a simple directory name",
  ),
  reconstructor: z.object({ model: z.string().min(1) }),
  comparators: z.array(ComparatorInputSchema).min(1, "At least 1 comparator required").max(3, "At most 3 comparators allowed"),
  segments: z.number().int().min(1).default(1),
  fields: z.array(z.enum(PROFILE_FIELDS)).optional(),
});

export function loadReconstructConfig(
  rawConfigText: string,
  resultsBasePath: string = join(process.cwd(), "evaluation", "results"),
): ValidatedReconstructConfig {
  const parsed: unknown = parseYaml(rawConfigText);
  const input = ReconstructConfigSchema.parse(parsed);

  if (!process.env["LLM_API_KEY"]) {
    throw new Error("LLM_API_KEY env var is not set");
  }
  const rawBaseUrl = process.env["LLM_BASE_URL"];
  if (!rawBaseUrl) {
    throw new Error("LLM_BASE_URL env var is not set");
  }
  const baseUrl = rawBaseUrl.replace(/\/v1\/?$/, "");

  const datasetDir = join(resultsBasePath, input.dataset_dir);
  const conversationsDir = join(datasetDir, "conversations");

  if (!existsSync(conversationsDir)) {
    throw new Error(
      `Dataset conversations directory not found: ${conversationsDir}\nRun the generate step first.`,
    );
  }

  const outputDir = join(datasetDir, "reconstruct_persona", input.output_name);
  if (existsSync(outputDir)) {
    throw new Error(
      `Reconstruct output directory already exists: ${outputDir}\nDelete it or choose a different output_name.`,
    );
  }

  const comparators: ComparatorConfig[] = input.comparators.map((c, i) => ({
    label: `comparator_${i + 1}`,
    model: c.model,
  }));

  const fields: ProfileField[] = input.fields ?? [...PROFILE_FIELDS];

  return {
    datasetDir,
    outputName: input.output_name,
    baseUrl,
    reconstructorModel: input.reconstructor.model,
    comparators,
    segments: input.segments,
    fields,
    rawConfigText,
  };
}
