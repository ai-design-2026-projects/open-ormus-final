"use client";
import { useEffect, useState } from "react";

// ── Data types (mirrors evaluation/drift/types.ts) ────────────────────────────

type EngagementLabel = "active" | "touched" | "absent";
type AlignmentLabel = "consistent" | "neutral" | "contradicts";
type Verdict = "degrading" | "stable" | "improving";

interface EngagementScore {
  label: EngagementLabel;
  votes: EngagementLabel[];
  confidence: number;
  score: number;
}

interface CharacterAlignmentScore {
  character_id: string;
  archetype: string;
  label: AlignmentLabel;
  votes: AlignmentLabel[];
  confidence: number;
  score: number;
}

interface SegmentScore {
  index: number;
  turn_range: [number, number];
  scenario_engagement: EngagementScore;
  personality_alignment: CharacterAlignmentScore[];
  low_confidence: boolean;
}

interface ScenarioEngagementDrift {
  deltas: unknown[];
  total: number;
  verdict: Verdict;
}

interface CharacterDrift {
  character_id: string;
  archetype: string;
  deltas: number[];
  total: number;
  verdict: Verdict;
}

interface ConversationDriftResult {
  conversation_file: string;
  scenario_id: string;
  scenario_title: string;
  stress_axes: string[];
  segments: SegmentScore[];
  drift: {
    scenario_engagement: ScenarioEngagementDrift;
    personality_alignment: CharacterDrift[];
  };
}

