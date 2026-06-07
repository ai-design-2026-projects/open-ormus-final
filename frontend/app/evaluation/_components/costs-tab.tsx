"use client";

import { useEffect, useState } from "react";
import type { PassAggregate, TokenStats } from "../../api/evaluation/[dataset]/[evalName]/costs/utils";

type CostResponse = {
  passes: Record<string, PassAggregate>;
  grandTotal: { costUsd: number | null; inputTokens: number; outputTokens: number };
};

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function fmtCost(usd: number | null): string {
  if (usd === null) return "—";
  if (usd < 0.001) return "<$0.001";
  return `$${usd.toFixed(3)}`;
}

function fmtStats(s: TokenStats): string {
  return `${fmt(s.inputTokens)} in · ${fmt(s.outputTokens)} out · ${fmtCost(s.costUsd)}`;
}

function PassSection({ passKey, agg }: { passKey: string; agg: PassAggregate }) {
  const [open, setOpen] = useState(false);
  const [openConvs, setOpenConvs] = useState<Set<string>>(new Set());

  const label = passKey.replace(/_/g, " ");

  const toggleConv = (id: string) => {
    setOpenConvs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/50 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-medium capitalize text-[14px]">{label}</span>
        <span className="text-[13px] text-muted-foreground">
          {fmtCost(agg.totalCostUsd)} · {fmt(agg.totalInputTokens)} in · {fmt(agg.totalOutputTokens)} out
        </span>
      </button>

      {open && (
        <div className="border-t px-4 py-3 space-y-4">
          {/* Role breakdown */}
          {Object.keys(agg.byRole).length > 0 && (
            <div>
              <p className="text-[12px] text-muted-foreground uppercase tracking-wide mb-2">By role</p>
              <div className="space-y-1">
                {Object.entries(agg.byRole).map(([role, stats]) => (
                  <div key={role} className="flex justify-between text-[13px]">
                    <span className="text-muted-foreground">{role}</span>
                    <span>{fmtStats(stats!)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Model breakdown (judge_guessing) */}
          {Object.keys(agg.byModel).length > 0 && passKey === "judge_guessing" && (
            <div>
              <p className="text-[12px] text-muted-foreground uppercase tracking-wide mb-2">By model</p>
              <div className="space-y-1">
                {Object.entries(agg.byModel).map(([model, stats]) => (
                  <div key={model} className="flex justify-between text-[13px]">
                    <span className="text-muted-foreground font-mono text-[12px]">{model}</span>
                    <span>{fmtStats(stats)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Per conversation */}
          {agg.byConversation.length > 0 && (
            <div>
              <p className="text-[12px] text-muted-foreground uppercase tracking-wide mb-2">By conversation</p>
              <div className="space-y-1">
                {agg.byConversation.map((conv) => (
                  <div key={conv.conversationId}>
                    <button
                      className="w-full flex items-center justify-between text-[13px] hover:text-foreground text-muted-foreground py-0.5"
                      onClick={() => conv.segments.length > 0 && toggleConv(conv.conversationId)}
                    >
                      <span>{conv.segments.length > 0 ? (openConvs.has(conv.conversationId) ? "▼" : "▶") : " "} {conv.conversationId}</span>
                      <span>{fmtStats(conv.total)}</span>
                    </button>

                    {openConvs.has(conv.conversationId) && conv.segments.map((seg) => (
                      <div key={seg.segmentIdx} className="pl-6 py-0.5">
                        <div className="flex justify-between text-[12px] text-muted-foreground mb-0.5">
                          <span>segment {seg.segmentIdx}</span>
                        </div>
                        {Object.entries(seg.byRole).map(([role, stats]) => (
                          <div key={role} className="flex justify-between text-[12px] text-muted-foreground pl-3">
                            <span>{role}</span>
                            <span>{fmtStats(stats!)}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const PASS_ORDER = ["generation", "judge_guessing", "reconstruct_persona", "context_drift"];

export function CostsTab({ dataset, evalName }: { dataset: string; evalName: string }) {
  const [data, setData] = useState<CostResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/evaluation/${dataset}/${evalName}/costs`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<CostResponse>;
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [dataset, evalName]);

  if (loading) return <p className="text-[13px] text-muted-foreground">Loading costs…</p>;
  if (error) return <p className="text-[13px] text-destructive">Failed to load costs: {error}</p>;
  if (!data) return null;

  const hasPasses = Object.keys(data.passes).length > 0;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 px-4 py-3 flex items-center justify-between">
        <span className="font-medium text-[14px]">Grand Total</span>
        <span className="text-[13px]">
          {fmtCost(data.grandTotal.costUsd)} · {fmt(data.grandTotal.inputTokens)} in · {fmt(data.grandTotal.outputTokens)} out
        </span>
      </div>

      {!hasPasses ? (
        <p className="text-[13px] text-muted-foreground">No cost data yet — run a pass first.</p>
      ) : (
        <div className="space-y-2">
          {PASS_ORDER.filter((k) => data.passes[k]).map((passKey) => (
            <PassSection key={passKey} passKey={passKey} agg={data.passes[passKey]!} />
          ))}
        </div>
      )}
    </div>
  );
}
