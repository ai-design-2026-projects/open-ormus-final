// Note: zod is declared at root package.json (not packages/shared) because
// evaluation/ is not a workspace package — Bun resolves deps from root for these scripts.
import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---- Dataset record types (mirror characters.yaml / scenarios.yaml fields) ----

export type CharacterRecord = {
  id: string;
  name: string;
  archetype: string;
  personalityTraits: string[];
  backstory: string;
  speechPatterns: string[];
  values: string[];
  fears: string[];
  goals: string[];
  notableQuotes: string[];
  abilities: string[];
  copingStyle: string[];
  difficultyTier: string;
  similarTo: string | null;
  varyingAxis: string | null;
};

export type ScenarioRecord = {
  id: string;
  title: string;
  context: string;
  initial_prompt: string;
  difficulty_level: string;
  stress_axes: string[];
  social_context: string;
  pressure_source: string;
};

// ---- Validated output types ----

export type ValidatedRun = {
  index: number;
  scenario: ScenarioRecord;
  characters: CharacterRecord[];
  turns: number;
  model: string;
  turn_strategy: "ROUND_ROBIN" | "ORCHESTRATOR";
};

export type ValidatedConfig = {
  datasetDir: string;
  baseUrl: string;
  runs: ValidatedRun[];
  rawConfigText: string; // copied verbatim into the output directory
};

// ---- Zod schema for the config file ----

const RunInputSchema = z.object({
  scenario: z.string(),
  characters: z.array(z.string()).min(2, "Each run needs at least 2 characters"),
  turns: z.number().int().min(1, "turns must be >= 1"),
  model: z.string().optional(),
  turn_strategy: z.enum(["ROUND_ROBIN", "ORCHESTRATOR"]),
});

const EvalConfigSchema = z.object({
  output_dir: z
    .string()
    .min(1)
    .refine(
      (v) => !v.includes("/") && !v.includes("\\") && !v.includes(".."),
      "output_dir must be a simple directory name (no slashes or '..')",
    ),
  default_model: z.string().optional(),
  runs: z.array(RunInputSchema).min(1, "runs array must not be empty"),
});

// ---- Static dataset imports (Bun native YAML) ----

import rawCharacters from "../dataset/characters.yaml";
import rawScenarios from "../dataset/scenarios.yaml";

const ALL_CHARACTERS = rawCharacters as CharacterRecord[];
const ALL_SCENARIOS = rawScenarios as ScenarioRecord[];

// Cast is safe: the dataset is generated from a controlled process and types are
// verified manually. No Zod validation here to avoid duplicating the type definitions.

// ---- Loader ----

export function loadConfig(
  configPath: string,
  resultsBasePath: string = (() => {
    if (!process.env.EVAL_RESULTS_PATH) throw new Error("EVAL_RESULTS_PATH is not set");
    return process.env.EVAL_RESULTS_PATH;
  })(),
): ValidatedConfig {
  const rawConfigText = readFileSync(configPath, "utf-8");
  const parsed: unknown = parseYaml(rawConfigText);
  const input = EvalConfigSchema.parse(parsed);

  if (!process.env["LLM_API_KEY"]) throw new Error("LLM_API_KEY env var is not set");
  const rawBaseUrl = process.env["LLM_BASE_URL"];
  if (!rawBaseUrl) throw new Error("LLM_BASE_URL env var is not set");
  const baseUrl = rawBaseUrl.replace(/\/v1\/?$/, "");

  const validatedRuns: ValidatedRun[] = input.runs.map((run, i) => {
    const idx = i + 1;
    const model = run.model ?? input.default_model;
    if (!model) throw new Error(`Run ${idx}: no model specified and no default_model set in config`);

    const scenario = ALL_SCENARIOS.find((s) => s.id === run.scenario);
    if (!scenario) throw new Error(`Run ${idx}: scenario "${run.scenario}" not found in dataset`);

    const characters = run.characters.map((charId) => {
      const char = ALL_CHARACTERS.find((c) => c.id === charId);
      if (!char) throw new Error(`Run ${idx}: character "${charId}" not found in dataset`);
      return char;
    });

    if (run.characters.length === 2 && run.turn_strategy === "ORCHESTRATOR") {
      throw new Error(`Run ${idx}: ORCHESTRATOR cannot be used with 2 characters — use ROUND_ROBIN`);
    }

    return { index: idx, scenario, characters, turns: run.turns, model, turn_strategy: run.turn_strategy };
  });

  return { datasetDir: input.output_dir, baseUrl, runs: validatedRuns, rawConfigText };
}
