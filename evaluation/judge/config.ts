import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type JudgeConfig = {
  label: "judge_1" | "judge_2" | "judge_3";
  model: string;
};

export type ValidatedJudgeConfig = {
  datasetDir: string;
  outputName: string;
  baseUrl: string;
  judges: JudgeConfig[];
  rawConfigText: string;
};

const JudgeInputSchema = z.object({
  model: z.string().min(1),
});

const JudgeConfigSchema = z.object({
  dataset_dir: z.string().min(1).refine(
    (v) => !v.includes("/") && !v.includes("\\") && !v.includes(".."),
    "dataset_dir must be a simple directory name",
  ),
  output_name: z.string().min(1).refine(
    (v) => !v.includes("/") && !v.includes("\\") && !v.includes(".."),
    "output_name must be a simple directory name",
  ),
  base_url: z.string().min(1),
  judges: z.array(JudgeInputSchema).min(1, "At least 1 judge required").max(3, "At most 3 judges allowed"),
});

export function loadJudgeConfig(configPath: string): ValidatedJudgeConfig {
  const rawConfigText = readFileSync(configPath, "utf-8");
  const parsed: unknown = parseYaml(rawConfigText);
  const input = JudgeConfigSchema.parse(parsed);

  if (!process.env["LLM_API_KEY"]) {
    throw new Error("LLM_API_KEY env var is not set");
  }

  const resultsBase = join(process.cwd(), "evaluation", "results");
  const datasetDir = join(resultsBase, input.dataset_dir);
  const conversationsDir = join(datasetDir, "conversations");

  if (!existsSync(conversationsDir)) {
    throw new Error(
      `Dataset conversations directory not found: ${conversationsDir}\nRun the generate step first.`,
    );
  }

  const judgeOutputDir = join(datasetDir, "judge_guessing", input.output_name);
  if (existsSync(judgeOutputDir)) {
    throw new Error(
      `Judge output directory already exists: ${judgeOutputDir}\nDelete it or choose a different output_name.`,
    );
  }

  const judges: JudgeConfig[] = input.judges.map((j, i) => ({
    label: (["judge_1", "judge_2", "judge_3"] as const)[i]!,
    model: j.model,
  }));

  return {
    datasetDir,
    outputName: input.output_name,
    baseUrl: input.base_url,
    judges,
    rawConfigText,
  };
}
