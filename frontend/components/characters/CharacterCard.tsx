"use client";
// frontend/components/characters/CharacterCard.tsx
import type { SavedCharacterRecord } from "@open-ormus/shared";

interface Props {
  character: SavedCharacterRecord;
  onView: (c: SavedCharacterRecord) => void;
  onEdit: (c: SavedCharacterRecord) => void;
  onDelete: (c: SavedCharacterRecord) => void;
}

export function CharacterCard({ character, onView, onEdit, onDelete }: Props) {
  const { sheet } = character;

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4 flex flex-col gap-3 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        {sheet.imageUrl ? (
          <img
            src={sheet.imageUrl}
            alt={character.name}
            className="w-12 h-12 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-zinc-200 flex items-center justify-center flex-shrink-0 text-zinc-500 font-semibold text-lg">
            {character.name[0]?.toUpperCase() ?? "?"}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-zinc-900 truncate">{character.name}</h3>
          <p className="text-sm text-zinc-500 mt-1 line-clamp-2">{sheet.shortDescription}</p>
        </div>
      </div>
      <div className="flex gap-2 pt-1 border-t border-zinc-100">
        <button
          type="button"
          onClick={() => onView(character)}
          className="flex-1 text-sm text-zinc-600 hover:text-zinc-900 py-1 rounded hover:bg-zinc-50 transition-colors"
        >
          View
        </button>
        <button
          type="button"
          onClick={() => onEdit(character)}
          className="flex-1 text-sm text-zinc-600 hover:text-zinc-900 py-1 rounded hover:bg-zinc-50 transition-colors"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => onDelete(character)}
          className="flex-1 text-sm text-red-500 hover:text-red-700 py-1 rounded hover:bg-red-50 transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