interface DriftPassData {
  conversations: ConversationDriftResult[];
  summary: unknown;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function verdictBadge(verdict: Verdict): { label: string; color: string } {
  if (verdict === "improving") return { label: "improving ↑", color: "text-green-600" };
  if (verdict === "degrading") return { label: "degrading ↓", color: "text-red-500" };
  return { label: "stable →", color: "text-muted-foreground" };
}

function countVerdicts(
  conversations: ConversationDriftResult[],
  dimension: "engagement" | "alignment",
): { degrading: number; stable: number; improving: number } {
  const counts = { degrading: 0, stable: 0, improving: 0 };
  for (const conv of conversations) {
    if (dimension === "engagement") {
      counts[conv.drift.scenario_engagement.verdict]++;
    } else {
      for (const charDrift of conv.drift.personality_alignment) {
        counts[charDrift.verdict]++;
      }
    }
  }
  return counts;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function VerdictCounts({
  counts,
  label,
}: {
  counts: { degrading: number; stable: number; improving: number };
  label: string;
}) {
  return (
    <div className="text-[13px]">
      <span className="text-muted-foreground">{label}: </span>
      <span className="text-red-500 font-medium">{counts.degrading} degrading</span>
      <span className="text-muted-foreground"> · </span>
      <span className="text-muted-foreground font-medium">{counts.stable} stable</span>
      <span className="text-muted-foreground"> · </span>
      <span className="text-green-600 font-medium">{counts.improving} improving</span>
    </div>
  );
}

const STATE_COLORS: Record<string, string> = {
  // engagement
  active:   "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  touched:  "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  absent:   "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  // alignment
  consistent: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  neutral:    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  contradicts:"bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

function StateCell({
  label,
  lowConf,
  votes,
}: {
  label: string;
  lowConf: boolean;
  votes: string[];
}) {
  const colorClass = STATE_COLORS[label] ?? "bg-muted text-muted-foreground";
  const title = lowConf ? `Judges split — votes: ${votes.join(", ")}` : `Votes: ${votes.join(", ")}`;
  return (
    <td
      title={title}
      className={`px-2 py-1.5 text-center text-[11px] font-medium rounded ${colorClass} ${
        lowConf ? "border-2 border-dashed border-amber-400" : ""
      }`}
    >
      {label}
      {lowConf && <span className="ml-0.5 text-amber-500 text-[9px]">?</span>}
    </td>
  );
}

function ConversationGrid({
  conv,
  realNameMap,
}: {
  conv: ConversationDriftResult;
  realNameMap: Map<string, string>;
}) {
  const { segments } = conv;

  // Collect unique characters across all segments, in first-appearance order
  const charIds: string[] = [];
  const charMeta = new Map<string, { archetype: string }>();
  for (const seg of segments) {
    for (const ca of seg.personality_alignment) {
      if (!charMeta.has(ca.character_id)) {
        charIds.push(ca.character_id);
        charMeta.set(ca.character_id, { archetype: ca.archetype });
      }
    }
  }

  return (
    <div className="border rounded-lg p-4 space-y-3">
      {/* Scenario header */}
      <div>
        <p className="font-medium text-[14px]">{conv.scenario_title}</p>
        {conv.stress_axes.length > 0 && (
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {conv.stress_axes.join(" · ")}
          </p>
        )}
      </div>

      {/* State grid */}
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 text-[12px]">
          <thead>
            <tr>
              <th className="text-left text-[11px] text-muted-foreground font-normal pr-3 w-40" />
              {segments.map((seg) => (
                <th
                  key={seg.index}
                  className="text-center text-[10px] text-muted-foreground font-medium px-1 min-w-[80px]"
                >
                  S{seg.index}
                  <span className="block text-[9px] font-normal opacity-70">
                    turns {seg.turn_range[0]}–{seg.turn_range[1]}
                  </span>
                </th>
              ))}
              <th className="text-right text-[11px] text-muted-foreground font-normal pl-3 w-28">
                verdict
              </th>
            </tr>
          </thead>
          <tbody>
            {/* Engagement row */}
            <tr>
              <td className="text-[11px] text-muted-foreground pr-3 py-0.5 font-medium">
                Engagement
              </td>
              {segments.map((seg) => {
                const e = seg.scenario_engagement;
                const lowConf = seg.low_confidence || e.confidence < 1;
                return (
                  <StateCell
                    key={seg.index}
                    label={e.label}
                    lowConf={lowConf}
                    votes={e.votes}
                  />
                );
              })}
              <td className="text-right pl-3 py-0.5">
                {(() => {
                  const b = verdictBadge(conv.drift.scenario_engagement.verdict);
                  return <span className={`text-[11px] font-medium ${b.color}`}>{b.label}</span>;
                })()}
              </td>
            </tr>

            {/* Divider */}
            <tr><td colSpan={segments.length + 2} className="py-0.5"><hr className="border-border/40" /></td></tr>

            {/* Per-character rows */}
            {charIds.map((charId) => {
              const meta = charMeta.get(charId)!;
              const realName = realNameMap.get(charId);
              const displayName = realName
                ? `${realName} (${meta.archetype})`
                : meta.archetype;
              const charVerdict = conv.drift.personality_alignment.find(
                (c) => c.character_id === charId,
              );
              return (
                <tr key={charId}>
                  <td className="text-[11px] pr-3 py-0.5 text-foreground truncate max-w-[160px]" title={displayName}>
                    {displayName}
                  </td>
                  {segments.map((seg) => {
                    const ca = seg.personality_alignment.find(
                      (c) => c.character_id === charId,
                    );
                    if (!ca) {
                      return (
                        <td key={seg.index} className="text-center text-[10px] text-muted-foreground px-2 py-1.5">
                          —
                        </td>
                      );
                    }
                    const lowConf = ca.confidence < 1;
                    return (
                      <StateCell
                        key={seg.index}
                        label={ca.label}
                        lowConf={lowConf}
                        votes={ca.votes}
                      />
                    );
                  })}
                  <td className="text-right pl-3 py-0.5">
                    {charVerdict ? (() => {
                      const b = verdictBadge(charVerdict.verdict);
                      return <span className={`text-[11px] font-medium ${b.color}`}>{b.label}</span>;
                    })() : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GridLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      <span className="font-medium text-foreground">Legend:</span>
      <span><span className="inline-block w-2 h-2 rounded-sm bg-green-400 mr-1" />consistent / active</span>
      <span><span className="inline-block w-2 h-2 rounded-sm bg-amber-400 mr-1" />neutral / touched</span>
      <span><span className="inline-block w-2 h-2 rounded-sm bg-red-400 mr-1" />contradicts / absent</span>
      <span className="border border-dashed border-amber-400 px-1 rounded">? = judges split</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function DriftTab({ dataset, evalName }: { dataset: string; evalName: string }) {
  const [data, setData] = useState<DriftPassData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [realNameMap, setRealNameMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`/api/evaluation/${encodeURIComponent(dataset)}/${encodeURIComponent(evalName)}/context_drift`)
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<DriftPassData | null>; }),
      fetch("/api/evaluation/dataset-reference")
        .then(r => r.json())
        .catch(() => ({ characters: [] })),
    ])
    .then(([driftData, refData]: [unknown, unknown]) => {
      setData(driftData as DriftPassData | null);
      const ref = (refData as { characters?: Array<{ id?: string; name?: string }> } | null)?.characters ?? [];
      const map = new Map<string, string>();
      for (const ch of ref) { if (ch.id && ch.name) map.set(ch.id, ch.name); }
      setRealNameMap(map);
    })
    .catch((e: unknown) => setError(String(e)))
    .finally(() => setLoading(false));
  }, [dataset, evalName]);

  if (error) return <p className="text-red-500 text-[13px]">{error}</p>;
  if (loading) return <p className="text-muted-foreground text-[13px]">Loading…</p>;
  if (data === null || !Array.isArray(data.conversations)) {
    return (
      <p className="text-red-500 text-[13px]">
        Context drift pass not run — this evaluation is incomplete.
      </p>
    );
  }
  if (data.conversations.length === 0) {
    return (
      <p className="text-muted-foreground text-[13px]">No conversations in drift results.</p>
    );
  }

  const { conversations } = data;
  const engagementCounts = countVerdicts(conversations, "engagement");
  const alignmentCounts = countVerdicts(conversations, "alignment");

  return (
    <div className="space-y-8">
      {/* Header strip */}
      <section className="space-y-1.5">
        <VerdictCounts counts={engagementCounts} label="Scenario engagement" />
        <VerdictCounts counts={alignmentCounts} label="Personality alignment" />
        {/* Honest caveat when engagement is uniformly active */}
        {(() => {
          const allActive = conversations.every((conv) =>
            conv.segments.every((seg) => seg.scenario_engagement.label === "active")
          );
          return allActive ? (
            <p className="text-[11px] text-muted-foreground italic mt-1">
              All segments rated fully active — the engagement metric shows no variation in this run.
            </p>
          ) : null;
        })()}
      </section>

      {/* Per-conversation grids */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[14px] font-medium">Per-conversation drift</h2>
          <GridLegend />
        </div>
        <div className="space-y-3">
          {conversations.map((conv) => (
            <ConversationGrid
              key={conv.conversation_file}
              conv={conv}
              realNameMap={realNameMap}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
