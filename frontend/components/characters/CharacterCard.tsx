"use client";
// frontend/components/characters/CharacterCard.tsx
import type { SavedCharacterRecord } from "@open-ormus/shared";

interface Props {
  character: SavedCharacterRecord;
  onView: (c: SavedCharacterRecord) => void;
  onEdit: (c: SavedCharacterRecord) => void;
  onDelete: (c: SavedCharacterRecord) => void;
}

const CONFIDENCE_LABEL: Record<number, string> = {
  0: "Unknown",
  1: "Low",
  2: "Medium",
  3: "High",
};

const CONFIDENCE_COLOR: Record<number, string> = {
  0: "bg-zinc-100 text-zinc-500",
  1: "bg-yellow-100 text-yellow-700",
  2: "bg-blue-100 text-blue-700",
  3: "bg-green-100 text-green-700",
};

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
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-zinc-900 truncate">{character.name}</h3>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${CONFIDENCE_COLOR[sheet.confidence]}`}
            >
              {CONFIDENCE_LABEL[sheet.confidence]}
            </span>
          </div>
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
