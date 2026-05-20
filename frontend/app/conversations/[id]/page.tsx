// frontend/app/conversations/[id]/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { EmotionDot } from "@/components/ui/emotion-dot";

type Participant = { characterId: string; name: string; turnOrder: number };
type Message = {
  id: string;
  characterId: string;
  characterName: string;
  content: string;
  reasoning: string | null;
  emotion: string;
  intensity: string;
  subtext: string;
  createdAt: string;
};

type StreamingEmotion = { emotion: string; intensity: string; subtext: string };

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
  const [streamingEmotion, setStreamingEmotion] = useState<StreamingEmotion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [expandedReasonings, setExpandedReasonings] = useState<Set<string>>(new Set());

  const eventSourceRef = useRef<EventSource | null>(null);
  const isMountedRef = useRef(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
        emotion?: string;
        intensity?: string;
        subtext?: string;
      };

      if (data.type === "token") {
        setStreamingBuffer((prev) => prev + (data.text ?? ""));
      } else if (data.type === "emotion") {
        setStreamingEmotion({
          emotion: data.emotion as string,
          intensity: data.intensity as string,
          subtext: data.subtext as string,
        });
      } else if (data.type === "turn_done") {
        const doneTurns = data.doneTurns;
        void loadConversation().then(() => {
          setStreamingBuffer("");
          setStreamingEmotion(null);
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
        setStreamingEmotion(null);
        void loadConversation();
      } else if (data.type === "error") {
        es.close();
        eventSourceRef.current = null;
        setIsThinking(false);
        setActiveJob(null);
        setStreamingBuffer("");
        setStreamingEmotion(null);
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
        setStreamingEmotion(null);
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
  }, [conversation?.messages.length, streamingBuffer, isThinking]);

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
    setStreamingEmotion(null);
  }

  if (loading) return <p className="p-8 text-zinc-500">Loading...</p>;
  if (conversation === null) return <p className="p-8 text-zinc-500">Conversation not found.</p>;

  const sortedParticipants = [...conversation.participants].sort((a, b) => a.turnOrder - b.turnOrder);
  const nextSpeaker = sortedParticipants[conversation.messages.length % sortedParticipants.length];
  const isRunning = activeJob !== null;
  const progress = activeJob ? activeJob.doneTurns / activeJob.totalTurns : 0;

  return (
    <div className="h-screen overflow-hidden flex flex-col w-full max-w-5xl mx-auto font-sans">

      {/* Header — fixed top */}
      <header
        className="flex-shrink-0 px-8 pt-5 pb-4"
        style={{ borderBottom: "1px solid var(--hair)" }}
      >
        <Link href="/conversations" className="text-xs block mb-3" style={{ color: "var(--ink-mute)" }}>
          ← Back to conversations
        </Link>
        <div className="flex items-center gap-2 mb-0.5">
          <h1 className="text-2xl font-semibold" style={{ color: "var(--ink)" }}>
            {conversation.title}
          </h1>
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={
              conversation.turnStrategy === "ORCHESTRATOR"
                ? { background: "var(--accent-tint)", color: "var(--accent-deep)" }
                : { background: "var(--surface-sunk)", color: "var(--ink-mute)" }
            }
          >
            {conversation.turnStrategy === "ORCHESTRATOR" ? "Orchestrator" : "Round-robin"}
          </span>
        </div>
        <p className="text-sm" style={{ color: "var(--ink-mute)" }}>
          {sortedParticipants.map((p) => p.name).join(", ")}
        </p>
      </header>

      {/* Body — sidebar + scrollable messages */}
      <div className="flex flex-1 min-h-0">

        {/* Cast state sidebar */}
        {conversation.participants.length > 0 && (
          <aside
            className="w-48 flex-shrink-0 hidden sm:flex flex-col overflow-y-auto px-5 py-5"
            style={{ borderRight: "1px solid var(--hair)" }}
          >
            <p className="t-meta mb-3">Cast State</p>
            {conversation.participants.map((p) => {
              const lastMsg = [...conversation.messages]
                .reverse()
                .find((m) => m.characterId === p.characterId);
              return (
                <div
                  key={p.characterId}
                  className="flex items-center gap-2 py-2"
                  style={{ borderTop: "1px solid var(--hair)" }}
                >
                  <span
                    className="text-xs font-medium flex-1 truncate"
                    style={{ color: "var(--ink)" }}
                  >
                    {p.name}
                  </span>
                  {lastMsg ? (
                    <EmotionDot
                      emotion={lastMsg.emotion}
                      intensity={lastMsg.intensity as "low" | "medium" | "high"}
                      subtext={`${lastMsg.emotion} · ${lastMsg.intensity}${lastMsg.subtext ? " · " + lastMsg.subtext : ""}`}
                    />
                  ) : (
                    <span
                      className="size-2 rounded-full"
                      style={{ background: "var(--hair-strong)" }}
                    />
                  )}
                </div>
              );
            })}
          </aside>
        )}

        {/* Scrollable messages area */}
        <div className="flex-1 min-w-0 overflow-y-auto px-8 py-5 flex flex-col gap-4">
          {conversation.messages.length === 0 && !streamingBuffer ? (
            <p className="text-sm italic" style={{ color: "var(--ink-faint)" }}>
              No messages yet. Generate the first one.
            </p>
          ) : (
            conversation.messages.map((m) => (
              <div key={m.id} className="text-sm">
                {m.reasoning !== null && (
                  <div className="mb-1.5">
                    <button
                      onClick={() => toggleReasoning(m.id)}
                      className="flex items-center gap-1 text-xs"
                      style={{ color: "var(--ink-faint)" }}
                    >
                      💭 {m.characterName}&apos;s thoughts
                      <span>{expandedReasonings.has(m.id) ? "▲" : "▼"}</span>
                    </button>
                    {expandedReasonings.has(m.id) && (
                      <p
                        className="mt-1 px-3 py-2 rounded-lg text-xs italic"
                        style={{
                          background: "var(--surface-sunk)",
                          border: "1px solid var(--hair)",
                          color: "var(--ink-mute)",
                        }}
                      >
                        {m.reasoning}
                      </p>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-medium" style={{ color: "var(--ink)" }}>
                    {m.characterName}
                  </span>
                  <EmotionDot
                    emotion={m.emotion}
                    intensity={m.intensity as "low" | "medium" | "high"}
                    subtext={m.subtext}
                  />
                  <span className="text-xs" style={{ color: "var(--ink-faint)" }}>
                    {new Date(m.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                <span style={{ color: "var(--ink-dim)" }}>{m.content}</span>
              </div>
            ))
          )}
          {isThinking && (
            <div className="text-sm italic" style={{ color: "var(--ink-faint)" }}>
              💭 {nextSpeaker?.name ?? "..."} is thinking…
            </div>
          )}
          {streamingBuffer && (
            <div className="text-sm">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-medium" style={{ color: "var(--ink-mute)" }}>
                  {nextSpeaker?.name ?? "..."}
                </span>
                {streamingEmotion && (
                  <EmotionDot
                    emotion={streamingEmotion.emotion}
                    intensity={streamingEmotion.intensity as "low" | "medium" | "high"}
                    subtext={streamingEmotion.subtext}
                  />
                )}
              </div>
              <span style={{ color: "var(--ink-mute)" }}>{streamingBuffer}</span>
              <span className="animate-pulse">▋</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Footer — fixed controls */}
      <footer
        className="flex-shrink-0 px-8 py-4 flex flex-col gap-2"
        style={{ borderTop: "1px solid var(--hair)" }}
      >
        {nextSpeaker !== undefined && !isRunning && (
          <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
            Next: {nextSpeaker.name}
          </p>
        )}
        {error !== null && (
          <p className="text-sm" style={{ color: "var(--signal-flag)" }}>
            {error}
          </p>
        )}
        {!isRunning ? (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={500}
              value={turnsInput}
              onChange={(e) => setTurnsInput(e.target.value)}
              className="w-20 px-2 py-2 rounded-lg text-sm text-center"
              style={{
                border: "1px solid var(--hair-strong)",
                background: "var(--surface-1)",
                color: "var(--ink)",
              }}
            />
            <span className="text-sm" style={{ color: "var(--ink-mute)" }}>
              turns
            </span>
            <button
              onClick={() => void handleRun()}
              className="px-4 py-2 text-sm rounded-lg transition-opacity hover:opacity-80"
              style={{
                background: "var(--ink-panel)",
                color: "var(--on-ink)",
              }}
            >
              ▶ Run
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div
              className="flex-1 h-1.5 rounded-full overflow-hidden"
              style={{ background: "var(--hair-strong)" }}
            >
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.round(progress * 100)}%`,
                  background: "var(--accent-oo)",
                }}
              />
            </div>
            <span className="text-xs whitespace-nowrap t-mono" style={{ color: "var(--ink-mute)" }}>
              {activeJob.doneTurns}/{activeJob.totalTurns}
            </span>
            <button
              onClick={() => void handleStop()}
              className="px-3 py-1 text-sm rounded-lg transition-opacity hover:opacity-80"
              style={{
                background: "var(--surface-sunk)",
                color: "var(--ink-dim)",
                border: "1px solid var(--hair)",
              }}
            >
              ■ Stop
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}
