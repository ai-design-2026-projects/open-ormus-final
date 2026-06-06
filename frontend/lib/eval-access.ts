import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export function getResultsBasePath(): string {
  return (
    process.env["EVAL_RESULTS_PATH"] ??
    join(process.cwd(), "../evaluation/results")
  );
}

export function isEmailAllowed(email: string): boolean {
  const raw = process.env["EVAL_ALLOWED_EMAILS"] ?? "";
  const allowed = raw.split(",").map((e) => e.trim()).filter(Boolean);
  return allowed.includes(email);
}

const EvalMetaSchema = z.object({
  eval_name: z.string(),
  created_at: z.string().optional(),
  dataset_dir: z.string().optional(),
  passes: z
    .object({
      generate: z
        .object({
          model: z.string().optional(),
          turn_strategy: z.string().optional(),
          runs: z.number().optional(),
        })
        .optional(),
      judge: z
        .object({
          judges: z.number().optional(),
          model: z.string().optional(),
        })
        .optional(),
      reconstruct: z
        .object({
          reconstructor: z.string().optional(),
          comparators: z.array(z.string()).optional(),
          segments: z.number().optional(),
        })
        .optional(),
      drift: z
        .object({
          judges: z.number().optional(),
          models: z.array(z.string()).optional(),
          segments: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
});

export type EvalMeta = z.infer<typeof EvalMetaSchema>;

export type EvalSet = { name: string; meta: EvalMeta };
export type DatasetEntry = { dataset: string; evals: EvalSet[] };

export function listDatasets(): DatasetEntry[] {
  const base = getResultsBasePath();
  if (!existsSync(base)) return [];

  const datasetDirs = readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  return datasetDirs.map((dataset) => {
    const datasetPath = join(base, dataset);
    const evalDirs = readdirSync(datasetPath, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^eval-\d+$/.test(d.name))
      .map((d) => d.name)
      .sort();

    const evals: EvalSet[] = evalDirs.flatMap((name) => {
      const metaPath = join(datasetPath, name, "meta.yaml");
      if (!existsSync(metaPath)) {
        return [{ name, meta: { eval_name: name } }];
      }
      try {
        const meta = EvalMetaSchema.parse(
          parseYaml(readFileSync(metaPath, "utf-8"))
        );
        return [{ name, meta }];
      } catch {
        return [];
      }
    });

    return { dataset, evals };
  });
}
