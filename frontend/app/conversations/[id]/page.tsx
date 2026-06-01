// frontend/app/conversations/[id]/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Play, Square } from "lucide-react";
import { EmotionDot } from "@/components/ui/emotion-dot";
import { Monogram } from "@/components/ui/monogram";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const PLUTCHIK = ["Joy", "Trust", "Fear", "Surprise", "Sadness", "Disgust", "Anger", "Anticipation"] as const;

// ─── types ────────────────────────────────────────────────────────────────────

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
  turnStrategy: "ORCHESTRATOR" | "ROUND_ROBIN";
  participants: Participant[];
  messages: Message[];
};
type ActiveJob = { id: string; totalTurns: number; doneTurns: number; status: string };

// ─── component ────────────────────────────────────────────────────────────────

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

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

  function toggleReasoning(msgId: string) {
    setExpandedReasonings((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
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
    if (eventSourceRef.current) eventSourceRef.current.close();
    const es = new EventSource(`/api/conversations/${id}/jobs/${jobId}/stream`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      const data = JSON.parse(event.data as string) as {
        type: string; text?: string; doneTurns?: number; totalTurns?: number;
        message?: string; emotion?: string; intensity?: string; subtext?: string;
      };
      if (data.type === "token") {
        setStreamingBuffer((prev) => prev + (data.text ?? ""));
      } else if (data.type === "emotion") {
        setStreamingEmotion({ emotion: data.emotion as string, intensity: data.intensity as string, subtext: data.subtext as string });
      } else if (data.type === "turn_done") {
        const doneTurns = data.doneTurns;
        void loadConversation().then(() => {
          setStreamingBuffer("");
          setStreamingEmotion(null);
          setActiveJob((prev) => prev ? { ...prev, doneTurns: doneTurns ?? prev.doneTurns } : prev);
        });
      } else if (data.type === "thinking") {
        setIsThinking(true);
      } else if (data.type === "thinking_done") {
        setIsThinking(false);
      } else if (data.type === "done") {
        es.close(); eventSourceRef.current = null;
        setIsThinking(false); setActiveJob(null); setStreamingBuffer(""); setStreamingEmotion(null);
        void loadConversation();
      } else if (data.type === "error") {
        es.close(); eventSourceRef.current = null;
        setIsThinking(false); setActiveJob(null); setStreamingBuffer(""); setStreamingEmotion(null);
        setError(data.message ?? "Job failed");
      }
    };

    es.onerror = () => {
      es.close(); eventSourceRef.current = null;
      if (isMountedRef.current) {
        setIsThinking(false); setActiveJob(null); setStreamingBuffer(""); setStreamingEmotion(null);
      }
    };
  }

  useEffect(() => {
    isMountedRef.current = true;
    void loadConversation();
    void checkActiveJob();
    return () => { isMountedRef.current = false; eventSourceRef.current?.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
  }, [conversation?.messages.length, streamingBuffer, isThinking]);

  async function handleRun() {
    const turns = parseInt(turnsInput, 10);
    if (isNaN(turns) || turns < 1 || turns > 500) { setError("Enter a number between 1 and 500"); return; }
    setError(null);
    const res = await fetch(`/api/conversations/${id}/jobs`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ turns }),
    });
    if (!res.ok) { const body = (await res.json()) as { error?: string }; setError(body.error ?? "Failed to start job"); return; }
    const { jobId } = (await res.json()) as { jobId: string };
    setActiveJob({ id: jobId, totalTurns: turns, doneTurns: 0, status: "running" });
    connectToJob(jobId);
  }

  async function handleStop() {
    if (!activeJob) return;
    await fetch(`/api/conversations/${id}/jobs/${activeJob.id}`, { method: "DELETE" });
    eventSourceRef.current?.close(); eventSourceRef.current = null;
    setActiveJob(null); setStreamingBuffer(""); setStreamingEmotion(null);
  }

  // ─── loading / not found ──────────────────────────────────────────────────

  if (loading) return <p className="p-8 text-ink-faint">Loading…</p>;
  if (conversation === null) return <p className="p-8 text-ink-faint">Conversation not found.</p>;

  // ─── derived state ────────────────────────────────────────────────────────

  const sortedParticipants = [...conversation.participants].sort((a, b) => a.turnOrder - b.turnOrder);
  // Next speaker by round-robin order — used during streaming regardless of strategy
  const nextSpeaker = sortedParticipants[conversation.messages.length % sortedParticipants.length];
  const isRunning = activeJob !== null;
  const isActive = !!(streamingBuffer || isThinking);

  const lastEmotionMap: Record<string, { emotion: string; intensity: string }> = {};
  for (const m of conversation.messages) {
    lastEmotionMap[m.characterId] = { emotion: m.emotion, intensity: m.intensity };
  }

  // "Focus" pane: who to highlight and what label to show
  const focusLabel = isActive ? "NOW SPEAKING" : conversation.messages.length > 0 ? "LAST SPOKE" : "ON DECK";
  const focusId = isActive
    ? (nextSpeaker?.characterId)
    : conversation.messages.length > 0
      ? conversation.messages[conversation.messages.length - 1]?.characterId
      : sortedParticipants[0]?.characterId;
  const focusSpeaker = sortedParticipants.find((p) => p.characterId === focusId) ?? sortedParticipants[0];
  const focusEmotion = (isActive ? streamingEmotion : null) ?? (focusSpeaker ? lastEmotionMap[focusSpeaker.characterId] : null);
  const focusEmotionName = focusEmotion?.emotion?.toLowerCase() ?? "";
  const focusIntensity = focusEmotion?.intensity ?? "";
  const showEmotionGrid = focusLabel !== "ON DECK";

  const strategyLabel = conversation.turnStrategy === "ORCHESTRATOR" ? "ORCHESTRATOR" : "ROUND-ROBIN";
  const progressPct = activeJob ? Math.round((activeJob.doneTurns / activeJob.totalTurns) * 100) : 0;

  // ─── screenplay paper helpers ─────────────────────────────────────────────

  const paperInk = "oklch(0.22 0.01 80)";
  const paperInkMuted = "oklch(0.40 0.01 80)";
  const paperInkFaint = "oklch(0.55 0.01 80)";
  const monoFont = "var(--font-mono), monospace";
  const sansFont = "var(--font-sans), system-ui, sans-serif";
  const serifFont = "var(--font-serif), Georgia, serif";

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-background">

      {/* Bouncing-dot keyframes for composing indicator */}
      <style>{`
        @keyframes sdot{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-3px);opacity:1}}
        .sdot{width:6px;height:6px;border-radius:50%;background:var(--accent-oo);animation:sdot 1.2s ease-in-out infinite}
        .sdot:nth-child(2){animation-delay:.15s}.sdot:nth-child(3){animation-delay:.3s}
      `}</style>

      {/* ── Scene nav (3-column: back · title · status) ─────────────────── */}
      <nav
        className="flex-shrink-0 grid items-center gap-4 px-7 py-3.5 border-b border-hair backdrop-blur-[10px]"
        style={{ gridTemplateColumns: "1fr auto 1fr", background: "color-mix(in oklch, var(--surface-1) 85%, transparent)" }}
      >
        {/* Left: back + turn counter */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            aria-label="Back to scenes"
            onClick={() => router.push("/conversations")}
            className="flex items-center justify-center size-8 rounded-lg text-ink-mute hover:text-ink hover:bg-bg-tinted transition-colors duration-[120ms]"
          >
            <ArrowLeft className="size-4" strokeWidth={1.5} />
          </button>
          <span className="t-meta t-meta-bright">SCENE · {conversation.messages.length}T</span>
        </div>

        {/* Center: scene title */}
        <span className="text-[14px] font-medium text-ink truncate max-w-xs text-center">
          {conversation.title}
        </span>

        {/* Right: LIVE when running, strategy badge when idle */}
        <div className="flex items-center gap-2 justify-end">
          {isRunning
            ? <Badge tone="accent" mono dot>LIVE · {activeJob.doneTurns}T</Badge>
            : <Badge tone="neutral" mono>{strategyLabel}</Badge>
          }
        </div>
      </nav>

      {/* ── Stage (left panes · screenplay) ─────────────────────────────── */}
      <main
        className="flex-1 grid gap-6 p-8 overflow-hidden relative"
        style={{ gridTemplateColumns: "300px 1fr" }}
      >
        {/* Background radial wash */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 30%, color-mix(in oklch, var(--accent-oo) 8%, transparent), transparent 50%)," +
              "radial-gradient(circle at 90% 80%, color-mix(in oklch, oklch(0.6 0.18 30) 10%, transparent), transparent 50%)",
          }}
        />

        {/* ── Left panes ─────────────────────────────────────────────────── */}
        <aside className="relative grid gap-4 content-start overflow-y-auto">

          {/* Pane 1: Now Speaking / Last Spoke / On Deck */}
          <div className="bg-surface-1 border border-hair rounded-[var(--r-lg)] p-[18px] shadow-[var(--shadow-inset),var(--shadow-1)]">
            <div className={cn("t-meta mb-2.5", isActive ? "text-accent-deep" : "")}>{focusLabel}</div>
            {focusSpeaker && (
              <div className={cn("flex items-center gap-3", focusLabel === "ON DECK" && "opacity-50")}>
                <Monogram name={focusSpeaker.name} size={48} ring={isActive} />
                <div>
                  <div className="t-h6 m-0">{focusSpeaker.name}</div>
                  {focusEmotionName && (
                    <div className="t-meta mt-0.5">
                      {focusEmotionName.toUpperCase()}{focusIntensity ? ` · ${focusIntensity.toUpperCase()}` : ""}
                    </div>
                  )}
                </div>
              </div>
            )}
            {showEmotionGrid && (
              <div className="grid grid-cols-2 gap-1.5 mt-3">
                {PLUTCHIK.map((e) => {
                  const active = e.toLowerCase() === focusEmotionName;
                  return (
                    <div key={e} className={cn("flex items-center gap-2", active ? "opacity-100" : "opacity-35")}>
                      <span
                        className="size-2 rounded-full shrink-0"
                        style={{
                          background: active ? "var(--accent-oo)" : "var(--hair-strong)",
                          boxShadow: active ? "0 0 0 3px color-mix(in oklch, var(--accent-oo) 20%, transparent)" : "none",
                        }}
                      />
                      <span className={cn("t-meta", active ? "text-ink" : "text-ink-faint")}>{e}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Pane 2: Scene context */}
          <div className="bg-surface-1 border border-hair rounded-[var(--r-lg)] p-[18px] shadow-[var(--shadow-inset),var(--shadow-1)]">
            <div className="t-meta mb-2">SCENE</div>
            <p className="t-body-s italic text-ink-dim my-2 leading-relaxed">
              {conversation.context || "No scene context provided."}
            </p>
            <div className="flex gap-3.5 mt-3">
              <span className="t-meta">TURN · {conversation.messages.length}</span>
              {isRunning && <span className="t-meta text-accent-deep">STREAMING · SSE</span>}
            </div>
          </div>

          {/* Pane 3: Cast State */}
          <div className="bg-surface-1 border border-hair rounded-[var(--r-lg)] p-[18px] shadow-[var(--shadow-inset),var(--shadow-1)]">
            <div className="t-meta mb-1">CAST STATE</div>
            {sortedParticipants.map((p, i) => {
              const em = lastEmotionMap[p.characterId];
              return (
                <div
                  key={p.characterId}
                  className={cn("flex items-center gap-2.5 py-2.5", i > 0 && "border-t border-dashed border-hair-strong")}
                >
                  <Monogram name={p.name} size={28} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-ink truncate">{p.name}</div>
                    <div className="t-meta mt-0.5">
                      {em ? `${em.emotion.toUpperCase()} · ${em.intensity}` : <span className="text-ink-faint">—</span>}
                    </div>
                  </div>
                  <EmotionDot
                    emotion={em?.emotion ?? ""}
                    intensity={(em?.intensity ?? "low") as "low" | "medium" | "high"}
                    subtext={em ? `${em.emotion} · ${em.intensity}` : ""}
                  />
                </div>
              );
            })}
          </div>
        </aside>

        {/* ── Screenplay + controls bar ───────────────────────────────────── */}
        <section className="relative grid gap-4 min-h-0" style={{ gridTemplateRows: "1fr auto" }}>

          {/* Screenplay paper
              overflow-x-hidden keeps the box shadow intact; overflow-y-auto scrolls.
              NO fontFamily here — each element sets its own font to avoid inheritance bugs. */}
          <div
            className="rounded-[var(--r-xl)] overflow-x-hidden overflow-y-auto"
            style={{
              background: "linear-gradient(180deg, oklch(0.96 0.008 80) 0%, oklch(0.94 0.012 78) 100%)",
              padding: "48px 64px",
              boxShadow: "var(--shadow-3), inset 0 0 0 1px rgba(255,255,255,0.4), inset 0 0 80px color-mix(in oklch, oklch(0.6 0.06 60) 8%, transparent)",
            }}
          >
            {/* Inner wrapper stretches to at least the paper's visible height so that the
                absolutely-positioned margin line always reaches the container bottom,
                even when content is short. */}
            <div className="relative" style={{ minHeight: "100%" }}>

              {/* Red margin line — left:26px puts it at 64+26=90px from the paper edge */}
              <div
                className="absolute top-0 bottom-0 w-px pointer-events-none"
                style={{ left: 26, background: "color-mix(in oklch, oklch(0.6 0.2 25) 30%, transparent)" }}
              />

              {/* Empty state */}
              {conversation.messages.length === 0 && !streamingBuffer && !isThinking && (
                <p className="text-sm italic text-center" style={{ color: paperInkFaint, fontFamily: serifFont }}>
                  The stage is set. Run the scene to begin.
                </p>
              )}

              {/* Committed messages */}
              {conversation.messages.map((m) => (
                <div key={m.id} className="mb-6">

                  {/* Reasoning disclosure — centered to match the screenplay column */}
                  {m.reasoning !== null && (
                    <div className="mb-2 text-center">
                      <button
                        onClick={() => toggleReasoning(m.id)}
                        className="inline-flex items-center gap-1.5 text-[10.5px] hover:opacity-80 transition-opacity"
                        style={{ color: paperInkFaint, fontFamily: monoFont }}
                      >
                        💭 {expandedReasonings.has(m.id) ? "hide thoughts" : "show thoughts"}
                      </button>
                      {expandedReasonings.has(m.id) && (
                        <p
                          className="mt-1.5 text-[12.5px] italic leading-relaxed max-w-[50ch] mx-auto text-left"
                          style={{ color: "oklch(0.45 0.01 80)", fontFamily: serifFont }}
                        >
                          {m.reasoning}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Screenplay line: CHARACTER — EMOTION / dialogue */}
                  <div style={{ maxWidth: "50ch", marginLeft: "auto", marginRight: "auto" }}>
                    <div className="flex items-baseline gap-3 justify-center mb-1.5">
                      <span style={{ fontFamily: monoFont, fontSize: 13, letterSpacing: "0.08em", fontWeight: 500, color: paperInk }}>
                        {m.characterName.toUpperCase()}
                      </span>
                      {m.emotion && (
                        <span style={{ color: "var(--accent-deep)", fontSize: 10.5, fontFamily: monoFont }}>
                          — {m.emotion.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <p className="text-center leading-relaxed m-0" style={{ fontFamily: sansFont, fontSize: 16, color: paperInk }}>
                      {m.content}
                    </p>
                  </div>
                </div>
              ))}

              {/* Composing indicator */}
              {isThinking && (
                <div className="flex items-center justify-center gap-2.5 mt-4" style={{ opacity: 0.65 }}>
                  <span style={{ fontFamily: monoFont, fontSize: 11, letterSpacing: "0.06em", color: paperInkFaint }}>
                    {nextSpeaker?.name.toUpperCase() ?? "..."} IS COMPOSING
                  </span>
                  <span className="inline-flex gap-1">
                    <span className="sdot" /><span className="sdot" /><span className="sdot" />
                  </span>
                </div>
              )}

              {/* Streaming line (in-progress, dimmed) */}
              {streamingBuffer && (
                <div style={{ maxWidth: "50ch", marginLeft: "auto", marginRight: "auto" }}>
                  <div className="flex items-baseline gap-3 justify-center mb-1.5">
                    <span style={{ fontFamily: monoFont, fontSize: 13, letterSpacing: "0.08em", fontWeight: 500, color: paperInkMuted }}>
                      {(nextSpeaker?.name ?? "...").toUpperCase()}
                    </span>
                    {streamingEmotion && (
                      <span style={{ color: "var(--accent-deep)", fontSize: 10.5, fontFamily: monoFont }}>
                        — {streamingEmotion.emotion.toUpperCase()}
                      </span>
                    )}
                  </div>
                  <p className="text-center leading-relaxed m-0" style={{ fontFamily: sansFont, fontSize: 16, color: paperInkMuted }}>
                    {streamingBuffer}<span className="animate-pulse">▋</span>
                  </p>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Controls bar — always populated: Run/turns when idle, progress/Stop when running */}
          <div className="flex items-center gap-3 px-[18px] py-3 bg-surface-1 border border-hair rounded-[var(--r-md)] shadow-[var(--shadow-inset),var(--shadow-1)]">
            {isRunning ? (
              <>
                <div
                  className="flex-1 h-1 rounded-full overflow-hidden bg-hair-strong"
                  role="progressbar"
                  aria-valuenow={progressPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Scene progress: ${activeJob.doneTurns} of ${activeJob.totalTurns} turns`}
                >
                  <div
                    className="h-full rounded-full transition-all duration-300 bg-accent-oo"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <span className="t-mono text-xs text-ink-mute whitespace-nowrap">
                  {activeJob.doneTurns}/{activeJob.totalTurns}
                </span>
                <button
                  onClick={() => void handleStop()}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12.5px] font-medium bg-surface-sunk text-ink-dim border border-hair hover:border-hair-strong transition-colors duration-[120ms]"
                >
                  <Square className="size-3.5" strokeWidth={1.5} />
                  Stop
                </button>
              </>
            ) : (
              <>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={turnsInput}
                  onChange={(e) => setTurnsInput(e.target.value)}
                  className="w-16 h-8 px-2 rounded-lg text-sm text-center border border-hair-strong bg-surface-2 text-ink"
                />
                <span className="text-[12.5px] text-ink-mute">turns</span>
                <button
                  onClick={() => void handleRun()}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12.5px] font-medium bg-ink-panel text-on-ink transition-opacity hover:opacity-80"
                >
                  <Play className="size-3.5" strokeWidth={1.5} />
                  Run
                </button>
                {error !== null && (
                  <span className="t-body-s text-signal-flag ml-auto">{error}</span>
                )}
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
