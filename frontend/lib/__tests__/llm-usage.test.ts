import { mock } from "bun:test";

type CreateArg = { data: Record<string, unknown> };
type UpdateArg = { where: Record<string, unknown>; data: Record<string, unknown> };
const createCalls: CreateArg[] = [];
const updateCalls: UpdateArg[] = [];

mock.module("@/lib/prisma", () => ({
  prisma: {
    llmUsage: {
      create: async (arg: CreateArg) => {
        createCalls.push(arg);
        return { id: "usage-1" };
      },
      update: async (arg: UpdateArg) => {
        updateCalls.push(arg);
        return { id: "usage-1" };
      },
    },
  },
}));

import { describe, test, expect } from "bun:test";
import { logLlmUsage, isOpenRouter } from "../llm-usage";
import { LlmUsageSource } from "../generated/prisma/client";

const baseCtx = {
  source: LlmUsageSource.CONVERSATION,
  conversationId: "11111111-0000-0000-0000-000000000001",
  userId: "11111111-0000-0000-0000-000000000002",
};
const baseRaw = {
  generationId: "gen-abc123",
  model: "gemini/gemini-2.5-flash",
  inputTokens: 100,
  outputTokens: 50,
  latencyMs: 200,
};

function resetCalls() {
  createCalls.length = 0;
  updateCalls.length = 0;
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  global.fetch = async (url: RequestInfo | URL, init?: RequestInit) =>
    handler(String(url), init);
}

// Wait for fire-and-forget backfill tasks (delays are 0ms in test mode).
const flushBackfill = () => new Promise<void>((resolve) => setTimeout(resolve, 50));

describe("isOpenRouter", () => {
  test("returns true when LLM_BASE_URL contains openrouter.ai", () => {
    process.env.LLM_BASE_URL = "https://openrouter.ai/api/v1";
    expect(isOpenRouter()).toBe(true);
  });

  test("returns false for other base URLs", () => {
    process.env.LLM_BASE_URL = "http://localhost:11434/v1";
    expect(isOpenRouter()).toBe(false);
  });

  test("returns false when LLM_BASE_URL is unset", () => {
    delete process.env.LLM_BASE_URL;
    expect(isOpenRouter()).toBe(false);
  });
});

describe("logLlmUsage", () => {
  test("non-OpenRouter: writes record to DB with null cost, no fetch", async () => {
    resetCalls();
    process.env.LLM_BASE_URL = "http://localhost:11434/v1";

    await logLlmUsage(baseCtx, baseRaw);

    expect(createCalls.length).toBe(1);
    const { data } = createCalls[0]!;
    expect(data.costUsd).toBeNull();
    expect(data.inputTokens).toBe(100);
    expect(data.outputTokens).toBe(50);
    expect(data.latencyMs).toBe(200);
    expect(data.model).toBe("gemini/gemini-2.5-flash");
    expect(data.source).toBe(LlmUsageSource.CONVERSATION);
    expect(updateCalls.length).toBe(0);
  });

  test("OpenRouter: creates record with null cost then updates with fetched cost", async () => {
    resetCalls();
    process.env.LLM_BASE_URL = "https://openrouter.ai/api/v1";
    process.env.LLM_API_KEY = "test-key";
    stubFetch(async () =>
      new Response(JSON.stringify({ data: { total_cost: 0.00123 } }), { status: 200 }),
    );

    await logLlmUsage(baseCtx, baseRaw);
    // Record created synchronously with null cost.
    expect(createCalls.length).toBe(1);
    expect(createCalls[0]!.data.costUsd).toBeNull();

    // Backfill runs asynchronously; wait for it.
    await flushBackfill();
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0]!.data.costUsd).toBe(0.00123);
    expect(updateCalls[0]!.where).toEqual({ id: "usage-1" });
  });

  test("OpenRouter: fetches from correct URL with Authorization header", async () => {
    resetCalls();
    process.env.LLM_BASE_URL = "https://openrouter.ai/api/v1";
    process.env.LLM_API_KEY = "my-key";
    const capturedUrl: string[] = [];
    const capturedHeaders: Record<string, string>[] = [];
    stubFetch(async (url, init) => {
      capturedUrl.push(url);
      capturedHeaders.push((init?.headers ?? {}) as Record<string, string>);
      return new Response(JSON.stringify({ data: { total_cost: 0.001 } }), { status: 200 });
    });

    await logLlmUsage(baseCtx, { ...baseRaw, generationId: "gen-xyz" });
    await flushBackfill();

    expect(capturedUrl[0]).toBe("https://openrouter.ai/api/v1/generation?id=gen-xyz");
    expect(capturedHeaders[0]?.Authorization).toBe("Bearer my-key");
  });

  test("OpenRouter: writes null cost when generation endpoint returns persistent 404", async () => {
    resetCalls();
    process.env.LLM_BASE_URL = "https://openrouter.ai/api/v1";
    stubFetch(async () => new Response("Not Found", { status: 404 }));

    await expect(logLlmUsage(baseCtx, baseRaw)).resolves.toBeUndefined();
    await flushBackfill();

    // Record created; no update since cost remained null.
    expect(createCalls.length).toBe(1);
    expect(createCalls[0]!.data.costUsd).toBeNull();
    expect(updateCalls.length).toBe(0);
  });

  test("OpenRouter: swallows error and skips update when total_cost missing from response", async () => {
    resetCalls();
    process.env.LLM_BASE_URL = "https://openrouter.ai/api/v1";
    stubFetch(async () =>
      new Response(JSON.stringify({ data: {} }), { status: 200 }),
    );

    await expect(logLlmUsage(baseCtx, baseRaw)).resolves.toBeUndefined();
    await flushBackfill();

    // Record is still written (null cost); only the update is skipped.
    expect(createCalls.length).toBe(1);
    expect(createCalls[0]!.data.costUsd).toBeNull();
    expect(updateCalls.length).toBe(0);
  });

  test("writes optional token fields when provided", async () => {
    resetCalls();
    process.env.LLM_BASE_URL = "http://localhost:11434/v1";

    await logLlmUsage(baseCtx, { ...baseRaw, reasoningTokens: 30, cachedTokens: 10 });

    const { data } = createCalls[0]!;
    expect(data.reasoningTokens).toBe(30);
    expect(data.cachedTokens).toBe(10);
  });

  test("writes null for optional token fields when not provided", async () => {
    resetCalls();
    process.env.LLM_BASE_URL = "http://localhost:11434/v1";

    await logLlmUsage(baseCtx, baseRaw);

    const { data } = createCalls[0]!;
    expect(data.reasoningTokens).toBeNull();
    expect(data.cachedTokens).toBeNull();
  });
});
