export type CostRole = "character" | "orchestrator" | "judge" | "reconstructor" | "comparator";

export type CostRecord = {
  conversationId: string;
  segmentIdx: number | null;
  role: CostRole;
  model: string;
  generationId: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  cachedTokens: number | null;
  costUsd: number | null;
  latencyMs: number;
};

export type TokenStats = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
};

export type SegmentCost = {
  segmentIdx: number;
  byRole: Partial<Record<CostRole, TokenStats>>;
};

export type ConversationCost = {
  conversationId: string;
  total: TokenStats;
  segments: SegmentCost[];
};

export type PassAggregate = {
  totalCostUsd: number | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  byRole: Partial<Record<CostRole, TokenStats>>;
  byModel: Record<string, TokenStats>;
  byConversation: ConversationCost[];
};

function zeroStats(): TokenStats {
  return { inputTokens: 0, outputTokens: 0, costUsd: 0 };
}

function addStats(a: TokenStats, b: TokenStats): TokenStats {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: a.costUsd !== null && b.costUsd !== null ? a.costUsd + b.costUsd : null,
  };
}

export function aggregateCostRecords(records: CostRecord[]): PassAggregate {
  let totalCostUsd: number | null = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const byRole: Partial<Record<CostRole, TokenStats>> = {};
  const byModel: Record<string, TokenStats> = {};
  const convMap = new Map<
    string,
    { total: TokenStats; segMap: Map<number, { byRole: Partial<Record<CostRole, TokenStats>> }> }
  >();

  for (const r of records) {
    if (r.costUsd === null) totalCostUsd = null;
    if (totalCostUsd !== null) totalCostUsd += r.costUsd ?? 0;
    totalInputTokens += r.inputTokens;
    totalOutputTokens += r.outputTokens;

    const rStats: TokenStats = { inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd };

    byRole[r.role] = addStats(byRole[r.role] ?? zeroStats(), rStats);
    byModel[r.model] = addStats(byModel[r.model] ?? zeroStats(), rStats);

    if (!convMap.has(r.conversationId)) {
      convMap.set(r.conversationId, { total: zeroStats(), segMap: new Map() });
    }
    const conv = convMap.get(r.conversationId)!;
    conv.total = addStats(conv.total, rStats);

    if (r.segmentIdx !== null) {
      if (!conv.segMap.has(r.segmentIdx)) {
        conv.segMap.set(r.segmentIdx, { byRole: {} });
      }
      const seg = conv.segMap.get(r.segmentIdx)!;
      seg.byRole[r.role] = addStats(seg.byRole[r.role] ?? zeroStats(), rStats);
    }
  }

  const byConversation: ConversationCost[] = Array.from(convMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([conversationId, { total, segMap }]) => ({
      conversationId,
      total,
      segments: Array.from(segMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([segmentIdx, { byRole: segByRole }]) => ({ segmentIdx, byRole: segByRole })),
    }));

  return {
    totalCostUsd,
    totalInputTokens,
    totalOutputTokens,
    byRole,
    byModel,
    byConversation,
  };
}
