"use client";

import { useState } from "react";
import Image from "next/image";
import { SavedCharacterRecordSchema, CharacterSearchResultSchema } from "@open-ormus/shared";
import { Monogram } from "@/components/ui/monogram";
import { Tag } from "@/components/ui/tag";
import type { ToolRendererProps } from "../tool-call-block";

function Shimmer({ className }: { className?: string }) {
  return (
    <div className={`bg-surface-sunk animate-pulse rounded-[var(--r-md)] ${className ?? ""}`} />
  );
}

export function CharacterCard({ result, isLoading }: ToolRendererProps) {
  const [expanded, setExpanded] = useState(false);

  if (isLoading) {
    return (
      <div className="bg-surface-1 border border-hair rounded-[var(--r-lg)] shadow-[var(--shadow-inset),var(--shadow-1)] p-4 space-y-3">
        <div className="flex items-center gap-3">
          <Shimmer className="size-14 rounded-full shrink-0" />
          <div className="space-y-2 flex-1">
            <Shimmer className="h-3.5 w-32" />
            <Shimmer className="h-2.5 w-48" />
          </div>
        </div>
        <div className="flex gap-1.5">
          <Shimmer className="h-[22px] w-16" />
          <Shimmer className="h-[22px] w-20" />
          <Shimmer className="h-[22px] w-14" />
        </div>
      </div>
    );
  }

  // Try SavedCharacterRecord first, then bare CharacterSearchResult
  const saved = SavedCharacterRecordSchema.safeParse(result);
  const sheet = saved.success
    ? saved.data.sheet
    : CharacterSearchResultSchema.safeParse(result).data;

  if (!sheet) {
    return (
      <div className="bg-surface-1 border border-hair rounded-[var(--r-lg)] shadow-[var(--shadow-inset),var(--shadow-1)] p-4">
        <pre className="t-mono text-ink-mute overflow-x-auto text-[11px]">
          {JSON.stringify(result, null, 2)}
        </pre>
      </div>
    );
  }

  const name = sheet.name;
  const traits = sheet.personality.personalityTraits;

  // Find 512px picture from SavedCharacterRecord if available
  const avatarUrl = saved.success
    ? saved.data.pictures?.find((p) => p.size === 512)?.url ?? null
    : null;

  return (
    <div className="bg-surface-1 border border-hair rounded-[var(--r-lg)] shadow-[var(--shadow-inset),var(--shadow-1)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 p-4">
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt={name}
            width={56}
            height={56}
            className="size-14 rounded-full object-cover shrink-0"
          />
        ) : (
          <Monogram name={name} size={56} />
        )}
        <div className="flex-1 min-w-0">
          <p className="t-h6 truncate">{name}</p>
          {sheet.firstAppearanceDate && (
            <p className="t-meta mt-0.5">{sheet.firstAppearanceDate}</p>
          )}
        </div>
      </div>

      {/* Traits row */}
      <div className="px-4 pb-3 flex flex-wrap gap-1.5">
        {traits.slice(0, expanded ? traits.length : 3).map((t) => (
          <Tag key={t} tone="neutral">{t}</Tag>
        ))}
        {!expanded && traits.length > 3 && (
          <span className="t-meta text-ink-faint self-center">
            +{traits.length - 3} more
          </span>
        )}
      </div>

      {/* Expanded: full personality */}
      {expanded && (
        <>
          <PersonalitySection title="Backstory">
            <p className="t-body-s text-ink-dim whitespace-pre-wrap">
              {sheet.personality.backstory}
            </p>
          </PersonalitySection>

          <PersonalitySection title="Values">
            <TagList items={sheet.personality.values} />
          </PersonalitySection>

          <PersonalitySection title="Fears">
            <TagList items={sheet.personality.fears} />
          </PersonalitySection>

          <PersonalitySection title="Goals">
            <TagList items={sheet.personality.goals} />
          </PersonalitySection>

          <PersonalitySection title="Speech Patterns">
            <TagList items={sheet.personality.speechPatterns} />
          </PersonalitySection>

          <PersonalitySection title="Abilities">
            <TagList items={sheet.personality.abilities} />
          </PersonalitySection>

          <PersonalitySection title="Coping Style">
            <TagList items={sheet.personality.copingStyle} />
          </PersonalitySection>

          {sheet.personality.notableQuotes.length > 0 && (
            <PersonalitySection title="Notable Quotes">
              <ul className="space-y-1">
                {sheet.personality.notableQuotes.map((q, i) => (
                  <li key={i} className="t-body-s text-ink-dim italic">
                    &ldquo;{q}&rdquo;
                  </li>
                ))}
              </ul>
            </PersonalitySection>
          )}

          {Object.keys(sheet.personality.relationships).length > 0 && (
            <PersonalitySection title="Relationships">
              <dl className="space-y-1">
                {Object.entries(sheet.personality.relationships).map(([person, rel]) => (
                  <div key={person} className="flex gap-2">
                    <dt className="t-meta text-ink-mute shrink-0">{person}</dt>
                    <dd className="t-body-s text-ink">{rel}</dd>
                  </div>
                ))}
              </dl>
            </PersonalitySection>
          )}

          {Object.keys(sheet.personality.knowledgeScope).length > 0 && (
            <PersonalitySection title="Knowledge Scope">
              <dl className="space-y-1">
                {Object.entries(sheet.personality.knowledgeScope).map(([domain, desc]) => (
                  <div key={domain} className="flex gap-2">
                    <dt className="t-meta text-ink-mute shrink-0">{domain}</dt>
                    <dd className="t-body-s text-ink">{desc}</dd>
                  </div>
                ))}
              </dl>
            </PersonalitySection>
          )}
        </>
      )}

      {/* Toggle */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full px-4 py-2.5 border-t border-hair text-left t-meta text-ink-mute hover:text-ink hover:bg-surface-2 transition-colors duration-[120ms]"
      >
        {expanded ? "Show less ▲" : "Show full profile ▼"}
      </button>
    </div>
  );
}

function PersonalitySection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3 border-t border-hair">
      <p className="t-meta mb-2">{title}</p>
      {children}
    </div>
  );
}

function TagList({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="t-body-s text-ink-faint">—</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <Tag key={i} tone="neutral">{item}</Tag>
      ))}
    </div>
  );
}
