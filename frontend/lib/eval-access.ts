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

const DatasetMetaSchema = z.object({
  created_at: z.string().optional(),
  dataset_dir: z.string().optional(),
  generate: z
    .object({
      model: z.string().optional(),
      turn_strategy: z.string().optional(),
      runs: z.number().optional(),
    })
    .optional(),
});

const EvalMetaSchema = z.object({
  eval_name: z.string().optional(),
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

    // Read dataset-level meta (new layout: generate info lives here, not in eval-XX)
    let datasetGenerate: EvalMeta["passes"] = undefined;
    let datasetCreatedAt: string | undefined;
    const datasetMetaPath = join(datasetPath, "meta.yaml");
    if (existsSync(datasetMetaPath)) {
      try {
        const dm = DatasetMetaSchema.parse(parseYaml(readFileSync(datasetMetaPath, "utf-8")));
        datasetCreatedAt = dm.created_at;
        if (dm.generate) datasetGenerate = { generate: dm.generate };
      } catch { /* ignore */ }
    }

    const evalDirs = readdirSync(datasetPath, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^eval-\d+$/.test(d.name))
      .map((d) => d.name)
      .sort();

    const evals: EvalSet[] = evalDirs.flatMap((name) => {
      const metaPath = join(datasetPath, name, "meta.yaml");

      let rawMeta: Record<string, unknown> = {};
      if (existsSync(metaPath)) {
        try {
          rawMeta = parseYaml(readFileSync(metaPath, "utf-8")) as Record<string, unknown>;
        } catch {
          return [];
        }
      }

      const merged = {
        eval_name: (rawMeta["eval_name"] as string | undefined) ?? name,
        created_at: (rawMeta["created_at"] as string | undefined) ?? datasetCreatedAt,
        dataset_dir: rawMeta["dataset_dir"] as string | undefined,
        passes: {
          ...datasetGenerate,
          ...((rawMeta["passes"] as Record<string, unknown> | undefined) ?? {}),
        },
      };

      try {
        const meta = EvalMetaSchema.parse(merged);
        return [{ name, meta }];
      } catch {
        return [];
      }
    });

    return { dataset, evals };
  });
}
