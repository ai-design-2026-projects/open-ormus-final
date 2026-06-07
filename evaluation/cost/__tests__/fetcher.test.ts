import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stringify as stringifyYaml, parse as parseYaml } from "yaml";
import type { CostRecord } from "../types";

// Restore env after each test
const originalEnv = { ...process.env };
afterEach(() => {
  process.env["LLM_API_KEY"] = originalEnv["LLM_API_KEY"];
  process.env["LLM_BASE_URL"] = originalEnv["LLM_BASE_URL"];
});

function writeCostYaml(path: string, records: Partial<CostRecord>[]): void {
  writeFileSync(path, stringifyYaml({ records }), "utf-8");
}

describe("fetchPassCosts", () => {
  test("skips when LLM_API_KEY is not set", async () => {
    delete process.env["LLM_API_KEY"];
    process.env["LLM_BASE_URL"] = "https://openrouter.ai/api/v1";

    const { fetchPassCosts } = await import("../fetcher");
    const path = join(tmpdir(), `fetch-test-${Date.now()}.yaml`);
    writeCostYaml(path, [{ generationId: "gen-1", costUsd: null }]);

    await fetchPassCosts(path); // should not throw

    const parsed = parseYaml(readFileSync(path, "utf-8")) as { records: CostRecord[] };
    expect(parsed.records[0]!.costUsd).toBeNull(); // unchanged
    rmSync(path);
  });

  test("skips when LLM_BASE_URL is not OpenRouter", async () => {
    process.env["LLM_API_KEY"] = "test-key";
    process.env["LLM_BASE_URL"] = "http://localhost:11434";

    const { fetchPassCosts } = await import("../fetcher");
    const path = join(tmpdir(), `fetch-test-${Date.now()}.yaml`);
    writeCostYaml(path, [{ generationId: "gen-1", costUsd: null }]);

    await fetchPassCosts(path);

    const parsed = parseYaml(readFileSync(path, "utf-8")) as { records: CostRecord[] };
    expect(parsed.records[0]!.costUsd).toBeNull();
    rmSync(path);
  });

  test("updates costUsd from OpenRouter and rewrites YAML", async () => {
    process.env["LLM_API_KEY"] = "test-key";
    process.env["LLM_BASE_URL"] = "https://openrouter.ai/api/v1";

    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: { total_cost: 0.00042 } }),
      } as Response),
    );

    const { fetchPassCosts } = await import("../fetcher");
    const path = join(tmpdir(), `fetch-test-${Date.now()}.yaml`);
    writeCostYaml(path, [
      { generationId: "gen-1", costUsd: null, model: "openai/gpt-4o-mini", inputTokens: 100, outputTokens: 50 },
    ]);

    await fetchPassCosts(path);

    const parsed = parseYaml(readFileSync(path, "utf-8")) as { records: CostRecord[] };
    expect(parsed.records[0]!.costUsd).toBeCloseTo(0.00042);
    rmSync(path);
  });

  // Retry loop has 3 delays (3s+6s+12s=21s) — set timeout above that.
  test(
    "leaves costUsd null when OpenRouter returns 404 for all attempts",
    async () => {
      process.env["LLM_API_KEY"] = "test-key";
      process.env["LLM_BASE_URL"] = "https://openrouter.ai/api/v1";

      global.fetch = mock(() =>
        Promise.resolve({ ok: false, status: 404 } as Response),
      );

      const { fetchPassCosts } = await import("../fetcher");
      const path = join(tmpdir(), `fetch-test-${Date.now()}.yaml`);
      writeCostYaml(path, [{ generationId: "gen-1", costUsd: null }]);

      await fetchPassCosts(path);

      const parsed = parseYaml(readFileSync(path, "utf-8")) as { records: CostRecord[] };
      expect(parsed.records[0]!.costUsd).toBeNull();
      rmSync(path);
    },
    30_000,
  );
});
