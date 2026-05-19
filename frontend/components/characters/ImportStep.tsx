"use client";

import { useState } from "react";
import type { CharacterSearchResult, ShowResult } from "@open-ormus/shared";

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
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-zinc-200">
        {(["collection", "character"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-zinc-900 text-zinc-900"
                : "border-transparent text-zinc-400 hover:text-zinc-600"
            }`}
          >
            {t === "collection" ? "By Collection" : "By Character"}
          </button>
        ))}
      </div>

      {/* ── By Collection ── */}
      {tab === "collection" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input
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
              className="flex-1 px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
            />
            <button
              type="button"
              onClick={() => void searchCollection()}
              disabled={collectionLoading || !collectionQuery.trim()}
              className="px-4 py-2 text-sm bg-zinc-900 text-white rounded-lg hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {collectionLoading ? "Searching…" : "Search"}
            </button>
          </div>

          {collectionError && (
            <p className="text-sm text-red-600">{collectionError}</p>
          )}

          {/* Show results (before selection) */}
          {showResults.length > 0 && !selectedShow && (
            <div className="space-y-2">
              {showResults.map((show) => (
                <button
                  key={show.title}
                  type="button"
                  onClick={() => selectShow(show)}
                  className="w-full text-left p-3 rounded-lg border border-zinc-200 hover:border-zinc-400 hover:bg-zinc-50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-zinc-900">{show.title}</span>
                    {show.year !== null && (
                      <span className="text-xs text-zinc-400">{show.year}</span>
                    )}
                    {show.genre !== null && (
                      <span className="text-xs text-zinc-400">· {show.genre}</span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">
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
                <span className="text-sm font-medium text-zinc-900">
                  {selectedShow.title}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedShow(null);
                    setFetchStatuses([]);
                    setCheckedChars(new Set());
                  }}
                  className="text-xs text-zinc-400 hover:text-zinc-600 underline"
                >
                  Change
                </button>
              </div>

              {fetchStatuses.length === 0 ? (
                <>
                  <div className="space-y-1.5">
                    {selectedShow.characters.map((name) => (
                      <label
                        key={name}
                        className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checkedChars.has(name)}
                          onChange={() => toggleChar(name)}
                          className="rounded border-zinc-300"
                        />
                        {name}
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => void importSelected()}
                    disabled={checkedChars.size === 0}
                    className="px-4 py-2 text-sm bg-zinc-900 text-white rounded-lg hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Import Selected ({checkedChars.size})
                  </button>
                </>
              ) : (
                <div className="space-y-2">
                  {/* Per-character status */}
                  {fetchStatuses.map((s) => (
                    <div
                      key={s.name}
                      className={`flex items-center gap-2 text-sm p-2 rounded-lg ${
                        s.status === "error"
                          ? "bg-red-50 text-red-700"
                          : s.status === "success"
                          ? "bg-green-50 text-green-700"
                          : "bg-zinc-50 text-zinc-500"
                      }`}
                    >
                      <span>
                        {s.status === "loading"
                          ? "⟳"
                          : s.status === "success"
                          ? "✓"
                          : "✗"}
                      </span>
                      <span className="flex-1">{s.name}</span>
                      {s.status === "error" && (
                        <span className="text-xs">{s.errorMsg}</span>
                      )}
                    </div>
                  ))}

                  {/* Continue / all-failed controls */}
                  {!fetchingChars && (
                    <div className="flex items-center gap-3 pt-1">
                      {successResults.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => onImported(successResults)}
                          className="px-4 py-2 text-sm bg-zinc-900 text-white rounded-lg hover:bg-zinc-700 transition-colors"
                        >
                          Continue with {successResults.length} of{" "}
                          {fetchStatuses.length} character
                          {fetchStatuses.length !== 1 ? "s" : ""}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void importSelected()}
                          className="px-4 py-2 text-sm border border-zinc-300 text-zinc-700 rounded-lg hover:bg-zinc-50 transition-colors"
                        >
                          Retry all
                        </button>
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
            <input
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
              className="flex-1 px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
            />
            <button
              type="button"
              onClick={() => void searchCharacter()}
              disabled={charLoading || !charQuery.trim()}
              className="px-4 py-2 text-sm bg-zinc-900 text-white rounded-lg hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {charLoading ? "Searching…" : "Search"}
            </button>
          </div>
          {charError && <p className="text-sm text-red-600">{charError}</p>}
        </div>
      )}
    </div>
  );
}
