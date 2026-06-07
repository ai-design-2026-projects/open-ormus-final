import { describe, test, expect } from "bun:test";
import { aggregateCostRecords } from "../utils";
import type { CostRecord } from "../utils";

const record = (overrides: Partial<CostRecord>): CostRecord => ({
  conversationId: "001",
  segmentIdx: null,
  role: "judge",
  model: "openai/gpt-4o-mini",
  generationId: "gen-abc",
  inputTokens: 100,
  outputTokens: 50,
  reasoningTokens: null,
  cachedTokens: null,
  costUsd: 0.001,
  latencyMs: 500,
  ...overrides,
});

describe("aggregateCostRecords", () => {
  test("sums inputTokens and outputTokens across records", () => {
    const records = [
      record({ inputTokens: 100, outputTokens: 50, costUsd: 0.001 }),
      record({ inputTokens: 200, outputTokens: 80, costUsd: 0.002 }),
    ];
    const result = aggregateCostRecords(records);
    expect(result.totalInputTokens).toBe(300);
    expect(result.totalOutputTokens).toBe(130);
    expect(Math.abs((result.totalCostUsd ?? 0) - 0.003) < 1e-9).toBe(true);
  });

  test("totalCostUsd is null when any record has null costUsd", () => {
    const records = [
      record({ costUsd: 0.001 }),
      record({ costUsd: null }),
    ];
    const result = aggregateCostRecords(records);
    expect(result.totalCostUsd).toBeNull();
  });

  test("groups by role correctly", () => {
    const records = [
      record({ role: "reconstructor", inputTokens: 100, costUsd: 0.001 }),
      record({ role: "comparator", inputTokens: 200, costUsd: 0.002 }),
      record({ role: "reconstructor", inputTokens: 50, costUsd: 0.0005 }),
    ];
    const result = aggregateCostRecords(records);
    expect(result.byRole["reconstructor"]?.inputTokens).toBe(150);
    expect(result.byRole["comparator"]?.inputTokens).toBe(200);
  });

  test("groups by model correctly", () => {
    const records = [
      record({ model: "openai/gpt-4o-mini", inputTokens: 100, costUsd: 0.001 }),
      record({ model: "qwen/qwen-2.5", inputTokens: 200, costUsd: 0.002 }),
    ];
    const result = aggregateCostRecords(records);
    expect(result.byModel["openai/gpt-4o-mini"]?.inputTokens).toBe(100);
    expect(result.byModel["qwen/qwen-2.5"]?.inputTokens).toBe(200);
  });

  test("groups by conversation with segment breakdown", () => {
    const records = [
      record({ conversationId: "001", segmentIdx: 0, role: "reconstructor", inputTokens: 100, costUsd: 0.001 }),
      record({ conversationId: "001", segmentIdx: 1, role: "reconstructor", inputTokens: 50, costUsd: 0.0005 }),
      record({ conversationId: "002", segmentIdx: 0, role: "judge", inputTokens: 80, costUsd: 0.0008 }),
    ];
    const result = aggregateCostRecords(records);
    expect(result.byConversation).toHaveLength(2);
    const conv001 = result.byConversation.find((c) => c.conversationId === "001");
    expect(conv001?.total.inputTokens).toBe(150);
    expect(conv001?.segments).toHaveLength(2);
  });
});
