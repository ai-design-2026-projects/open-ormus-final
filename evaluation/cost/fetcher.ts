import { readFileSync, writeFileSync } from "node:fs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { CostRecord } from "./types";

const COST_RETRY_DELAYS_MS = [3000, 6000, 12000];

async function fetchOpenRouterCost(generationId: string, apiKey: string): Promise<number | null> {
  for (let attempt = 0; attempt <= COST_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await new Promise((resolve) => setTimeout(resolve, COST_RETRY_DELAYS_MS[attempt - 1]!));
    }
    const res = await fetch(
      `https://openrouter.ai/api/v1/generation?id=${generationId}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`OpenRouter generation fetch failed: ${res.status}`);
    const body = (await res.json()) as { data?: { total_cost?: number } };
    const cost = body.data?.total_cost;
    if (cost === undefined) throw new Error("OpenRouter response missing total_cost");
    return cost;
  }
  return null;
}

export async function fetchPassCosts(yamlPath: string): Promise<void> {
  const apiKey = process.env["LLM_API_KEY"];
  if (!apiKey) {
    process.stderr.write("[fetchPassCosts] LLM_API_KEY not set — skipping cost fetch\n");
    return;
  }

  const baseUrl = process.env["LLM_BASE_URL"] ?? "";
  if (!baseUrl.includes("openrouter.ai")) {
    process.stderr.write("[fetchPassCosts] Not using OpenRouter — costUsd will remain null\n");
    return;
  }

  const parsed = parseYaml(readFileSync(yamlPath, "utf-8")) as { records: CostRecord[] };
  const records = parsed.records ?? [];
  const needsFetch = records.filter((r) => r.costUsd === null && r.generationId);

  if (needsFetch.length === 0) return;

  process.stdout.write(`[costs] Fetching costs for ${needsFetch.length} records…\n`);

  await Promise.all(
    needsFetch.map(async (record) => {
      try {
        const costUsd = await fetchOpenRouterCost(record.generationId, apiKey);
        record.costUsd = costUsd;
      } catch (err) {
        process.stderr.write(
          `[fetchPassCosts] Failed for ${record.generationId}: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }),
  );

  writeFileSync(yamlPath, stringifyYaml({ records }), "utf-8");
  process.stdout.write("[costs] Done.\n");
}
