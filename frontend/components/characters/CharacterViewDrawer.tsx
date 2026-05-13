"use client";

import type { SavedCharacterRecord } from "@open-ormus/shared";

interface Props {
  character: SavedCharacterRecord | null;
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-zinc-100 pt-4 mt-4">
      <h4 className="text-xs font-semibold uppercase text-zinc-400 tracking-wider mb-2">
        {title}
      </h4>
      {children}
    </div>
  );
}

function TagList({ items }: { items: string[] }) {
  if (items.length === 0)
    return <p className="text-sm text-zinc-400 italic">None</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, i) => (
        <span key={i} className="text-xs bg-zinc-100 text-zinc-700 px-2 py-1 rounded-full">
          {item}
        </span>
      ))}
    </div>
  );
}

function KVList({ entries }: { entries: Record<string, string> }) {
  const pairs = Object.entries(entries);
  if (pairs.length === 0)
    return <p className="text-sm text-zinc-400 italic">None</p>;
  return (
    <dl className="space-y-2">
      {pairs.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs font-medium text-zinc-500">{k}</dt>
          <dd className="text-sm text-zinc-700">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CharacterViewDrawer({ character, onClose }: Props) {
  if (!character) return null;
  const { sheet } = character;
  const p = sheet.personality;

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/40" />
      <div
        className="w-full max-w-xl bg-white h-full overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-zinc-100 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900">{character.name}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 text-2xl leading-none"
          >
            &times;
          </button>
        </div>
        <div className="px-6 py-4">
          <p className="text-sm text-zinc-600">{sheet.shortDescription}</p>
          {sheet.firstAppearanceDate && (
            <p className="text-xs text-zinc-400 mt-1">
              First appearance: {sheet.firstAppearanceDate}
            </p>
          )}

          <Section title="Personality Traits">
            <TagList items={p.personalityTraits} />
          </Section>

          <Section title="Backstory">
            <p className="text-sm text-zinc-700 whitespace-pre-wrap">
              {p.backstory || <span className="italic text-zinc-400">None</span>}
            </p>
          </Section>

          <Section title="Speech Patterns">
            <TagList items={p.speechPatterns} />
          </Section>

          <Section title="Values">
            <TagList items={p.values} />
          </Section>

          <Section title="Goals">
            <TagList items={p.goals} />
          </Section>

          <Section title="Fears">
            <TagList items={p.fears} />
          </Section>

          <Section title="Notable Quotes">
            {p.notableQuotes.length === 0 ? (
              <p className="text-sm text-zinc-400 italic">None</p>
            ) : (
              <ul className="space-y-1">
                {p.notableQuotes.map((q: string, i: number) => (
                  <li key={i} className="text-sm text-zinc-700 italic">
                    &ldquo;{q}&rdquo;
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Abilities">
            <TagList items={p.abilities} />
          </Section>

          <Section title="Coping Style">
            <TagList items={p.copingStyle} />
          </Section>

          <Section title="Relationships">
            <KVList entries={p.relationships} />
          </Section>

          <Section title="Knowledge Scope">
            <KVList entries={p.knowledgeScope} />
          </Section>
        </div>
      </div>
    </div>
  );
}
