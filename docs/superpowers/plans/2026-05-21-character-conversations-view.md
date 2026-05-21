# Character Conversations View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Conversations" tab to the character view drawer showing all conversations that include the given character, with a link to navigate to each conversation.

**Architecture:** New `GET /api/characters/[id]/conversations` route queries `ConversationParticipant` to find matching conversations scoped by `userId`. `CharacterViewDrawer` gains tab state ("sheet" | "conversations"); the conversations tab fetches lazily on first activation and caches results in component state.

**Tech Stack:** Next.js 15 App Router, Prisma 7, Supabase Auth, React (client component), TypeScript strict mode.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `frontend/app/api/characters/[id]/conversations/route.ts` | GET endpoint — returns conversations for a character |
| Modify | `frontend/components/characters/CharacterViewDrawer.tsx` | Add tab bar + conversations tab with fetch logic |

---

### Task 1: API route — GET /api/characters/[id]/conversations

**Files:**
- Create: `frontend/app/api/characters/[id]/conversations/route.ts`

- [ ] **Step 1: Create the route file**

```ts
// frontend/app/api/characters/[id]/conversations/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (!user || error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const conversations = await prisma.conversation.findMany({
    where: {
      userId: user.id,
      participants: { some: { characterId: id } },
    },
    orderBy: { updatedAt: "desc" },
    include: {
      participants: {
        include: { character: { select: { id: true, name: true } } },
        orderBy: { turnOrder: "asc" },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { character: { select: { name: true } } },
      },
    },
  });

  const items = conversations.map((c) => ({
    id: c.id,
    title: c.title,
    createdAt: c.createdAt.toISOString(),
    participants: c.participants.map((p) => ({
      characterId: p.character.id,
      name: p.character.name,
    })),
    lastMessage:
      c.messages[0] != null
        ? {
            characterName: c.messages[0].character.name,
            content: c.messages[0].content,
            createdAt: c.messages[0].createdAt.toISOString(),
          }
        : null,
  }));

  return NextResponse.json(items);
}
```

- [ ] **Step 2: Verify typecheck passes**

Run from repo root:
```bash
bun run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/api/characters/[id]/conversations/route.ts
git commit -m "feat: add GET /api/characters/[id]/conversations route"
```

---

### Task 2: CharacterViewDrawer — tabs + conversations tab

**Files:**
- Modify: `frontend/components/characters/CharacterViewDrawer.tsx`

- [ ] **Step 1: Replace the full file content**

```tsx
// frontend/components/characters/CharacterViewDrawer.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import type { SavedCharacterRecord } from "@open-ormus/shared";

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

  async function fetchConversations() {
    setConvsLoading(true);
    setConvsError(null);
    try {
      const res = await fetch(`/api/characters/${character.id}/conversations`);
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

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/40" />
      <div
        className="w-full max-w-xl bg-white h-full overflow-y-auto shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header + tab bar */}
        <div className="sticky top-0 bg-white border-b border-zinc-100 px-6 pt-4 z-10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-zinc-900">{character.name}</h2>
            <button
              type="button"
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-600 text-2xl leading-none"
            >
              &times;
            </button>
          </div>
          <div className="flex -mb-px">
            {(["sheet", "conversations"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => handleTabChange(tab)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? "border-zinc-900 text-zinc-900"
                    : "border-transparent text-zinc-400 hover:text-zinc-600"
                }`}
              >
                {tab === "sheet" ? "Sheet" : "Conversations"}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="px-6 py-4 flex-1">
          {activeTab === "sheet" && (
            <>
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
            </>
          )}

          {activeTab === "conversations" && (
            <>
              {convsLoading && (
                <p className="text-sm text-zinc-400 py-4">Loading...</p>
              )}
              {convsError != null && (
                <div className="py-4">
                  <p className="text-sm text-red-500 mb-2">{convsError}</p>
                  <button
                    type="button"
                    onClick={() => void fetchConversations()}
                    className="text-xs px-3 py-1.5 border border-zinc-300 rounded hover:bg-zinc-50"
                  >
                    Retry
                  </button>
                </div>
              )}
              {!convsLoading && convsError === null && conversations !== null && (
                conversations.length === 0 ? (
                  <p className="text-sm text-zinc-400 italic py-4">No conversations yet.</p>
                ) : (
                  <ul className="divide-y divide-zinc-100">
                    {conversations.map((c) => {
                      const others = c.participants
                        .filter((p) => p.characterId !== character.id)
                        .map((p) => p.name);
                      const timestamp = c.lastMessage?.createdAt ?? c.createdAt;
                      return (
                        <li key={c.id} className="py-3">
                          <Link
                            href={`/conversations/${c.id}`}
                            className="block group"
                            onClick={onClose}
                          >
                            <p className="text-sm font-medium text-zinc-900 group-hover:underline">
                              {c.title}
                            </p>
                            {others.length > 0 && (
                              <p className="text-xs text-zinc-400 mt-0.5">
                                with {others.join(", ")}
                              </p>
                            )}
                            {c.lastMessage != null ? (
                              <p className="text-xs text-zinc-500 mt-0.5 truncate">
                                {c.lastMessage.characterName}: {c.lastMessage.content}
                              </p>
                            ) : (
                              <p className="text-xs text-zinc-400 italic mt-0.5">No messages yet</p>
                            )}
                            <p className="text-xs text-zinc-300 mt-0.5">
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
```

- [ ] **Step 2: Verify typecheck passes**

Run from repo root:
```bash
bun run typecheck
```
Expected: no errors.

- [ ] **Step 3: Smoke test in browser**

1. Start dev server: `bun run dev:frontend`
2. Navigate to `http://localhost:3000`
3. Click any character → drawer opens → confirm "Sheet" tab is active and shows existing content
4. Click "Conversations" tab → spinner appears briefly → list of conversations renders (or "No conversations yet")
5. Click a conversation title → navigates to `/conversations/[id]`, drawer closes
6. Re-open drawer → switch to Conversations → no second fetch fires (cached)
7. Confirm error state: temporarily break the URL in DevTools Network to intercept; "Retry" button re-fetches

- [ ] **Step 4: Commit**

```bash
git add frontend/components/characters/CharacterViewDrawer.tsx
git commit -m "feat: add conversations tab to CharacterViewDrawer"
```
