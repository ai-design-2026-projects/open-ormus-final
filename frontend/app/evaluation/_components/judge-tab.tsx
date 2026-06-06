"use client";
import React, { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from "recharts";

// ----- Data types (mirrors evaluation/judge/types.ts) -----

interface JudgeAssignmentResult {
  alias: string;
  real_name_guessed: string;
  real_name_actual: string;
  correct: boolean;
  reasons: string[];
}

interface JudgeResult {
  label: string;
  model: string;
  assignments: JudgeAssignmentResult[];
  all_correct: boolean;
}

interface GuessingScenarioResult {
  scenario_id: string;
  scenario_title: string;
  judges: JudgeResult[];
}

// ----- Derived stats -----

interface PerJudgeStats {
  key: string; // e.g. "judge_1 · mistral-nemo"
  model: string;
  label: string;
  correct: number;
  total: number;
  accuracy: number;
}

interface CharacterConfusion {
  real_name: string;
  correct: number;
  wrong: number;
  mostCommonWrong: string | null;
  wrongInstances: WrongInstance[];
}

interface WrongInstance {
  scenario_title: string;
  judge_label: string;
  alias: string;
  guessed: string;
  reasons: string[];
}

function deriveStats(scenarios: GuessingScenarioResult[]) {
  // Per-judge stats: aggregate across all scenarios
  const judgeMap = new Map<string, { model: string; label: string; correct: number; total: number }>();

  // Character confusion: keyed by real_name_actual
  const charMap = new Map<
    string,
    { correct: number; wrong: number; wrongCounts: Map<string, number>; wrongInstances: WrongInstance[] }
  >();

  let totalAssignments = 0;

  for (const scenario of scenarios) {
    for (const judge of scenario.judges) {
      const key = `${judge.label}`;
      if (!judgeMap.has(key)) {
        judgeMap.set(key, { model: judge.model, label: judge.label, correct: 0, total: 0 });
      }
      const entry = judgeMap.get(key)!;

      for (const a of judge.assignments) {
        entry.total++;
        totalAssignments++;

        if (a.correct) {
          entry.correct++;
        }

        // Character confusion tracking
        if (!charMap.has(a.real_name_actual)) {
          charMap.set(a.real_name_actual, {
            correct: 0,
            wrong: 0,
            wrongCounts: new Map(),
            wrongInstances: [],
          });
        }
        const charEntry = charMap.get(a.real_name_actual)!;
        if (a.correct) {
          charEntry.correct++;
        } else {
          charEntry.wrong++;
          const prev = charEntry.wrongCounts.get(a.real_name_guessed) ?? 0;
          charEntry.wrongCounts.set(a.real_name_guessed, prev + 1);
          charEntry.wrongInstances.push({
            scenario_title: scenario.scenario_title,
            judge_label: judge.label,
            alias: a.alias,
            guessed: a.real_name_guessed,
            reasons: a.reasons,
          });
        }
      }
    }
  }

  const perJudge: PerJudgeStats[] = Array.from(judgeMap.entries()).map(([key, v]) => ({
    key,
    model: v.model,
    label: v.label,
    correct: v.correct,
    total: v.total,
    accuracy: v.total > 0 ? v.correct / v.total : 0,
  }));

  const overallAccuracy =
    perJudge.length > 0
      ? perJudge.reduce((sum, j) => sum + j.accuracy, 0) / perJudge.length
      : 0;

  // Weighted random baseline:
  // A random guesser picks 1 correct character per conversation regardless of cast size.
  // Expected accuracy = total_conversations / total_character_identifications_across_all_judges
  const totalConversations = scenarios.length * (scenarios[0]?.judges.length ?? 1);
  const weightedBaseline = totalAssignments > 0 ? totalConversations / totalAssignments : 0;

  const confusion: CharacterConfusion[] = Array.from(charMap.entries())
    .map(([real_name, v]) => {
      let mostCommonWrong: string | null = null;
      let maxCount = 0;
      for (const [name, count] of v.wrongCounts.entries()) {
        if (count > maxCount) {
          maxCount = count;
          mostCommonWrong = name;
        }
      }
      return {
        real_name,
        correct: v.correct,
        wrong: v.wrong,
        mostCommonWrong,
        wrongInstances: v.wrongInstances,
      };
    })
    .sort((a, b) => b.wrong - a.wrong);

  return { perJudge, overallAccuracy, weightedBaseline, confusion };
}

// ----- Sub-components -----

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-lg px-4 py-3 text-center">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      <p className="text-[20px] font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

interface BarChartEntry {
  label: string;
  model: string;
  accuracy: number;
  accuracyPct: number;
}

function JudgeAccuracyChart({
  perJudge,
  baseline,
}: {
  perJudge: PerJudgeStats[];
  baseline: number;
}) {
  const chartData: BarChartEntry[] = perJudge.map((j) => ({
    label: j.label,
    model: j.model,
    accuracy: j.accuracy,
    accuracyPct: parseFloat((j.accuracy * 100).toFixed(1)),
  }));

  const baselinePct = parseFloat((baseline * 100).toFixed(1));

  return (
    <section>
      <h2 className="text-[14px] font-medium mb-3">Per-judge accuracy</h2>
      <div style={{ width: "100%", height: Math.max(80, chartData.length * 48 + 40) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={chartData}
            margin={{ top: 4, right: 48, bottom: 4, left: 80 }}
          >
            <XAxis
              type="number"
              domain={[0, 100]}
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fontSize: 11 }}
            />
            <YAxis
              type="category"
              dataKey="label"
              tick={{ fontSize: 11 }}
              width={72}
            />
            <Tooltip
              formatter={(value, _name, props) => [
                `${value as number}% (${(props.payload as BarChartEntry | undefined)?.model ?? ""})`,
                "Accuracy",
              ]}
            />
            <ReferenceLine
              x={baselinePct}
              stroke="#ef4444"
              strokeDasharray="4 2"
              label={{ value: "baseline", position: "insideTopRight", fontSize: 10, fill: "#ef4444" }}
            />
            <Bar dataKey="accuracyPct" radius={[0, 3, 3, 0]}>
              {chartData.map((entry, index) => (
                <Cell
                  key={index}
                  fill={entry.accuracyPct >= baselinePct ? "#22c55e" : "#f97316"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function CharacterConfusionTable({
  confusion,
  expandedChar,
  setExpandedChar,
}: {
  confusion: CharacterConfusion[];
  expandedChar: string | null;
  setExpandedChar: (name: string | null) => void;
}) {
  if (confusion.length === 0) return null;

  return (
    <section>
      <h2 className="text-[14px] font-medium mb-3">Character confusion</h2>
      <div className="border rounded-lg overflow-hidden text-[13px]">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30 text-[11px] text-muted-foreground uppercase tracking-wide">
              <th className="text-left px-3 py-2 font-medium">Character</th>
              <th className="text-right px-3 py-2 font-medium">Correct</th>
              <th className="text-right px-3 py-2 font-medium">Wrong</th>
              <th className="text-left px-3 py-2 font-medium">Most confused with</th>
            </tr>
          </thead>
          <tbody>
            {confusion.map((row) => {
              const isExpanded = expandedChar === row.real_name;
              const hasWrong = row.wrong > 0;
              return (
                <React.Fragment key={row.real_name}>
                  <tr
                    className={`border-b last:border-0 ${hasWrong ? "cursor-pointer hover:bg-muted/20" : ""}`}
                    onClick={() => {
                      if (!hasWrong) return;
                      setExpandedChar(isExpanded ? null : row.real_name);
                    }}
                  >
                    <td className="px-3 py-2 font-medium flex items-center gap-1">
                      {hasWrong && (
                        <span className="text-[10px] text-muted-foreground">{isExpanded ? "▲" : "▼"}</span>
                      )}
                      {row.real_name}
                    </td>
                    <td className="px-3 py-2 text-right text-green-600 dark:text-green-400">
                      {row.correct}
                    </td>
                    <td className="px-3 py-2 text-right text-orange-500">
                      {row.wrong}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.mostCommonWrong ?? "—"}
                    </td>
                  </tr>
                  {isExpanded && row.wrongInstances.length > 0 && (
                    <tr className="border-b last:border-0 bg-muted/10">
                      <td colSpan={4} className="px-4 py-3">
                        <div className="space-y-2">
                          {row.wrongInstances.map((inst, i) => (
                            <div key={i} className="border rounded p-2 text-[12px] space-y-0.5">
                              <p className="font-medium">{inst.scenario_title}</p>
                              <p className="text-muted-foreground">
                                {inst.judge_label} · alias <span className="font-mono">{inst.alias}</span> · guessed{" "}
                                <span className="text-orange-500">{inst.guessed}</span>
                              </p>
                              {inst.reasons.length > 0 && (
                                <p className="text-[11px] text-muted-foreground italic">
                                  &ldquo;{inst.reasons[0]}&rdquo;
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ----- Main component -----

export function JudgeTab({ dataset, evalName }: { dataset: string; evalName: string }) {
  const [scenarios, setScenarios] = useState<GuessingScenarioResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedChar, setExpandedChar] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(
      `/api/evaluation/${encodeURIComponent(dataset)}/${encodeURIComponent(evalName)}/judge_guessing`,
    )
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (d === null) {
          setScenarios(null);
        } else if (Array.isArray(d)) {
          setScenarios(d as GuessingScenarioResult[]);
        } else {
          setScenarios(null);
        }
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [dataset, evalName]);

  if (error) return <p className="text-red-500 text-[13px]">{error}</p>;
  if (loading) return <p className="text-muted-foreground text-[13px]">Loading…</p>;
  if (scenarios === null) {
    return (
      <p className="text-muted-foreground text-[13px]">
        No judge results found for this evaluation.
      </p>
    );
  }
  if (scenarios.length === 0) {
    return <p className="text-muted-foreground text-[13px]">No scenarios in judge results.</p>;
  }

  const { perJudge, overallAccuracy, weightedBaseline, confusion } = deriveStats(scenarios);
  const delta = overallAccuracy - weightedBaseline;

  return (
    <div className="space-y-8">
      {/* Header strip */}
      <section>
        <h2 className="text-[14px] font-medium mb-3">Overview</h2>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Overall accuracy" value={pct(overallAccuracy)} />
          <Stat label="Random baseline" value={pct(weightedBaseline)} />
          <Stat
            label="Above baseline"
            value={(delta >= 0 ? "+" : "") + pct(delta)}
          />
        </div>
      </section>

      {/* Per-judge accuracy bars */}
      {perJudge.length > 0 && (
        <JudgeAccuracyChart perJudge={perJudge} baseline={weightedBaseline} />
      )}

      {/* Character confusion table */}
      <CharacterConfusionTable
        confusion={confusion}
        expandedChar={expandedChar}
        setExpandedChar={setExpandedChar}
      />
    </div>
  );
}
