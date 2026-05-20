// frontend/app/conversations/[id]/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Participant = { characterId: string; name: string; turnOrder: number };
type Message = {
  id: string;
  characterName: string;
  content: string;
  reasoning: string | null;
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
type ActiveJob = {
  id: string;
  totalTurns: number;
  doneTurns: number;
  status: string;
};

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();

  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [turnsInput, setTurnsInput] = useState("5");
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [streamingBuffer, setStreamingBuffer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [expandedReasonings, setExpandedReasonings] = useState<Set<string>>(new Set());

  const eventSourceRef = useRef<EventSource | null>(null);
  const isMountedRef = useRef(true);

  function toggleReasoning(id: string) {
    setExpandedReasonings((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function loadConversation() {
    const res = await fetch(`/api/conversations/${id}`);
    if (res.ok) setConversation((await res.json()) as ConversationDetail);
    setLoading(false);
  }

  async function checkActiveJob() {
    const res = await fetch(`/api/conversations/${id}/jobs`);
    if (!res.ok) return;
    const job = (await res.json()) as ActiveJob | null;
    if (job && (job.status === "running" || job.status === "pending")) {
      setActiveJob(job);
      connectToJob(job.id);
    }
  }

  function connectToJob(jobId: string) {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`/api/conversations/${id}/jobs/${jobId}/stream`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      const data = JSON.parse(event.data as string) as {
        type: string;
        text?: string;
        doneTurns?: number;
        totalTurns?: number;
        message?: string;
      };

      if (data.type === "token") {
        setStreamingBuffer((prev) => prev + (data.text ?? ""));
      } else if (data.type === "turn_done") {
        const doneTurns = data.doneTurns;
        void loadConversation().then(() => {
          setStreamingBuffer("");
          setActiveJob((prev) =>
            prev ? { ...prev, doneTurns: doneTurns ?? prev.doneTurns } : prev,
          );
        });
      } else if (data.type === "thinking") {
        setIsThinking(true);
      } else if (data.type === "thinking_done") {
        setIsThinking(false);
      } else if (data.type === "done") {
        es.close();
        eventSourceRef.current = null;
        setIsThinking(false);
        setActiveJob(null);
        setStreamingBuffer("");
        void loadConversation();
      } else if (data.type === "error") {
        es.close();
        eventSourceRef.current = null;
        setIsThinking(false);
        setActiveJob(null);
        setStreamingBuffer("");
        setError(data.message ?? "Job failed");
      }
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      if (isMountedRef.current) {
        setIsThinking(false);
        setActiveJob(null);
        setStreamingBuffer("");
      }
    };
  }

  useEffect(() => {
    isMountedRef.current = true;
    void loadConversation();
    void checkActiveJob();

    return () => {
      isMountedRef.current = false;
      eventSourceRef.current?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleRun() {
    const turns = parseInt(turnsInput, 10);
    if (isNaN(turns) || turns < 1 || turns > 500) {
      setError("Enter a number between 1 and 500");
      return;
    }
    setError(null);

    const res = await fetch(`/api/conversations/${id}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turns }),
    });

    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      setError(body.error ?? "Failed to start job");
      return;
    }

    const { jobId } = (await res.json()) as { jobId: string };
    setActiveJob({ id: jobId, totalTurns: turns, doneTurns: 0, status: "running" });
    connectToJob(jobId);
  }

  async function handleStop() {
    if (!activeJob) return;
    await fetch(`/api/conversations/${id}/jobs/${activeJob.id}`, { method: "DELETE" });
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setActiveJob(null);
    setStreamingBuffer("");
  }

  if (loading) return <p className="p-8 text-zinc-500">Loading...</p>;
  if (conversation === null) return <p className="p-8 text-zinc-500">Conversation not found.</p>;

  const sortedParticipants = [...conversation.participants].sort((a, b) => a.turnOrder - b.turnOrder);
  const nextSpeaker = sortedParticipants[conversation.messages.length % sortedParticipants.length];
  const isRunning = activeJob !== null;
  const progress = activeJob ? activeJob.doneTurns / activeJob.totalTurns : 0;

  return (
    <div className="max-w-3xl mx-auto p-8 font-sans">
      <Link href="/conversations" className="text-sm text-zinc-500 hover:text-black mb-4 block">
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
        {conversation.messages.length === 0 && !streamingBuffer ? (
          <p className="text-zinc-400 italic">No messages yet. Generate the first one.</p>
        ) : (
          conversation.messages.map((m) => (
            <div key={m.id} className="text-sm">
              {m.reasoning !== null && (
                <div className="mb-1">
                  <button
                    onClick={() => toggleReasoning(m.id)}
                    className="text-xs text-zinc-400 hover:text-zinc-600 flex items-center gap-1"
                  >
                    💭 {m.characterName}'s thoughts
                    <span>{expandedReasonings.has(m.id) ? "▲" : "▼"}</span>
                  </button>
                  {expandedReasonings.has(m.id) && (
                    <p className="mt-1 px-3 py-2 bg-zinc-50 border border-zinc-200 rounded text-xs text-zinc-500 italic">
                      {m.reasoning}
                    </p>
                  )}
                </div>
              )}
              <span className="font-medium">{m.characterName}:</span>{" "}
              <span className="text-zinc-700">{m.content}</span>
              <span className="text-xs text-zinc-400 ml-2">
                {new Date(m.createdAt).toLocaleTimeString()}
              </span>
            </div>
          ))
        )}
        {isThinking && (
          <div className="text-sm text-zinc-400 italic">
            💭 {nextSpeaker?.name ?? "..."} is thinking…
          </div>
        )}
        {streamingBuffer && (
          <div className="text-sm">
            <span className="font-medium text-zinc-400">
              {nextSpeaker?.name ?? "..."}:
            </span>{" "}
            <span className="text-zinc-500">{streamingBuffer}</span>
            <span className="animate-pulse">▋</span>
          </div>
        )}
      </div>

      {nextSpeaker !== undefined && !isRunning && (
        <p className="text-xs text-zinc-400 mb-2">Next: {nextSpeaker.name}</p>
      )}

      {error !== null && <p className="text-sm text-red-500 mb-2">{error}</p>}

      {!isRunning ? (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={500}
            value={turnsInput}
            onChange={(e) => setTurnsInput(e.target.value)}
            className="w-20 px-2 py-2 border border-zinc-300 rounded-md text-sm text-center"
          />
          <span className="text-sm text-zinc-500">turns</span>
          <button
            onClick={() => void handleRun()}
            className="px-4 py-2 bg-black text-white text-sm rounded-md hover:bg-zinc-800"
          >
            ▶ Run
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 bg-zinc-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-black rounded-full transition-all duration-300"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <span className="text-xs text-zinc-500 whitespace-nowrap">
              {activeJob.doneTurns}/{activeJob.totalTurns}
            </span>
            <button
              onClick={() => void handleStop()}
              className="px-3 py-1 bg-zinc-100 text-zinc-700 text-sm rounded-md hover:bg-zinc-200"
            >
              ■ Stop
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
