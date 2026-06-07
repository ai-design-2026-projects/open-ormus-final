import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml } from "yaml";
import { CostTracker } from "../tracker";
import type { CostMeta } from "../types";

const sampleMeta: CostMeta = {
  conversationId: "001",
  segmentIdx: null,
  role: "judge",
  model: "openai/gpt-4o-mini",
  generationId: "gen-abc123",
  inputTokens: 100,
  outputTokens: 50,
  reasoningTokens: null,
  cachedTokens: null,
  latencyMs: 500,
};

describe("CostTracker", () => {
  test("flush writes records as YAML with costUsd null", async () => {
    const tracker = new CostTracker();
    tracker.record(sampleMeta);

    const outputPath = join(tmpdir(), `tracker-test-${Date.now()}.yaml`);
    await tracker.flush(outputPath);

    const parsed = parseYaml(readFileSync(outputPath, "utf-8")) as { records: unknown[] };
    expect(parsed.records).toHaveLength(1);
    expect((parsed.records[0] as { costUsd: unknown }).costUsd).toBeNull();
    expect((parsed.records[0] as { model: string }).model).toBe("openai/gpt-4o-mini");
    rmSync(outputPath);
  });

  test("flush creates parent directory if missing", async () => {
    const tracker = new CostTracker();
    const dir = join(tmpdir(), `tracker-nested-${Date.now()}`);
    const outputPath = join(dir, "costs", "test.yaml");

    await tracker.flush(outputPath);

    expect(existsSync(outputPath)).toBe(true);
    rmSync(dir, { recursive: true });
  });

  test("flush with no records writes empty records array", async () => {
    const tracker = new CostTracker();
    const outputPath = join(tmpdir(), `tracker-empty-${Date.now()}.yaml`);
    await tracker.flush(outputPath);

    const parsed = parseYaml(readFileSync(outputPath, "utf-8")) as { records: unknown[] };
    expect(parsed.records).toHaveLength(0);
    rmSync(outputPath);
  });
});
