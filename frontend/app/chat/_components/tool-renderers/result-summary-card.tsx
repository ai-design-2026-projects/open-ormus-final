"use client";

import { useState } from "react";
import { z } from "zod";
import {
  SavedCharacterRecordSchema,
  CharacterSearchResultSchema,
  ShowSearchResultSchema,
} from "@open-ormus/shared";
import { CharacterCard } from "./character-card";
import { ShowCard } from "./show-card";
import type { ToolRendererProps } from "../tool-call-block";

function Shimmer({ className }: { className?: string }) {
  return (
    <div className={`bg-surface-sunk animate-pulse rounded-[var(--r-md)] ${className ?? ""}`} />
  );
}

const PAGE_SIZE = 4;

export function ResultSummaryCard({ input, result, isLoading }: ToolRendererProps) {
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const query =
    typeof input === "object" &&
    input !== null &&
    "query" in input &&
    typeof (input as { query: unknown }).query === "string"
      ? (input as { query: string }).query
      : null;

  if (isLoading) {
    return (
      <div className="bg-surface-1 border border-hair rounded-[var(--r-lg)] shadow-[var(--shadow-inset),var(--shadow-1)] px-[18px] py-[14px] space-y-2">
        <div className="flex items-center justify-between">
          <Shimmer className="h-3 w-24" />
          {query && <Shimmer className="h-3 w-32" />}
        </div>
        <Shimmer className="h-9 w-full" />
        <Shimmer className="h-9 w-full" />
      </div>
    );
  }

  // Try parse order per spec
  const savedList = z.array(SavedCharacterRecordSchema).safeParse(result);
  const savedListNoPictures = z
    .array(SavedCharacterRecordSchema.omit({ pictures: true }))
    .safeParse(result);
  const singleCharacter = CharacterSearchResultSchema.safeParse(result);
  const showResult = ShowSearchResultSchema.safeParse(result);

  // Single CharacterSearchResult (character_research) — render directly without wrapper
  if (
    !savedList.success &&
    !savedListNoPictures.success &&
    singleCharacter.success &&
    !showResult.success
  ) {
    return (
      <CharacterCard input={null} result={singleCharacter.data} isLoading={false} />
    );
  }

  const count = savedList.success
    ? savedList.data.length
    : savedListNoPictures.success
      ? savedListNoPictures.data.length
      : showResult.success
        ? showResult.data.results.length
        : null;

  if (count === null) {
    return (
      <div className="bg-surface-1 border border-hair rounded-[var(--r-lg)] shadow-[var(--shadow-inset),var(--shadow-1)] p-4">
        <pre className="t-mono text-ink-mute overflow-x-auto text-[11px]">
          {JSON.stringify(result, null, 2)}
        </pre>
      </div>
    );
  }

  const label = showResult.success
    ? `${count} show${count !== 1 ? "s" : ""}`
    : `${count} character${count !== 1 ? "s" : ""}`;

  return (
    <div className="bg-surface-1 border border-hair rounded-[var(--r-lg)] shadow-[var(--shadow-inset),var(--shadow-1)] overflow-hidden">
      {/* Collapsed header row */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center justify-between w-full px-[18px] py-[14px] hover:bg-surface-2 transition-colors duration-[120ms] text-left"
      >
        <span className="t-body-s font-medium text-ink">
          {label}
          {query ? ` for "${query}"` : ""}
        </span>
        <span className="t-meta text-ink-mute">{expanded ? "▲" : "▼"}</span>
      </button>

      {/* Expanded: item list */}
      {expanded && (
        <div className="border-t border-hair px-3 pb-3 pt-2 space-y-2">
          {savedList.success &&
            (showAll ? savedList.data : savedList.data.slice(0, PAGE_SIZE)).map((char) => (
              <CharacterCard
                key={char.id}
                input={null}
                result={char}
                isLoading={false}
              />
            ))}
          {!savedList.success &&
            savedListNoPictures.success &&
            (showAll
              ? savedListNoPictures.data
              : savedListNoPictures.data.slice(0, PAGE_SIZE)
            ).map((char) => (
              <CharacterCard
                key={char.id}
                input={null}
                result={char.sheet}
                isLoading={false}
              />
            ))}
          {showResult.success &&
            (showAll ? showResult.data.results : showResult.data.results.slice(0, PAGE_SIZE)).map(
              (show, i) => <ShowCard key={i} show={show} />
            )}

          {/* Show more / show less */}
          {count !== null && count > PAGE_SIZE && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="w-full mt-1 py-2 t-meta text-ink-mute hover:text-ink border border-dashed border-hair hover:border-ink-faint rounded-[var(--r-md)] transition-colors duration-[120ms]"
            >
              {showAll ? "Show less ▲" : `Show ${count - PAGE_SIZE} more ▼`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
