"use client";

import { useState } from "react";
import { Check, Loader2, X, AlertTriangle } from "lucide-react";
import type { CharacterSearchResult, ShowResult } from "@open-ormus/shared";
import { Segmented } from "@/components/ui/segmented";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type ImportTab = "collection" | "character";

type FetchStatus = {
  name: string;
  status: "loading" | "success" | "error";
  result?: CharacterSearchResult;
  errorMsg?: string;
};

interface ImportStepProps {
  onImported: (results: CharacterSearchResult[]) => void;
}

const TAB_OPTIONS = [
  { value: "collection", label: "By Collection" },
  { value: "character", label: "By Character" },
] as const;

export function ImportStep({ onImported }: ImportStepProps) {
  const [tab, setTab] = useState<ImportTab>("collection");

  // ── By Collection state ────────────────────────────────────────────────────
  const [collectionQuery, setCollectionQuery] = useState("");
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [showResults, setShowResults] = useState<ShowResult[]>([]);
  const [selectedShow, setSelectedShow] = useState<ShowResult | null>(null);
  const [checkedChars, setCheckedChars] = useState<Set<string>>(new Set());
  const [fetchStatuses, setFetchStatuses] = useState<FetchStatus[]>([]);
  const [fetchingChars, setFetchingChars] = useState(false);

  // ── By Character state ─────────────────────────────────────────────────────
  const [charQuery, setCharQuery] = useState("");
  const [charLoading, setCharLoading] = useState(false);
  const [charError, setCharError] = useState<string | null>(null);

  // ── Collection handlers ────────────────────────────────────────────────────
  const searchCollection = async () => {
    if (!collectionQuery.trim()) return;
    setCollectionLoading(true);
    setCollectionError(null);
    setShowResults([]);
    setSelectedShow(null);
    setCheckedChars(new Set());
    setFetchStatuses([]);
    try {
      const res = await fetch("/api/exa/show-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: collectionQuery }),
      });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const data = (await res.json()) as { results?: ShowResult[]; error?: string };
      if (!res.ok || data.error !== undefined || !data.results) {
        setCollectionError("Search failed, try again");
      } else if (data.results.length === 0) {
        setCollectionError("No collections found");
      } else {
        setShowResults(data.results);
      }
    } catch {
      setCollectionError("Search failed, try again");
    } finally {
      setCollectionLoading(false);
    }
  };

  const selectShow = (show: ShowResult) => {
    setSelectedShow(show);
    setCheckedChars(new Set());
    setFetchStatuses([]);
  };

  const toggleChar = (name: string) => {
    setCheckedChars((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const importSelected = async () => {
    if (!selectedShow || checkedChars.size === 0) return;
    const names = Array.from(checkedChars);
    setFetchStatuses(names.map((name) => ({ name, status: "loading" as const })));
    setFetchingChars(true);

    const settled = await Promise.allSettled(
      names.map(async (name) => {
        const query = `${name}, ${selectedShow.title}`;
        const res = await fetch("/api/exa/character-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        });
        if (res.status === 401) throw new Error("unauthorized");
        const data = (await res.json()) as CharacterSearchResult | { error: string };
        if ("error" in data) throw new Error(data.error);
        return { name, data: data as CharacterSearchResult };
      })
    );

    let redirected = false;
    const updated: FetchStatus[] = names.map((name, i) => {
      const r = settled[i];
      if (r === undefined) return { name, status: "error" as const, errorMsg: "Unknown error" };
      if (r.status === "fulfilled") {
        return { name, status: "success" as const, result: r.value.data };
      }
      const msg = r.reason instanceof Error ? r.reason.message : "unknown";
      if (msg === "unauthorized") redirected = true;
      return {
        name,
        status: "error" as const,
        errorMsg: msg === "character_not_found" ? "Character not found" : "Failed to fetch",
      };
    });

    if (redirected) {
      window.location.href = "/login";
      return;
    }

    setFetchStatuses(updated);
    setFetchingChars(false);
  };

  const successResults = fetchStatuses
    .filter((s): s is FetchStatus & { status: "success"; result: CharacterSearchResult } =>
      s.status === "success" && s.result !== undefined
    )
    .map((s) => s.result);

  // ── Character handler ──────────────────────────────────────────────────────
  const searchCharacter = async () => {
    if (!charQuery.trim()) return;
    setCharLoading(true);
    setCharError(null);
    try {
      const res = await fetch("/api/exa/character-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: charQuery }),
      });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const data = (await res.json()) as CharacterSearchResult | { error: string };
      if (!res.ok || "error" in data) {
        setCharError(
          ("error" in data && data.error === "character_not_found")
            ? "Character not found"
            : "Search failed, try again"
        );
      } else {
        onImported([data]);
      }
    } catch {
      setCharError("Search failed, try again");
    } finally {
      setCharLoading(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Tab switcher */}
      <Segmented
        value={tab}
        onValueChange={(v) => setTab(v as ImportTab)}
        options={TAB_OPTIONS}
      />

      {/* ── By Collection ── */}
      {tab === "collection" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              type="text"
              value={collectionQuery}
              onChange={(e) => setCollectionQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void searchCollection();
                }
              }}
              placeholder="e.g. Money Heist, Breaking Bad…"
              className="flex-1"
            />
            <Button
              type="button"
              onClick={() => void searchCollection()}
              disabled={collectionLoading || !collectionQuery.trim()}
            >
              {collectionLoading ? (
                <><Loader2 className="size-4 animate-spin" /> Searching…</>
              ) : (
                "Search"
              )}
            </Button>
          </div>

          {collectionError && (
            <p className="t-body-s text-signal-flag flex items-center gap-1.5">
              <AlertTriangle className="size-3.5" /> {collectionError}
            </p>
          )}

          {/* Show results (before selection) */}
          {showResults.length > 0 && !selectedShow && (
            <div className="space-y-2">
              {showResults.map((show) => (
                <button
                  key={show.title}
                  type="button"
                  onClick={() => selectShow(show)}
                  className="w-full text-left p-3 rounded-[var(--r-lg)] border border-hair bg-surface-1 hover:border-hair-strong hover:bg-surface-2 transition-colors shadow-[var(--shadow-inset),var(--shadow-1)]"
                >
                  <div className="flex items-center gap-2">
                    <span className="t-body-s font-medium text-ink">{show.title}</span>
                    {show.year !== null && (
                      <span className="t-meta text-ink-faint">{show.year}</span>
                    )}
                    {show.genre !== null && (
                      <span className="t-meta text-ink-faint">· {show.genre}</span>
                    )}
                  </div>
                  <p className="t-meta text-ink-mute mt-0.5 line-clamp-2">
                    {show.description}
                  </p>
                </button>
              ))}
            </div>
          )}

          {/* Selected show — character checklist or fetch statuses */}
          {selectedShow && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="t-body-s font-medium text-ink">
                  {selectedShow.title}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedShow(null);
                    setFetchStatuses([]);
                    setCheckedChars(new Set());
                  }}
                >
                  Change
                </Button>
              </div>

              {fetchStatuses.length === 0 ? (
                <>
                  <div className="space-y-1.5">
                    {selectedShow.characters.map((name) => (
                      <label
                        key={name}
                        className="flex items-center gap-2 t-body-s text-ink cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checkedChars.has(name)}
                          onChange={() => toggleChar(name)}
                          className="rounded border-hair"
                        />
                        {name}
                      </label>
                    ))}
                  </div>
                  <Button
                    type="button"
                    onClick={() => void importSelected()}
                    disabled={checkedChars.size === 0}
                  >
                    Import Selected ({checkedChars.size})
                  </Button>
                </>
              ) : (
                <div className="space-y-2">
                  {/* Per-character status */}
                  {fetchStatuses.map((s) => (
                    <div
                      key={s.name}
                      className={`flex items-center gap-2 t-body-s p-2.5 rounded-[var(--r-lg)] border ${
                        s.status === "error"
                          ? "bg-surface-1 border-hair text-signal-flag"
                          : s.status === "success"
                          ? "bg-surface-1 border-hair text-signal-ok"
                          : "bg-surface-sunk border-hair text-ink-mute"
                      }`}
                    >
                      <span className="shrink-0">
                        {s.status === "loading" ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : s.status === "success" ? (
                          <Check className="size-3.5" />
                        ) : (
                          <X className="size-3.5" />
                        )}
                      </span>
                      <span className="flex-1">{s.name}</span>
                      {s.status === "error" && (
                        <span className="t-meta">{s.errorMsg}</span>
                      )}
                    </div>
                  ))}

                  {/* Continue / all-failed controls */}
                  {!fetchingChars && (
                    <div className="flex items-center gap-3 pt-1">
                      {successResults.length > 0 ? (
                        <Button
                          type="button"
                          onClick={() => onImported(successResults)}
                        >
                          Continue with {successResults.length} of{" "}
                          {fetchStatuses.length} character
                          {fetchStatuses.length !== 1 ? "s" : ""}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void importSelected()}
                        >
                          Retry all
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── By Character ── */}
      {tab === "character" && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              type="text"
              value={charQuery}
              onChange={(e) => setCharQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void searchCharacter();
                }
              }}
              placeholder="e.g. Walter White, Breaking Bad"
              className="flex-1"
            />
            <Button
              type="button"
              onClick={() => void searchCharacter()}
              disabled={charLoading || !charQuery.trim()}
            >
              {charLoading ? (
                <><Loader2 className="size-4 animate-spin" /> Searching…</>
              ) : (
                "Search"
              )}
            </Button>
          </div>
          {charError && (
            <p className="t-body-s text-signal-flag flex items-center gap-1.5">
              <AlertTriangle className="size-3.5" /> {charError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
