"use client";

type Props = {
  original: string;
  improved: string;
  onAccept: (text: string) => void;
  onDiscard: () => void;
};

export function ImproveContextModal({ original, improved, onAccept, onDiscard }: Props) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]" onClick={onDiscard}>
      <div className="bg-white rounded-lg p-6 w-full max-w-2xl shadow-xl mx-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">Improved scene context</h2>
        <div className="flex flex-col sm:flex-row gap-4 mb-4">
          <div className="flex-1">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">
              Original
            </p>
            <div className="border border-zinc-200 rounded p-3 text-sm text-zinc-600 bg-zinc-50 min-h-[100px] whitespace-pre-wrap">
              {original}
            </div>
          </div>
          <div className="flex-1">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">
              Improved
            </p>
            <div className="border border-zinc-200 rounded p-3 text-sm text-zinc-800 bg-white min-h-[100px] whitespace-pre-wrap">
              {improved}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onDiscard}
            className="px-4 py-2 text-sm rounded border border-zinc-300 hover:bg-zinc-50 transition-colors"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={() => onAccept(improved)}
            className="px-4 py-2 text-sm bg-black text-white rounded hover:bg-zinc-800 transition-colors"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
