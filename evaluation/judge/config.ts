import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type JudgeConfig = {
  label: "judge_1" | "judge_2" | "judge_3";
  model: string;
};

export type ValidatedJudgeConfig = {
  evalDir: string;          // absolute path: <resultsBase>/<datasetDir>/<evalName>
  conversationsDir: string; // absolute path: <resultsBase>/<datasetDir>/conversations
  baseUrl: string;
  judges: JudgeConfig[];
  rawConfigText: string;
};

const JudgeInputSchema = z.object({ model: z.string().min(1) });

const JudgeConfigSchema = z.object({
  dataset_dir: z.string().min(1).refine(
    (v) => !v.includes("/") && !v.includes("\\") && !v.includes(".."),
    "dataset_dir must be a simple directory name",
  ),
  judges: z.array(JudgeInputSchema).min(1, "At least 1 judge required").max(3, "At most 3 judges allowed"),
});

export function loadJudgeConfig(
  configPath: string,
  evalName: string,
  resultsBasePath: string = (() => {
    if (!process.env.EVAL_RESULTS_PATH) throw new Error("EVAL_RESULTS_PATH is not set");
    return process.env.EVAL_RESULTS_PATH;
  })(),
): ValidatedJudgeConfig {
  const rawConfigText = readFileSync(configPath, "utf-8");
  const parsed: unknown = parseYaml(rawConfigText);
  const input = JudgeConfigSchema.parse(parsed);

  if (!process.env["LLM_API_KEY"]) throw new Error("LLM_API_KEY env var is not set");
  const rawBaseUrl = process.env["LLM_BASE_URL"];
  if (!rawBaseUrl) throw new Error("LLM_BASE_URL env var is not set");
  const baseUrl = rawBaseUrl.replace(/\/v1\/?$/, "");

  const evalDir = join(resultsBasePath, input.dataset_dir, evalName);
  const conversationsDir = join(resultsBasePath, input.dataset_dir, "conversations");

  if (!existsSync(conversationsDir)) {
    throw new Error(
      `Conversations directory not found: ${conversationsDir}\nRun the generate step first.`,
    );
  }

  const judgeOutputDir = join(evalDir, "judge_guessing");
  if (existsSync(judgeOutputDir)) {
    throw new Error(`Judge output already exists: ${judgeOutputDir}\nDelete it or use a different eval-name.`);
  }

  const judges: JudgeConfig[] = input.judges.map((j, i) => ({
    label: (["judge_1", "judge_2", "judge_3"] as const)[i]!,
    model: j.model,
  }));

  return { evalDir, conversationsDir, baseUrl, judges, rawConfigText };
}
