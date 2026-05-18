"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Participant = { characterId: string; name: string; turnOrder: number };
type Message = {
  id: string;
  characterName: string;
  content: string;
  createdAt: string;
};
type ConversationDetail = {
  id: string;
  title: string;
  context: string;
  turnStrategy: 'ORCHESTRATOR' | 'ROUND_ROBIN';
  participants: Participant[];
  messages: Message[];
};

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/conversations/${id}`);
    if (res.ok) setConversation((await res.json()) as ConversationDetail);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [id]);

  async function handleGenerateNext() {
    if (conversation === null) return;
    setGenerating(true);
    setGenerateError(null);
    const res = await fetch(`/api/conversations/${id}/next`, { method: "POST" });
    setGenerating(false);
    if (res.ok) {
      const newMessage = (await res.json()) as Message;
      setConversation((prev) =>
        prev !== null ? { ...prev, messages: [...prev.messages, newMessage] } : prev
      );
    } else {
      setGenerateError("Failed to generate next message. Check that LiteLLM is running.");
    }
  }

  if (loading) return <p className="p-8 text-zinc-500">Loading...</p>;
  if (conversation === null) return <p className="p-8 text-zinc-500">Conversation not found.</p>;

  const sortedParticipants = [...conversation.participants].sort(
    (a, b) => a.turnOrder - b.turnOrder
  );
  const nextSpeaker =
    sortedParticipants[conversation.messages.length % sortedParticipants.length];

  return (
    <div className="max-w-3xl mx-auto p-8 font-sans">
      <Link
        href="/conversations"
        className="text-sm text-zinc-500 hover:text-black mb-4 block"
      >
        ← Back to conversations
      </Link>

      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-2xl font-semibold">{conversation.title}</h1>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            conversation.turnStrategy === 'ORCHESTRATOR'
              ? 'bg-indigo-100 text-indigo-700'
              : 'bg-zinc-100 text-zinc-600'
          }`}
        >
          {conversation.turnStrategy === 'ORCHESTRATOR' ? 'Orchestrator' : 'Round-robin'}
        </span>
      </div>
      <p className="text-sm text-zinc-500 mb-6">
        {sortedParticipants.map((p) => p.name).join(", ")}
      </p>

      <div className="flex flex-col gap-3 mb-8 min-h-[4rem]">
        {conversation.messages.length === 0 ? (
          <p className="text-zinc-400 italic">No messages yet. Generate the first one.</p>
        ) : (
          conversation.messages.map((m) => (
            <div key={m.id} className="text-sm">
              <span className="font-medium">{m.characterName}:</span>{" "}
              <span className="text-zinc-700">{m.content}</span>
              <span className="text-xs text-zinc-400 ml-2">
                {new Date(m.createdAt).toLocaleTimeString()}
              </span>
            </div>
          ))
        )}
      </div>

      {conversation.turnStrategy === 'ROUND_ROBIN' && nextSpeaker !== undefined && (
        <p className="text-xs text-zinc-400 mb-2">Next: {nextSpeaker.name}</p>
      )}

      {generateError !== null && (
        <p className="text-sm text-red-500 mb-2">{generateError}</p>
      )}

      <button
        onClick={() => void handleGenerateNext()}
        disabled={generating}
        className="px-4 py-2 bg-black text-white text-sm rounded-md hover:bg-zinc-800 disabled:opacity-50"
      >
        {generating ? "Generating..." : "Generate next"}
      </button>
    </div>
  );
}
