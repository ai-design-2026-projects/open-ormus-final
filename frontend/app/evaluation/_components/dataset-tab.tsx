"use client";
import { useEffect, useState } from "react";

interface Character {
  id?: string;
  name: string;
  archetype?: string;
  personalityTraits?: string[];
  backstory?: string;
  speechPatterns?: string[];
  values?: string[];
  fears?: string[];
  goals?: string[];
  notableQuotes?: string[];
  abilities?: string[];
  copingStyle?: string[];
  difficultyTier?: string;
  [key: string]: unknown;
}

interface Scenario {
  title: string;
  stress_axes?: string[];
  context?: string;
  [key: string]: unknown;
}

interface DatasetRef {
  characters: Character[];
  scenarios: Scenario[];
}

export function DatasetTab() {
  const [data, setData] = useState<DatasetRef | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/evaluation/dataset-reference")
      .then((r) => r.json())
      .then((d) => setData(d as DatasetRef))
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <p className="text-red-500 text-[13px]">{error}</p>;
  if (!data) return <p className="text-muted-foreground text-[13px]">Loading…</p>;

  return (
    <div className="space-y-8">
      {/* Character grid */}
      <section>
        <h2 className="text-[14px] font-medium mb-3">Characters</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.characters.map((char) => (
            <CharacterCard key={char.name} character={char} />
          ))}
        </div>
      </section>

      {/* Scenario list */}
      <section>
        <h2 className="text-[14px] font-medium mb-3">Scenarios</h2>
        <div className="space-y-2">
          {data.scenarios.map((s, i) => (
            <ScenarioRow key={i} scenario={s} />
          ))}
        </div>
      </section>
    </div>
  );
}

function CharacterCard({ character }: { character: Character }) {
  const [open, setOpen] = useState(false);

  const traits = (character.personalityTraits ?? []) as string[];
  const quotes = (character.notableQuotes ?? []) as string[];
  const values = (character.values ?? []) as string[];
  const fears = (character.fears ?? []) as string[];
  const goals = (character.goals ?? []) as string[];
  const speechPatterns = (character.speechPatterns ?? []) as string[];
  const abilities = (character.abilities ?? []) as string[];
  const backstory = typeof character.backstory === "string" ? character.backstory : null;

  return (
    <div className="border rounded-lg p-3 text-[13px] flex flex-col gap-2">
      {/* Header: name + archetype badge */}
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">{character.name}</p>
        {character.archetype && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
            {character.archetype}
          </span>
        )}
      </div>

      {/* Trait chips */}
      {traits.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {traits.map((t) => (
            <span key={t} className="text-[11px] px-1.5 py-0.5 rounded-full border bg-background">
              {t}
            </span>
          ))}
        </div>
      )}

      {/* First notable quote */}
      {quotes[0] && (
        <blockquote className="border-l-2 border-muted pl-2 text-[11px] italic text-muted-foreground">
          &ldquo;{quotes[0]}&rdquo;
        </blockquote>
      )}

      {/* Toggle */}
      {(backstory || values.length > 0 || speechPatterns.length > 0 || quotes.length > 1) && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-[11px] text-muted-foreground hover:text-foreground text-left"
        >
          {open ? "▲ less" : "▼ more"}
        </button>
      )}

      {/* Expanded content */}
      {open && (
        <div className="space-y-3 border-t pt-2">
          {/* Backstory */}
          {backstory && (
            <div>
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Backstory</p>
              <p className="text-[12px] leading-relaxed">{backstory}</p>
            </div>
          )}

          {/* Values / Fears / Goals grid */}
          {(values.length > 0 || fears.length > 0 || goals.length > 0) && (
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Values", items: values },
                { label: "Fears", items: fears },
                { label: "Goals", items: goals },
              ].map(({ label, items }) => (
                <div key={label}>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
                  <ul className="space-y-0.5">
                    {items.map((item, i) => (
                      <li key={i} className="text-[11px] flex gap-1">
                        <span className="text-muted-foreground shrink-0">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {/* Speech patterns */}
          {speechPatterns.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Speech patterns</p>
              <ul className="space-y-0.5">
                {speechPatterns.map((p, i) => (
                  <li key={i} className="text-[11px] flex gap-1">
                    <span className="text-muted-foreground shrink-0">•</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Abilities */}
          {abilities.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Abilities</p>
              <ul className="space-y-0.5">
                {abilities.map((a, i) => (
                  <li key={i} className="text-[11px] flex gap-1">
                    <span className="text-muted-foreground shrink-0">•</span>
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Remaining quotes */}
          {quotes.slice(1).map((q, i) => (
            <blockquote key={i} className="border-l-2 border-muted pl-2 text-[11px] italic text-muted-foreground">
              &ldquo;{q}&rdquo;
            </blockquote>
          ))}
        </div>
      )}
    </div>
  );
}

function ScenarioRow({ scenario }: { scenario: Scenario }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border rounded-lg text-[13px]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/30 transition-colors text-left"
      >
        <span className="font-medium">{scenario.title}</span>
        <span className="text-[11px] text-muted-foreground">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-1 border-t">
          {scenario.stress_axes && scenario.stress_axes.length > 0 && (
            <p className="text-muted-foreground text-[11px] pt-2">
              Stress axes: {scenario.stress_axes.join(" · ")}
            </p>
          )}
          {scenario.context && <p className="text-[12px] mt-1">{scenario.context}</p>}
        </div>
      )}
    </div>
  );
}
