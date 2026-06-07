export type CostRole = "character" | "orchestrator" | "judge" | "reconstructor" | "comparator";

export type CostMeta = {
  conversationId: string;
  segmentIdx: number | null;
  role: CostRole;
  model: string;
  generationId: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  cachedTokens: number | null;
  latencyMs: number;
};

export type CostRecord = CostMeta & {
  costUsd: number | null;
};
