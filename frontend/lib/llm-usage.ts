import { prisma } from "@/lib/prisma";
import type { LlmUsageSource } from "@/lib/generated/prisma/client";

export type UsageContext = {
  source: LlmUsageSource;
  conversationId?: string;
  agentSessionId?: string;
  userId?: string;
};

export type RawUsage = {
  generationId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cachedTokens?: number;
  latencyMs: number;
};

export function isOpenRouter(): boolean {
  return (process.env.LLM_BASE_URL ?? "").includes("openrouter.ai");
}

// OpenRouter indexes a generation for cost queries asynchronously after the
// stream ends. Empirically this takes several seconds. Use exponential-ish
// delays so we don't hammer the endpoint but still converge quickly.
const COST_RETRY_DELAYS_MS =
  process.env.NODE_ENV === "test" ? [0, 0] : [3000, 6000, 12000];

async function fetchOpenRouterCost(generationId: string): Promise<number | null> {
  for (let attempt = 0; attempt <= COST_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, COST_RETRY_DELAYS_MS[attempt - 1]));
    }
    const res = await fetch(
      `https://openrouter.ai/api/v1/generation?id=${generationId}`,
      { headers: { Authorization: `Bearer ${process.env.LLM_API_KEY}` } },
    );
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`OpenRouter generation fetch failed: ${res.status}`);
    const body = (await res.json()) as { data?: { total_cost?: number } };
    const cost = body.data?.total_cost;
    if (cost === undefined) throw new Error("OpenRouter generation response missing total_cost");
    return cost;
  }
  // Persistent 404 — model/provider doesn't report cost data.
  return null;
}

async function backfillCost(recordId: string, generationId: string): Promise<void> {
  try {
    const costUsd = await fetchOpenRouterCost(generationId);
    if (costUsd !== null) {
      await prisma.llmUsage.update({ where: { id: recordId }, data: { costUsd } });
    }
  } catch (err) {
    console.error("[logLlmUsage] cost backfill failed:", err);
  }
}

export async function logLlmUsage(ctx: UsageContext, raw: RawUsage): Promise<void> {
  try {
    const record = await prisma.llmUsage.create({
      data: {
        source: ctx.source,
        conversationId: ctx.conversationId ?? null,
        agentSessionId: ctx.agentSessionId ?? null,
        userId: ctx.userId ?? null,
        model: raw.model,
        inputTokens: raw.inputTokens,
        outputTokens: raw.outputTokens,
        reasoningTokens: raw.reasoningTokens ?? null,
        cachedTokens: raw.cachedTokens ?? null,
        costUsd: null,
        latencyMs: raw.latencyMs,
      },
    });
    // Fire-and-forget: fetch cost after OpenRouter has had time to index it.
    if (isOpenRouter() && raw.generationId) {
      void backfillCost(record.id, raw.generationId);
    }
  } catch (err) {
    console.error("[logLlmUsage] failed to record usage:", err);
  }
}
