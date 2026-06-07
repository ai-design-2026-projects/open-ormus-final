"use client";
import React, { useEffect, useState } from "react";

// ── Data types (mirrors evaluation/reconstruct/types.ts) ─────────────────────

const PROFILE_FIELDS = [
  "personalityTraits",
  "speechPatterns",
  "values",
  "fears",
  "goals",
  "copingStyle",
] as const;

type ProfileField = (typeof PROFILE_FIELDS)[number];

interface ItemScore {
  reconstructed_item: string;
  score: 1 | 0 | -1;
  justification: string;
  comparator_scores: Array<{ model: string; score: 1 | 0 | -1 }>;
  comparator_agreement: number;
}

interface FieldScore {
  not_observed: boolean;
  observed_count: number;
  gt_count: number;
  matched: number;
  contradicted: number;
  precision: number;
  recall: number;
  f1: number;
  comparator_agreement: number;
  item_scores?: ItemScore[];
}

interface SegmentResult {
  segment_index: number;
  turn_range: [number, number];
  message_count: number;
  field_scores: Partial<Record<ProfileField, FieldScore>>;
}

interface FieldDriftScore {
  segment_f1s: Array<number | null>;
  observed_segments: number[];
  gt_divergence_slope: number | null;
  internal_consistency: FieldScore | null;
}

interface CharacterResult {
  alias: string;
  real_name: string;
  difficulty_tier: string;
  segments: SegmentResult[];
  field_drift: Partial<Record<ProfileField, FieldDriftScore>>;
  mean_gt_divergence_slope: number | null;
  mean_internal_consistency_f1: number | null;
}

interface ConversationReconstructionResult {
  conversation_file: string;
  scenario_id: string;
  scenario_title: string;
  scenario_difficulty: string;
  scenario_stress_axes: string[];
  segment_count: number;
  characters: CharacterResult[];
}

interface FieldAggregate {
  mean_f1: number | null;
  mean_gt_divergence_slope: number | null;
  mean_internal_consistency_f1: number | null;
  drifting_fraction: number;
}

interface ReconstructionSummary {
  total_conversations: number;
  total_characters_evaluated: number;
  segment_count: number;
  comparator_models: string[];
  mean_inter_comparator_agreement: number;
  field_aggregates: Record<ProfileField, FieldAggregate>;
}

interface ReconstructPassData {
  conversations: ConversationReconstructionResult[];
  summary: ReconstructionSummary | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return v.toFixed(2);
}

/**
 * Mean F1 across all observed field×segment instances for a set of CharacterResults.
 * One real character can appear in multiple conversations under different aliases;
 * pass all of them here to get the cross-conversation mean.
 * Only non-not_observed fields contribute.
 */
function characterMeanF1(chars: CharacterResult[]): number | null {
  const f1s: number[] = [];
  for (const char of chars) {
    for (const seg of char.segments) {
      for (const field of PROFILE_FIELDS) {
        const fs = seg.field_scores[field];
        if (fs && !fs.not_observed) f1s.push(fs.f1);
      }
    }
  }
  if (f1s.length === 0) return null;
  return f1s.reduce((a, b) => a + b, 0) / f1s.length;
}

/**
 * Per-field summary: average precision/recall/f1 across all segments of all
 * CharacterResults for one real character (pools across conversations).
 */
function fieldSummary(
  chars: CharacterResult[],
  field: ProfileField,
): { f1: number; precision: number; recall: number } | null {
  const scores = chars.flatMap((char) =>
    char.segments
      .map((s) => s.field_scores[field])
      .filter((fs): fs is FieldScore => fs !== undefined && !fs.not_observed),
  );
  if (scores.length === 0) return null;
  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  return {
    f1: mean(scores.map((s) => s.f1)),
    precision: mean(scores.map((s) => s.precision)),
    recall: mean(scores.map((s) => s.recall)),
  };
}

