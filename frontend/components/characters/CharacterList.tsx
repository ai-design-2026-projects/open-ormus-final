"use client";
// frontend/components/characters/CharacterList.tsx
import type { SavedCharacterRecord } from "@open-ormus/shared";
import { CharacterCard } from "./CharacterCard";

interface Props {
  characters: SavedCharacterRecord[];
  loading: boolean;
  onView: (c: SavedCharacterRecord) => void;
  onEdit: (c: SavedCharacterRecord) => void;
  onDelete: (c: SavedCharacterRecord) => void;
}

function Skeleton() {
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4 animate-pulse">
      <div className="flex gap-3">
        <div className="w-12 h-12 rounded-full bg-zinc-200 flex-shrink-0" />
        <div className="flex-1 space-y-2 mt-1">
          <div className="h-4 bg-zinc-200 rounded w-1/2" />
          <div className="h-3 bg-zinc-200 rounded w-full" />
          <div className="h-3 bg-zinc-200 rounded w-2/3" />
        </div>
      </div>
    </div>
  );
}

export function CharacterList({ characters, loading, onView, onEdit, onDelete }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} />)}
      </div>
    );
  }

  if (characters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
        <p className="text-lg font-medium">No characters yet</p>
        <p className="text-sm mt-1">Create your first character to get started</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {characters.map((c) => (
        <CharacterCard
          key={c.id}
          character={c}
          onView={onView}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
