"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { ImproveContextModal } from "@/components/conversations/ImproveContextModal";
import { ImproveContextOutputSchema } from "@open-ormus/shared";
import { AppNav } from "@/components/app-shell/AppNav";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Monogram } from "@/components/ui/monogram";
import { Textarea } from "@/components/ui/textarea";

type Participant = { characterId: string; name: string };
type LastMessage = {
  characterName: string;
  content: string;
  createdAt: string;
} | null;
type ConversationItem = {
  id: string;
  title: string;
  createdAt: string;
  participants: Participant[];
  lastMessage: LastMessage;
};
type Character = { id: string; name: string };

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function ConversationsPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [turnStrategy, setTurnStrategy] = useState<'ORCHESTRATOR' | 'ROUND_ROBIN'>('ORCHESTRATOR');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [charSearch, setCharSearch] = useState("");
  const [improving, setImproving] = useState(false);
  const [improveResult, setImproveResult] = useState<{
    original: string;
    improved: string;
  } | null>(null);

  async function loadConversations() {
    try {
      const res = await fetch("/api/conversations");
      if (res.ok) setConversations((await res.json()) as ConversationItem[]);
      else setLoadError(`Error ${res.status}: failed to load conversations`);
    } catch {
      setLoadError("Could not reach the server. Check that the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  async function loadCharacters() {
    const res = await fetch("/api/characters");
    if (res.ok) setCharacters((await res.json()) as Character[]);
  }

  useEffect(() => {
    void loadConversations();
    void loadCharacters();

    const interval = setInterval(() => {
      if (!document.hidden) void loadConversations();
    }, 5000);

    const onVisible = () => {
      if (!document.hidden) void loadConversations();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleCharacter(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function openModal() {
    setTitle("");
    setContext("");
    setSelectedIds([]);
    setCreateError(null);
    setTurnStrategy('ORCHESTRATOR');
    setImproveResult(null);
    setImproving(false);
    setCharSearch("");
    setShowModal(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    // Preserve alphabetical display order for turnOrder, not click order
    const orderedIds = characters
      .filter((ch) => selectedIds.includes(ch.id))
      .map((ch) => ch.id);
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, context, characterIds: orderedIds, turnStrategy }),
    });
    setCreating(false);
    if (res.ok) {
      setShowModal(false);
      void loadConversations();
    } else {
      setCreateError("Failed to create conversation.");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this conversation?")) return;
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    void loadConversations();
  }

  async function handleImprove() {
    setImproving(true);
    setCreateError(null);
    const draftAtClick = context;
    try {
      const res = await fetch("/api/conversations/improve-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: draftAtClick, characterIds: selectedIds }),
      });
      if (!res.ok) {
        setCreateError("Improvement failed — try again.");
        return;
      }
      const parsed = ImproveContextOutputSchema.safeParse(await res.json());
      if (!parsed.success) {
        setCreateError("Improvement failed — try again.");
        return;
      }
      setImproveResult({ original: draftAtClick, improved: parsed.data.improved });
    } catch {
      setCreateError("Improvement failed — try again.");
    } finally {
      setImproving(false);
    }
  }

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter(
      (conv) =>
        conv.title.toLowerCase().includes(q) ||
        conv.participants.some((p) => p.name.toLowerCase().includes(q))
    );
  }, [conversations, searchQuery]);

  if (loading) {
    return (
      <div className="bg-background min-h-screen">
        <AppNav />
        <div className="max-w-[1440px] mx-auto px-14">
          <div className="flex items-end justify-between py-8">
            <div className="h-12 w-64 bg-surface-sunk animate-pulse rounded-[var(--r-md)]" />
            <div className="h-8 w-28 bg-surface-sunk animate-pulse rounded-[var(--r-md)]" />
          </div>
          <div className="flex flex-col gap-2 pb-14">
            {[1, 2, 3].map((n) => (
              <div key={n} className="bg-surface-sunk animate-pulse rounded-[var(--r-md)] h-16" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (loadError != null) {
    return (
      <div className="bg-background min-h-screen">
        <AppNav />
        <div className="max-w-[1440px] mx-auto px-14 py-8">
          <p className="text-sm text-signal-flag">{loadError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background min-h-screen">
      <AppNav />
      <div className="max-w-[1440px] mx-auto px-14">
        {/* Page header */}
        <div className="flex items-end justify-between py-8">
          <div>
            <div className="t-meta">SCENES · {conversations.length} SESSIONS</div>
            <h1 className="t-h2 mt-2 mb-0">
              Two voices, <em className="t-editorial">one stage</em>.
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {conversations.length > 0 && (
              <>
                <div className="relative w-56 transition-[width] duration-[180ms] focus-within:w-72">
                  <Search strokeWidth={1.5} className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-ink-faint pointer-events-none z-10" />
                  <Input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search scenes or characters…"
                    className="pl-8 w-full"
                  />
                </div>
                {searchQuery && (
                  <span className="t-meta text-ink-mute whitespace-nowrap">
                    {filteredConversations.length} of {conversations.length}
                  </span>
                )}
              </>
            )}
            <Button variant="default" onClick={openModal}>
              <Plus strokeWidth={1.5} className="size-4" />
              New scene
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-[1440px] mx-auto px-14">
        {/* Conversations list */}
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
            <div className="size-14 rounded-full border border-dashed border-hair-strong flex items-center justify-center text-ink-dim">
              <Plus strokeWidth={1.5} className="size-6" />
            </div>
            <div className="t-h6 m-0">No scenes yet</div>
            <div className="t-body-s text-ink-mute">Start your first scene to see it here.</div>
            <Button variant="default" onClick={openModal}>New scene</Button>
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
            <div className="t-h6 m-0 text-ink-dim">No results</div>
            <div className="t-body-s text-ink-mute">No scenes match &ldquo;{searchQuery}&rdquo;</div>
            <button
              onClick={() => setSearchQuery("")}
              className="t-body-s text-accent-deep hover:underline"
            >
              Clear search
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 pb-14">
            {filteredConversations.map((conv) => {
              const castNames = conv.participants.length > 0
                ? conv.participants.map((p) => p.name).join(" · ")
                : conv.title;
              return (
                <div
                  key={conv.id}
                  className="grid items-center gap-4 px-[18px] py-[14px] bg-surface-1 border border-hair rounded-[var(--r-md)] cursor-pointer transition-[border-color,background] duration-[120ms] hover:border-hair-strong hover:bg-surface-2"
                  style={{ gridTemplateColumns: "100px 1fr 200px auto" }}
                  onClick={() => router.push(`/conversations/${conv.id}`)}
                >
                  {/* Avatars — fixed 100px column, stacked Monograms */}
                  <div className="flex items-center">
                    {conv.participants.slice(0, 3).map((p, i) => (
                      <div key={p.characterId} style={{ marginLeft: i === 0 ? 0 : -10, zIndex: 3 - i }}>
                        <Monogram name={p.name} size={36} />
                      </div>
                    ))}
                  </div>

                  {/* Text: scene title primary, cast names secondary */}
                  <div className="min-w-0">
                    <div className="font-medium text-ink text-[14px] truncate">{conv.title}</div>
                    <div className="t-body-s text-ink-dim truncate max-w-[60ch] mt-0.5">{castNames}</div>
                  </div>

                  {/* Meta: timestamp + last-message indicator */}
                  <div className="flex items-center gap-3 justify-end">
                    <span className="t-meta">{relativeTime(conv.lastMessage?.createdAt ?? conv.createdAt)}</span>
                    {conv.lastMessage != null && (
                      <span className="t-mono text-[11px] text-ink-mute">
                        {conv.lastMessage.characterName.split(" ")[0]}…
                      </span>
                    )}
                  </div>

                  {/* Delete + chevron */}
                  <div className="flex items-center gap-1">
                    <IconButton
                      variant="ghost"
                      size="sm"
                      aria-label="Delete conversation"
                      onClick={(e) => { e.stopPropagation(); void handleDelete(conv.id); }}
                    >
                      <Trash2 strokeWidth={1.5} className="size-4 text-ink-faint hover:text-signal-flag" />
                    </IconButton>
                    <IconButton
                      variant="ghost"
                      size="sm"
                      aria-label="Open"
                      tabIndex={-1}
                      aria-hidden={true}
                      onClick={() => router.push(`/conversations/${conv.id}`)}
                    >
                      <ChevronRight strokeWidth={1.5} className="size-4" />
                    </IconButton>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-panel/60 backdrop-blur-sm">
          <div
            className="bg-surface-1 border border-hair rounded-[var(--r-xl)] shadow-[var(--shadow-3)] w-full max-w-lg p-7"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="t-h6 mb-6">New scene</h2>
            <form onSubmit={(e) => void handleCreate(e)} className="flex flex-col gap-4">
              <div>
                <label className="block t-meta mb-1.5">Title</label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  placeholder="Give this scene a name"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block t-meta">Scene context</label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleImprove()}
                    disabled={!context.trim() || selectedIds.length === 0 || improving}
                  >
                    {improving ? (
                      <Loader2 strokeWidth={1.5} className="size-3.5 animate-spin" />
                    ) : (
                      <Sparkles strokeWidth={1.5} className="size-3.5" />
                    )}
                    {improving ? "Improving…" : "Improve"}
                  </Button>
                </div>
                <Textarea
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  required
                  rows={3}
                  placeholder="Describe the setting, mood, or situation…"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block t-meta">
                    Participants{" "}
                    <span className="text-ink-mute font-normal">(select at least one)</span>
                  </label>
                  {characters.length > 4 && (
                    <div className="relative">
                      <Search strokeWidth={1.5} className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-ink-faint pointer-events-none z-10" />
                      <Input
                        type="search"
                        value={charSearch}
                        onChange={(e) => setCharSearch(e.target.value)}
                        placeholder="Filter…"
                        className="pl-6 h-7 w-28 text-xs"
                      />
                    </div>
                  )}
                </div>
                {characters.length === 0 ? (
                  <p className="t-body-s text-ink-mute italic">
                    No characters found. Create characters first.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                    {characters
                      .filter((ch) =>
                        charSearch.trim() === "" ||
                        ch.name.toLowerCase().includes(charSearch.toLowerCase())
                      )
                      .map((ch) => (
                      <label
                        key={ch.id}
                        htmlFor={`char-${ch.id}`}
                        className={[
                          "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--r-md)] border text-sm cursor-pointer transition-[border-color,background] duration-[120ms]",
                          selectedIds.includes(ch.id)
                            ? "bg-accent-soft border-[color-mix(in_oklch,var(--accent-oo)_30%,transparent)] text-accent-deep"
                            : "bg-surface-2 border-hair text-ink-dim hover:border-hair-strong hover:text-ink",
                        ].join(" ")}
                      >
                        <input
                          type="checkbox"
                          id={`char-${ch.id}`}
                          checked={selectedIds.includes(ch.id)}
                          onChange={() => toggleCharacter(ch.id)}
                          className="sr-only"
                        />
                        {ch.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              {selectedIds.length >= 3 && (
                <div>
                  <label className="block t-meta mb-2">Turn strategy</label>
                  <div className="flex flex-col gap-2">
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="radio"
                        name="turnStrategy"
                        value="ORCHESTRATOR"
                        checked={turnStrategy === 'ORCHESTRATOR'}
                        onChange={() => setTurnStrategy('ORCHESTRATOR')}
                        className="mt-0.5 accent-[var(--accent-oo)]"
                      />
                      <span className="t-body-s">
                        <span className="font-medium text-ink">AI Orchestrator</span>
                        <span className="text-ink-mute ml-1">— decides who speaks based on scene context</span>
                      </span>
                    </label>
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="radio"
                        name="turnStrategy"
                        value="ROUND_ROBIN"
                        checked={turnStrategy === 'ROUND_ROBIN'}
                        onChange={() => setTurnStrategy('ROUND_ROBIN')}
                        className="mt-0.5 accent-[var(--accent-oo)]"
                      />
                      <span className="t-body-s">
                        <span className="font-medium text-ink">Round-robin</span>
                        <span className="text-ink-mute ml-1">— characters speak in fixed cyclic order</span>
                      </span>
                    </label>
                  </div>
                </div>
              )}
              {createError != null && (
                <p className="t-body-s text-signal-flag">{createError}</p>
              )}
              <div className="flex justify-end gap-3 mt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="default"
                  disabled={creating || selectedIds.length === 0}
                >
                  {creating ? (
                    <>
                      <Loader2 strokeWidth={1.5} className="size-4 animate-spin" />
                      Creating…
                    </>
                  ) : (
                    "Create"
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ImproveContextModal at root level — sibling of create modal, avoids z-index stacking issues */}
      {improveResult != null && (
        <ImproveContextModal
          original={improveResult.original}
          improved={improveResult.improved}
          onAccept={(text) => {
            setContext(text);
            setImproveResult(null);
          }}
          onDiscard={() => setImproveResult(null)}
        />
      )}
    </div>
  );
}
