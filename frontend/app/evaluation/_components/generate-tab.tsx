"use client";
import { useEffect, useState } from "react";

interface ConvMessage {
  turn?: number;
  character_id?: string;
  character_name?: string;
  emotion?: string;
  intensity?: string;
  content?: string;
  subtext?: string;
  reasoning?: string;
}

interface Conversation {
  run_index?: number;
  scenario_id?: string;
  scenario_title?: string;
  scenario_context?: string;
  initial_prompt?: string;
  characters?: Array<{ id?: string; name?: string; archetype?: string }>;
  messages?: ConvMessage[];
  [key: string]: unknown;
}

type DatasetRef = { characters: Array<{ id?: string; name?: string }> };

type Segment =
  | { type: "action"; text: string }
  | { type: "dialogue"; text: string };

function parseContent(text: string): Segment[] {
  const parts: Segment[] = [];
  const regex = /\*([^*]+)\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim();
      if (before) parts.push({ type: "dialogue", text: before });
    }
    parts.push({ type: "action", text: match[1]! });
    lastIndex = match.index + match[0].length;
  }
  const after = text.slice(lastIndex).trim();
  if (after) parts.push({ type: "dialogue", text: after });
  return parts;
}

export function GenerateTab({ dataset, evalName }: { dataset: string; evalName: string }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [realNameMap, setRealNameMap] = useState<Map<string, string>>(new Map());
  const [selected, setSelected] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(
        `/api/evaluation/${encodeURIComponent(dataset)}/${encodeURIComponent(evalName)}/conversations`
      ).then((r) => r.json()),
      fetch("/api/evaluation/dataset-reference")
        .then((r) => r.json())
        .catch(() => ({ characters: [] })),
    ])
      .then(([convData, refData]: [unknown, unknown]) => {
        const convs = Array.isArray(convData) ? (convData as Conversation[]) : [];
        setConversations(convs);
        if (convs.length > 0) setSelected(0);

        const ref = (refData as DatasetRef | null)?.characters ?? [];
        const map = new Map<string, string>();
        for (const ch of ref) {
          if (ch.id && ch.name) map.set(ch.id, ch.name);
        }
        setRealNameMap(map);
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [dataset, evalName]);

  const filtered = conversations.filter((c) => {
    const q = filter.toLowerCase();
    const title = (c.scenario_title ?? "").toLowerCase();
    const chars = (c.characters ?? [])
      .map((ch) => ch.name ?? "")
      .join(" ")
      .toLowerCase();
    return title.includes(q) || chars.includes(q);
  });

  const selectedConv =
    selected !== null ? conversations[selected] ?? null : null;

  if (error) return <p className="text-red-500 text-[13px]">{error}</p>;
  if (loading)
    return <p className="text-muted-foreground text-[13px]">Loading…</p>;

  return (
    <div className="flex gap-4 h-[calc(100vh-280px)] min-h-[400px]">
      {/* Left panel: conversation list */}
      <div className="w-64 flex-shrink-0 flex flex-col border rounded-lg overflow-hidden">
        <div className="p-2 border-b">
          <input
            type="text"
            placeholder="Search…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full text-[12px] border rounded px-2 py-1 bg-background"
          />
        </div>
        <div className="overflow-y-auto flex-1">
          {filtered.map((c, i) => {
            const originalIndex = conversations.indexOf(c);
            const charNames = (c.characters ?? [])
              .map((ch) => ch.name ?? "")
              .filter(Boolean)
              .join(", ");
            return (
              <button
                key={originalIndex}
                onClick={() => setSelected(originalIndex)}
                className={`w-full text-left px-3 py-2 text-[12px] hover:bg-muted/40 border-b last:border-b-0 ${
                  selected === originalIndex ? "bg-muted/60" : ""
                }`}
              >
                <p className="font-medium truncate">
                  {c.scenario_title ?? c.scenario_id ?? `Conv ${i + 1}`}
                </p>
                {charNames && (
                  <p className="text-muted-foreground truncate">{charNames}</p>
                )}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="text-muted-foreground text-[12px] px-3 py-4">
              No matches
            </p>
          )}
        </div>
      </div>

      {/* Right panel: transcript */}
      <div className="flex-1 border rounded-lg overflow-y-auto p-4">
        {selectedConv ? (
          <ScreenplayView conversation={selectedConv} realNameMap={realNameMap} />
        ) : (
          <p className="text-muted-foreground text-[13px]">
            Select a conversation
          </p>
        )}
      </div>
    </div>
  );
}

function ScreenplayView({
  conversation,
  realNameMap,
}: {
  conversation: Conversation;
  realNameMap: Map<string, string>;
}) {
  const [contextExpanded, setContextExpanded] = useState(false);
  const [expandedMessages, setExpandedMessages] = useState<Set<number>>(new Set());

  const messages = conversation.messages ?? [];
  const hasContext = !!(conversation.scenario_context || conversation.initial_prompt);

  return (
    <div className="space-y-3">
      {conversation.scenario_title && (
        <h3 className="font-medium text-[14px] mb-4">
          {conversation.scenario_title}
        </h3>
      )}
      {hasContext && (
        <div className="border rounded-lg px-3 py-2 mb-4 bg-muted/20">
          <button
            onClick={() => setContextExpanded((v) => !v)}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            {contextExpanded ? "▼ Context" : "▶ Context"}
          </button>
          {contextExpanded && (
            <div className="mt-2">
              {conversation.scenario_context && (
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  {conversation.scenario_context}
                </p>
              )}
              {conversation.initial_prompt && (
                <>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground mt-2 mb-0.5">
                    Initial prompt
                  </p>
                  <p className="text-[12px] italic text-muted-foreground">
                    {conversation.initial_prompt}
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}
      {messages.map((msg, i) => {
        const alias = msg.character_name ?? "UNKNOWN";
        const realName =
          msg.character_id ? realNameMap.get(msg.character_id) : undefined;
        const displayName =
          realName && realName.toUpperCase() !== alias.toUpperCase()
            ? `${realName.toUpperCase()} (${alias})`
            : alias.toUpperCase();

        const segments =
          msg.content ? parseContent(msg.content) : [];

        const hasInternals = !!(msg.subtext || msg.reasoning);
        const internalsExpanded = expandedMessages.has(i);

        return (
          <div key={i} className="my-4">
            <div className="flex items-baseline gap-2 mb-1">
              <span className="font-mono text-[11px] font-semibold tracking-[0.05em] text-ink uppercase">
                {displayName}
              </span>
              {msg.emotion && (
                <span className="text-[11px] text-muted-foreground tracking-wide uppercase">
                  — {msg.emotion}
                  {msg.intensity ? ` · ${msg.intensity}` : ""}
                </span>
              )}
            </div>
            {segments.map((seg, j) =>
              seg.type === "action" ? (
                <p key={j} className="text-[12px] italic text-muted-foreground my-0.5">
                  ({seg.text})
                </p>
              ) : (
                <p key={j} className="text-[13px] leading-relaxed">
                  {seg.text}
                </p>
              )
            )}
            {hasInternals && (
              <>
                <button
                  onClick={() =>
                    setExpandedMessages((prev) => {
                      const next = new Set(prev);
                      next.has(i) ? next.delete(i) : next.add(i);
                      return next;
                    })
                  }
                  className="text-[11px] text-muted-foreground hover:text-foreground mt-1 block"
                >
                  {internalsExpanded ? "▾ reasoning & subtext" : "▸ reasoning & subtext"}
                </button>
                {internalsExpanded && (
                  <div className="pl-2 border-l border-border/40 mt-1.5 space-y-1">
                    {msg.subtext && (
                      <p className="text-[12px] italic text-muted-foreground">
                        💭 {msg.subtext}
                      </p>
                    )}
                    {msg.reasoning && (
                      <>
                        <p className="text-[11px] text-muted-foreground uppercase tracking-wide mt-1.5">
                          reasoning:
                        </p>
                        <p className="text-[12px] text-muted-foreground leading-relaxed">
                          {msg.reasoning}
                        </p>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
      {messages.length === 0 && (
        <p className="text-muted-foreground text-[13px]">No messages found.</p>
      )}
    </div>
  );
}
