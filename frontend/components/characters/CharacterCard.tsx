"use client";
import type { SavedCharacterRecord } from "@open-ormus/shared";
import { Eye, Pencil, Trash2 } from "lucide-react";
import { Monogram } from "@/components/ui/monogram";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Tag } from "@/components/ui/tag";

interface Props {
  character: SavedCharacterRecord;
  onView: (c: SavedCharacterRecord) => void;
  onEdit: (c: SavedCharacterRecord) => void;
  onDelete: (c: SavedCharacterRecord) => void;
}

export function CharacterCard({ character, onView, onEdit, onDelete }: Props) {
  const pictureUrl = character.pictures.find((p) => p.size === 512)?.url;
  const { sheet } = character;
  const shortDesc = sheet.shortDescription;
  const traits: string[] = sheet.personality.personalityTraits.slice(0, 4);

  return (
    <article className="bg-surface-1 border border-hair rounded-[var(--r-lg)] p-[22px] flex flex-col gap-3.5 relative transition-[box-shadow,border-color] duration-[220ms] hover:shadow-[var(--shadow-inset),var(--shadow-2)] hover:border-hair-strong shadow-[var(--shadow-inset),var(--shadow-1)] h-full">
      {/* Top: Avatar */}
      <div className="flex items-start justify-between">
        {pictureUrl ? (
          <img
            src={pictureUrl}
            alt={character.name}
            className="size-14 rounded-[var(--r-md)] object-cover shrink-0"
          />
        ) : (
          <Monogram name={character.name} size={56} />
        )}
      </div>

      {/* Name + short description */}
      <div className="flex flex-col gap-0.5">
        <h3 className="t-h6 m-0 tracking-[-0.015em]">{character.name}</h3>
        <div className="t-body-s text-ink-mute line-clamp-2">{shortDesc}</div>
      </div>

      {/* Trait tags */}
      {traits.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {traits.map((trait, i) => (
            <Tag key={i} tone="neutral" className="max-w-[160px]" title={trait}>
              <span className="truncate">{trait}</span>
            </Tag>
          ))}
        </div>
      )}

      {/* Action row */}
      <div className="mt-auto pt-3 border-t border-dashed border-hair-strong flex items-center gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={() => onView(character)} className="flex-1 gap-1">
          <Eye className="size-3.5" /> View
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(character)} className="flex-1 gap-1">
          <Pencil className="size-3.5" /> Edit
        </Button>
        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Delete character"
          onClick={() => onDelete(character)}
          className="text-signal-flag/50 hover:text-signal-flag hover:bg-[color-mix(in_oklch,var(--signal-flag)_8%,transparent)]"
        >
          <Trash2 />
        </IconButton>
      </div>
    </article>
  );
}