/** Overall mean F1 across all characters and fields from summary. */
function overallMeanF1(summary: ReconstructionSummary): number | null {
  const f1s = PROFILE_FIELDS.map((f) => summary.field_aggregates[f]?.mean_f1 ?? null).filter(
    (v): v is number => v !== null,
  );
  if (f1s.length === 0) return null;
  return f1s.reduce((a, b) => a + b, 0) / f1s.length;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Stat({ label, value, tooltip }: { label: string; value: string; tooltip?: string }) {
  return (
    <div className="border rounded-lg px-4 py-3 text-center" title={tooltip}>
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      <p className="text-[20px] font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function FieldTable({ chars }: { chars: CharacterResult[] }) {
  const [expandedFields, setExpandedFields] = useState<Set<ProfileField>>(new Set());

  function toggleField(f: ProfileField) {
    setExpandedFields((prev) => {
      const next = new Set(prev);
      next.has(f) ? next.delete(f) : next.add(f);
      return next;
    });
  }

  const rows = PROFILE_FIELDS.map((field) => ({
    field,
    scores: fieldSummary(chars, field),
  }));

  return (
    <div className="mt-3 border-t pt-3">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-[11px] text-muted-foreground uppercase tracking-wide">
            <th className="text-left pb-1.5 font-medium">Field</th>
            <th className="text-right pb-1.5 font-medium">F1</th>
            <th className="text-right pb-1.5 font-medium">Precision</th>
            <th className="text-right pb-1.5 font-medium">Recall</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ field, scores }) => {
            const isExpanded = expandedFields.has(field);
            // Pool item-level detail across all chars × conversations
            const allItems = chars.flatMap((char) =>
              char.segments.flatMap((seg, segIdx) => {
                const fs = seg.field_scores[field];
                if (!fs || fs.not_observed || !fs.item_scores) return [];
                const segLabel = char.segments.length > 1 ? `S${segIdx + 1}` : null;
                return fs.item_scores.map((item) => ({ ...item, segLabel }));
              }),
            );

            return (
              <React.Fragment key={field}>
                <tr
                  className="border-t border-border/40 cursor-pointer hover:bg-muted/10"
                  onClick={() => toggleField(field)}
                >
                  <td className="py-1.5 text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className="text-[10px]">{isExpanded ? "▲" : "▼"}</span>
                      {field}
                    </span>
                  </td>
                  {scores ? (
                    <>
                      <td className="py-1.5 text-right tabular-nums font-medium">
                        {fmt(scores.f1)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                        {fmt(scores.precision)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                        {fmt(scores.recall)}
                      </td>
                    </>
                  ) : (
                    <td colSpan={3} className="py-1.5 text-right text-muted-foreground italic">
                      not observed
                    </td>
                  )}
                </tr>
                {isExpanded && (
                  <tr key={`${field}-detail`}>
                    <td colSpan={4} className="px-2 pb-2 bg-muted/10">
                      {allItems.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground italic py-1">
                          No item detail available.
                        </p>
                      ) : (
                        <div className="space-y-0 text-[12px] mt-1">
                          {allItems.map((item, i) => {
                            const scoreIcon =
                              item.score === 1 ? (
                                <span className="text-green-600">✓</span>
                              ) : item.score === -1 ? (
                                <span className="text-red-500">✗</span>
                              ) : (
                                <span className="text-muted-foreground">·</span>
                              );
                            const scoreLabel =
                              item.score === 1
                                ? "match"
                                : item.score === -1
                                  ? "contradiction"
                                  : "no match";
                            return (
                              <div
                                key={i}
                                className="flex flex-col gap-0.5 py-1.5 border-b last:border-0"
                              >
                                <div className="flex items-center gap-1 flex-wrap">
                                  {scoreIcon}
                                  <span className="text-[10px] text-muted-foreground">
                                    {scoreLabel}
                                  </span>
                                  <span className="text-[12px] font-medium">
                                    {item.reconstructed_item}
                                  </span>
                                  {item.segLabel !== null && (
                                    <span className="text-[10px] font-mono bg-muted px-1 rounded">
                                      {item.segLabel}
                                    </span>
                                  )}
                                  {item.comparator_agreement < 1 && (
                                    <span className="text-[10px] text-amber-500 font-medium">
                                      judges split
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-muted-foreground italic">
                                  {item.justification}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ConversationDrilldown({
  conversations,
  realName,
}: {
  conversations: ConversationReconstructionResult[];
  realName: string;
}) {
  // Find all conversations that include this real character (keyed by real_name)
  const convResults = conversations
    .filter((conv) => conv.characters.some((c) => c.real_name === realName))
    .map((conv) => {
      const c = conv.characters.find((c) => c.real_name === realName)!;
      const meanF1 = characterMeanF1([c]);
      return { conv, meanF1, alias: c.alias };
    })
    .sort((a, b) => {
      if (a.meanF1 === null && b.meanF1 === null) return 0;
      if (a.meanF1 === null) return 1;
      if (b.meanF1 === null) return -1;
      return b.meanF1 - a.meanF1;
    });

  if (convResults.length === 0) return null;

  const best = convResults[0];
  const worst = convResults[convResults.length - 1];

  return (
    <div className="mt-3 border-t pt-3 space-y-2">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">
        Per-conversation F1
      </p>
      <div className="space-y-1.5">
        {convResults.map(({ conv, meanF1, alias }, i) => {
          const isBest = i === 0 && convResults.length > 1;
          const isWorst = i === convResults.length - 1 && convResults.length > 1;
          return (
            <div
              key={conv.conversation_file}
              className="flex items-center justify-between text-[12px] rounded px-2 py-1 bg-muted/20"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-muted-foreground truncate max-w-[55%]">
                  {conv.scenario_title}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                  {alias}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {isBest && (
                  <span className="text-[10px] text-green-600 font-medium">best</span>
                )}
                {isWorst && (
                  <span className="text-[10px] text-red-500 font-medium">worst</span>
                )}
                <span className="tabular-nums font-medium">
                  {meanF1 !== null ? fmt(meanF1) : "—"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {best && worst && best !== worst && (
        <p className="text-[11px] text-muted-foreground">
          Best scenario:{" "}
          <span className="text-foreground">{best.conv.scenario_title}</span>
          {" · "}Worst:{" "}
          <span className="text-foreground">{worst.conv.scenario_title}</span>
        </p>
      )}
    </div>
  );
}

interface AggregatedCharacter {
  // NOTE: keyed by real_name — assumes names are unique within the dataset.
  // CharacterResult carries no character id client-side; if a future dataset reuses names
  // this grouping will silently merge distinct characters.
  real_name: string;
  difficulty_tier: string;
  aliases: string[];           // distinct aliases this character used across conversations
  chars: CharacterResult[];    // all CharacterResult instances across conversations
  meanF1: number | null;       // flat mean of all observed field×segment F1s
}

function aggregateCharacters(
  conversations: ConversationReconstructionResult[],
): AggregatedCharacter[] {
  const charMap = new Map<
    string,
    { chars: CharacterResult[]; difficulty_tier: string; aliasSet: Set<string> }
  >();

  for (const conv of conversations) {
    for (const char of conv.characters) {
      if (!charMap.has(char.real_name)) {
        charMap.set(char.real_name, {
          chars: [],
          difficulty_tier: char.difficulty_tier,
          aliasSet: new Set(),
        });
      }
      const entry = charMap.get(char.real_name)!;
      entry.chars.push(char);
      entry.aliasSet.add(char.alias);
    }
  }

  return Array.from(charMap.entries()).map(([real_name, { chars, difficulty_tier, aliasSet }]) => ({
    real_name,
    difficulty_tier,
    aliases: Array.from(aliasSet).sort(),
    chars,
    meanF1: characterMeanF1(chars),
  }));
}

function CharacterCard({
  aggChar,
  conversations,
  expanded,
  onToggle,
}: {
  aggChar: AggregatedCharacter;
  conversations: ConversationReconstructionResult[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border rounded-lg p-4">
      <div
        className="flex items-start justify-between cursor-pointer select-none"
        onClick={onToggle}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-[14px] truncate">{aggChar.real_name}</p>
            {aggChar.aliases.map((a) => (
              <span
                key={a}
                className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0"
              >
                {a}
              </span>
            ))}
          </div>
          <div className="mt-0.5">
            <span className="text-[11px] text-muted-foreground">{aggChar.difficulty_tier}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 ml-4 shrink-0">
          {aggChar.meanF1 !== null && (
            <span
              className="tabular-nums text-[13px] font-medium"
              title="Mean F1 across all observed field×segment instances for this character"
            >
              {fmt(aggChar.meanF1)}
            </span>
          )}
          <span className="text-[12px] text-muted-foreground">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {expanded && (
        <>
          <FieldTable chars={aggChar.chars} />
          <ConversationDrilldown conversations={conversations} realName={aggChar.real_name} />
        </>
      )}
    </div>
  );
}

function MetricsLegend() {
  return (
    <div className="text-[12px] text-muted-foreground border rounded-lg px-4 py-3 space-y-1">
      <p className="text-[11px] uppercase tracking-wide font-medium text-foreground mb-2">
        Metric definitions
      </p>
      <p>
        <span className="font-medium text-foreground">Precision</span> — of traits the
        reconstructor claimed, what % matched ground truth. Penalises hallucination.
      </p>
      <p>
        <span className="font-medium text-foreground">Recall</span> — of ground truth traits, what
        % were identified. Penalises omission.
      </p>
      <p>
        <span className="font-medium text-foreground">F1</span> — harmonic mean of precision and
        recall. Penalises both hallucination and omission.
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ReconstructTab({ dataset, evalName }: { dataset: string; evalName: string }) {
  const [data, setData] = useState<ReconstructPassData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedName, setExpandedName] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(
      `/api/evaluation/${encodeURIComponent(dataset)}/${encodeURIComponent(evalName)}/reconstruct_persona`,
    )
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ReconstructPassData | null>;
      })
      .then((d) => setData(d))
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [dataset, evalName]);

  if (error) return <p className="text-red-500 text-[13px]">{error}</p>;
  if (loading) return <p className="text-muted-foreground text-[13px]">Loading…</p>;
  if (data === null) {
    return (
      <p className="text-red-500 text-[13px]">
        Reconstruction pass not run — this evaluation is incomplete.
      </p>
    );
  }
  if (data.conversations.length === 0) {
    return (
      <p className="text-muted-foreground text-[13px]">No conversations in reconstruction results.</p>
    );
  }

  const { conversations, summary } = data;
  const aggChars = aggregateCharacters(conversations);
  const meanF1 = summary ? overallMeanF1(summary) : null;

  return (
    <div className="space-y-8">
      {/* Header strip */}
      <section>
        <h2 className="text-[14px] font-medium mb-3">Overview</h2>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <Stat
            label="Overall mean F1"
            value={meanF1 !== null ? fmt(meanF1) : "—"}
            tooltip="Harmonic mean of precision and recall across all characters and fields"
          />
          <Stat
            label="Characters evaluated"
            value={String(aggChars.length)}
            tooltip="Unique characters (each alias appearance counts once per real character)"
          />
        </div>
        <MetricsLegend />
      </section>

      {/* Per-character cards */}
      <section>
        <h2 className="text-[14px] font-medium mb-3">Per-character reconstruction quality</h2>
        <div className="space-y-3">
          {aggChars.map((aggChar) => (
            <CharacterCard
              key={aggChar.real_name}
              aggChar={aggChar}
              conversations={conversations}
              expanded={expandedName === aggChar.real_name}
              onToggle={() =>
                setExpandedName(expandedName === aggChar.real_name ? null : aggChar.real_name)
              }
            />
          ))}
        </div>
      </section>
    </div>
  );
}
