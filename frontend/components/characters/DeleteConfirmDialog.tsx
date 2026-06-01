"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  characterName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirmDialog({ characterName, onConfirm, onCancel }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-panel/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-surface-2 border border-hair rounded-[var(--r-xl)] shadow-[var(--shadow-3)] p-7 w-full max-w-sm mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <h2 className="t-h6">Delete character</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onCancel}
            className="text-ink-mute hover:text-ink transition-colors duration-[120ms] -mr-1"
          >
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>
        <p className="t-body-s text-ink-dim mb-6">
          Are you sure you want to delete <strong>{characterName}</strong>? This cannot be
          undone.
        </p>
        <div className="flex gap-3 justify-end">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
