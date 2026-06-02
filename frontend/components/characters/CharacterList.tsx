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
    <div className="bg-surface-sunk border border-hair rounded-[var(--r-lg)] p-4 animate-pulse">
      <div className="flex gap-3">
        <div className="w-14 h-14 rounded-[var(--r-md)] bg-surface-2 flex-shrink-0" />
        <div className="flex-1 space-y-2 mt-1">
          <div className="h-4 bg-surface-2 rounded w-1/2" />
          <div className="h-3 bg-surface-2 rounded w-full" />
          <div className="h-3 bg-surface-2 rounded w-2/3" />
        </div>
      </div>
    </div>
  );
}

export function CharacterList({ characters, loading, onView, onEdit, onDelete }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} />)}
      </div>
    );
  }

  if (characters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 bg-surface-1 border border-dashed border-hair-strong rounded-[var(--r-lg)] text-ink-mute">
        <p className="t-body-l font-medium">No characters yet</p>
        <p className="t-body-s mt-1 text-ink-faint">Create your first character to get started</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {characters.map((c, i) => (
        <div key={c.id} className={i === 0 ? "col-span-2 row-span-2 h-full" : ""}>
          <CharacterCard
            character={c}
            onView={onView}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </div>
      ))}
    </div>
  );
}
