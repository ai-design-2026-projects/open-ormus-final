"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import type { SavedCharacterRecord } from "@open-ormus/shared";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";

interface Props {
  character: SavedCharacterRecord | null;
  onClose: () => void;
}

type Tab = "sheet" | "conversations";

type ConversationParticipant = { characterId: string; name: string };
type ConversationItem = {
  id: string;
  title: string;
  createdAt: string;
  participants: ConversationParticipant[];
  lastMessage: {
    characterName: string;
    content: string;
    createdAt: string;
  } | null;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-1 border border-hair rounded-[var(--r-lg)] p-5 shadow-[var(--shadow-inset),var(--shadow-1)] mt-4">
      <h4 className="t-h6 mb-3">{title}</h4>
      {children}
    </div>
  );
}

function TagList({ items }: { items: string[] }) {
  if (items.length === 0)
    return <p className="t-body-s text-ink-faint italic">None</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, i) => (
        <Tag key={i} tone="neutral">{item}</Tag>
      ))}
    </div>
  );
}

function KVList({ entries }: { entries: Record<string, string> }) {
  const pairs = Object.entries(entries);
  if (pairs.length === 0)
    return <p className="t-body-s text-ink-faint italic">None</p>;
  return (
    <dl className="space-y-2">
      {pairs.map(([k, v]) => (
        <div key={k}>
          <dt className="t-meta text-ink-mute">{k}</dt>
          <dd className="t-body-s text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function CharacterViewDrawer({ character, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("sheet");
  const [conversations, setConversations] = useState<ConversationItem[] | null>(null);
  const [convsLoading, setConvsLoading] = useState(false);
  const [convsError, setConvsError] = useState<string | null>(null);

  if (!character) return null;

  const characterId = character.id;

  async function fetchConversations() {
    setConvsLoading(true);
    setConvsError(null);
    try {
      const res = await fetch(`/api/characters/${characterId}/conversations`);
      if (!res.ok) {
        setConvsError(`Error ${res.status}: failed to load conversations`);
        return;
      }
      setConversations((await res.json()) as ConversationItem[]);
    } catch {
      setConvsError("Could not reach the server.");
    } finally {
      setConvsLoading(false);
    }
  }

  function handleTabChange(tab: Tab) {
    setActiveTab(tab);
    if (tab === "conversations" && conversations === null && !convsLoading) {
      void fetchConversations();
    }
  }

  const { sheet } = character;
  const p = sheet.personality;

  const TABS: { value: Tab; label: string }[] = [
    { value: "sheet", label: "Sheet" },
    { value: "conversations", label: "Conversations" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink-panel/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-surface-1 border-l border-hair w-full max-w-xl h-full flex flex-col shadow-[var(--shadow-3)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header */}
        <div className="sticky top-0 z-10 bg-surface-2 border-b border-hair px-6 py-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="t-h6">{character.name}</h2>
            <IconButton variant="ghost" size="sm" aria-label="Close" onClick={onClose}>
              <X strokeWidth={1.5} className="size-4" />
            </IconButton>
          </div>
          {/* Tab buttons */}
          <div className="flex gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => handleTabChange(tab.value)}
                className={`px-3 py-1.5 text-[12.5px] font-medium rounded-[8px] transition-all duration-[120ms] ${
                  activeTab === tab.value
                    ? "bg-surface-1 text-ink shadow-[var(--shadow-1),0_0_0_1px_var(--hair-strong)]"
                    : "text-ink-mute hover:text-ink"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="px-6 py-4 flex-1 overflow-y-auto">
          {activeTab === "sheet" && (
            <>
              <p className="t-body-s text-ink-dim">{sheet.shortDescription}</p>
              {sheet.firstAppearanceDate && (
                <p className="t-meta text-ink-faint mt-1">
                  First appearance: {sheet.firstAppearanceDate}
                </p>
              )}

              <Section title="Personality Traits">
                <TagList items={p.personalityTraits} />
              </Section>

              <Section title="Backstory">
                <p className="t-body-s text-ink whitespace-pre-wrap">
                  {p.backstory || <span className="italic text-ink-faint">None</span>}
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
                  <p className="t-body-s text-ink-faint italic">None</p>
                ) : (
                  <ul className="space-y-1">
                    {p.notableQuotes.map((q: string, i: number) => (
                      <li key={i} className="t-body-s text-ink italic">
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
            </>
          )}

          {activeTab === "conversations" && (
            <>
              {convsLoading && (
                <p className="t-body-s text-ink-mute py-4">Loading...</p>
              )}
              {convsError != null && (
                <div className="py-4">
                  <p className="t-body-s text-signal-flag mb-2">{convsError}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void fetchConversations()}
                  >
                    Retry
                  </Button>
                </div>
              )}
              {!convsLoading && convsError === null && conversations !== null && (
                conversations.length === 0 ? (
                  <p className="t-body-s text-ink-faint italic py-4">No conversations yet</p>
                ) : (
                  <ul className="divide-y divide-hair">
                    {conversations.map((c) => {
                      const others = c.participants
                        .filter((p) => p.characterId !== characterId)
                        .map((p) => p.name);
                      const timestamp = c.lastMessage?.createdAt ?? c.createdAt;
                      return (
                        <li key={c.id} className="py-3">
                          <Link
                            href={`/conversations/${c.id}`}
                            className="block group"
                            onClick={onClose}
                          >
                            <p className="t-body-s font-medium text-ink group-hover:underline">
                              {c.title}
                            </p>
                            {others.length > 0 && (
                              <p className="t-meta text-ink-mute mt-0.5">
                                with {others.join(", ")}
                              </p>
                            )}
                            {c.lastMessage != null ? (
                              <p className="t-meta text-ink-dim mt-0.5 truncate">
                                {c.lastMessage.characterName}: {c.lastMessage.content}
                              </p>
                            ) : (
                              <p className="t-meta text-ink-faint italic mt-0.5">No messages yet</p>
                            )}
                            <p className="t-meta text-ink-faint mt-0.5">
                              {formatRelativeTime(timestamp)}
                            </p>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
