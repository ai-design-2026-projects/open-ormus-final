"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  original: string;
  improved: string;
  onAccept: (text: string) => void;
  onDiscard: () => void;
};

export function ImproveContextModal({ original, improved, onAccept, onDiscard }: Props) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-panel/60 backdrop-blur-sm"
      onClick={onDiscard}
    >
      <div
        className="bg-surface-1 border border-hair rounded-[var(--r-xl)] shadow-[var(--shadow-3)] w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-7 py-5 border-b border-hair">
          <h2 className="t-h6">Improved scene context</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onDiscard}
            className="text-ink-mute hover:text-ink transition-colors duration-[120ms] -mr-1"
          >
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>

        {/* Two-panel body */}
        <div className="grid grid-cols-2 gap-0 flex-1 overflow-hidden">
          <div className="flex flex-col p-6 overflow-y-auto border-r border-hair">
            <div className="t-meta mb-3">ORIGINAL</div>
            <p className="text-sm text-ink-dim leading-relaxed whitespace-pre-wrap">{original}</p>
          </div>
          <div className="flex flex-col p-6 overflow-y-auto">
            <div className="t-meta mb-3">IMPROVED</div>
            <p className="text-sm text-ink-dim leading-relaxed whitespace-pre-wrap">{improved}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-7 py-5 border-t border-hair">
          <Button type="button" variant="ghost" onClick={onDiscard}>
            Discard
          </Button>
          <Button type="button" variant="default" onClick={() => onAccept(improved)}>
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}
