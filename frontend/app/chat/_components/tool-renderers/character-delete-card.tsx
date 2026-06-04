"use client";

import { SavedCharacterRecordSchema } from "@open-ormus/shared";
import { Monogram } from "@/components/ui/monogram";
import type { ToolRendererProps } from "../tool-call-block";

function Shimmer({ className }: { className?: string }) {
  return (
    <div className={`bg-surface-sunk animate-pulse rounded-[var(--r-md)] ${className ?? ""}`} />
  );
}

export function CharacterDeleteCard({ result, isLoading }: ToolRendererProps) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-[var(--r-md)] border border-hair">
        <Shimmer className="size-9 rounded-full shrink-0" />
        <Shimmer className="h-3 w-32" />
      </div>
    );
  }

  const parsed = SavedCharacterRecordSchema.safeParse(result);
  const name = parsed.success ? parsed.data.name : "Character";

  return (
    <div className="bg-[color-mix(in_oklch,var(--signal-flag)_6%,var(--surface-1))] border border-[color-mix(in_oklch,var(--signal-flag)_25%,transparent)] rounded-[var(--r-md)] px-4 py-3 flex items-center gap-3">
      <Monogram name={name} size={36} shape="circle" flat />
      <div className="flex-1 min-w-0">
        <p className="t-body-s font-medium text-ink truncate">{name}</p>
        <p className="t-meta">Archived</p>
      </div>
    </div>
  );
}
