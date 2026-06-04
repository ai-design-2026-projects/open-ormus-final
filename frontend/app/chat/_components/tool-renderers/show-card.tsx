import { Tag } from "@/components/ui/tag";
import type { ShowResult } from "@open-ormus/shared";

export function ShowCard({ show }: { show: ShowResult }) {
  return (
    <div className="bg-surface-1 border border-hair rounded-[var(--r-md)] shadow-[var(--shadow-inset),var(--shadow-1)] px-4 py-3">
      <div className="flex items-start justify-between gap-3 mb-1">
        <p className="t-body-s font-medium text-ink">{show.title}</p>
        <div className="flex items-center gap-1 shrink-0">
          {show.year && <Tag tone="neutral">{show.year}</Tag>}
          {show.genre && <Tag tone="accent">{show.genre}</Tag>}
        </div>
      </div>
      <p className="t-body-s text-ink-dim line-clamp-2">{show.description}</p>
      {show.characters.length > 0 && (
        <p className="t-meta mt-2">{show.characters.join(" · ")}</p>
      )}
    </div>
  );
}
