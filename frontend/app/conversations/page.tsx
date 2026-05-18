"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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

export default function ConversationsPage() {
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

  if (loading) return <p className="p-8 text-zinc-500">Loading...</p>;
  if (loadError != null) return <p className="p-8 text-red-500">{loadError}</p>;

  return (
    <div className="max-w-3xl mx-auto p-8 font-sans">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold">Conversations</h1>
        <button
          onClick={openModal}
          className="px-4 py-2 bg-black text-white text-sm rounded-md hover:bg-zinc-800"
        >
          New conversation
        </button>
      </div>

      {conversations.length === 0 ? (
        <p className="text-zinc-400 italic">No conversations yet. Start one.</p>
      ) : (
        <ul className="divide-y divide-zinc-200">
          {conversations.map((c) => (
            <li key={c.id} className="py-4 flex items-start justify-between gap-4">
              <Link href={`/conversations/${c.id}`} className="flex-1 min-w-0">
                <p className="font-medium hover:underline">{c.title}</p>
                {c.lastMessage != null ? (
                  <p className="text-sm text-zinc-500 truncate">
                    {c.lastMessage.characterName}: {c.lastMessage.content}
                  </p>
                ) : (
                  <p className="text-sm text-zinc-400 italic">No messages yet</p>
                )}
                <p className="text-xs text-zinc-400 mt-1">
                  {new Date(c.createdAt).toLocaleDateString()}
                </p>
              </Link>
              <button
                onClick={() => void handleDelete(c.id)}
                className="text-sm text-red-500 hover:text-red-700 shrink-0"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-semibold mb-4">New conversation</h2>
            <form onSubmit={(e) => void handleCreate(e)} className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Title</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  className="w-full border border-zinc-300 rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Scene context</label>
                <textarea
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  required
                  rows={3}
                  className="w-full border border-zinc-300 rounded px-3 py-2 text-sm resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Participants{" "}
                  <span className="text-zinc-400 font-normal">(select at least one)</span>
                </label>
                {characters.length === 0 ? (
                  <p className="text-sm text-zinc-400 italic">
                    No characters found. Create characters first.
                  </p>
                ) : (
                  <ul className="border border-zinc-200 rounded divide-y max-h-40 overflow-y-auto">
                    {characters.map((ch) => (
                      <li key={ch.id} className="flex items-center gap-2 px-3 py-2">
                        <input
                          type="checkbox"
                          id={`char-${ch.id}`}
                          checked={selectedIds.includes(ch.id)}
                          onChange={() => toggleCharacter(ch.id)}
                        />
                        <label htmlFor={`char-${ch.id}`} className="text-sm cursor-pointer">
                          {ch.name}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {selectedIds.length >= 3 && (
                <div>
                  <label className="block text-sm font-medium mb-2">Turn strategy</label>
                  <div className="flex flex-col gap-2">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="turnStrategy"
                        value="ORCHESTRATOR"
                        checked={turnStrategy === 'ORCHESTRATOR'}
                        onChange={() => setTurnStrategy('ORCHESTRATOR')}
                        className="mt-0.5"
                      />
                      <span className="text-sm">
                        <span className="font-medium">AI Orchestrator</span>
                        <span className="text-zinc-500 ml-1">— decides who speaks based on scene context</span>
                      </span>
                    </label>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="turnStrategy"
                        value="ROUND_ROBIN"
                        checked={turnStrategy === 'ROUND_ROBIN'}
                        onChange={() => setTurnStrategy('ROUND_ROBIN')}
                        className="mt-0.5"
                      />
                      <span className="text-sm">
                        <span className="font-medium">Round-robin</span>
                        <span className="text-zinc-500 ml-1">— characters speak in fixed cyclic order</span>
                      </span>
                    </label>
                  </div>
                </div>
              )}
              {createError != null && (
                <p className="text-sm text-red-500">{createError}</p>
              )}
              <div className="flex justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm rounded border border-zinc-300 hover:bg-zinc-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || selectedIds.length === 0}
                  className="px-4 py-2 text-sm bg-black text-white rounded hover:bg-zinc-800 disabled:opacity-50"
                >
                  {creating ? "Creating..." : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
