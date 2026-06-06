"use client";

import { useState } from "react";
import { Trash2, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentSessionSummary } from "@/lib/agent/history";

interface SessionSidebarProps {
  sessions: AgentSessionSummary[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onNew: () => void;
  onDelete: (sessionId: string) => void;
}

function formatSessionDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "TODAY";
  if (diffDays === 1) return "YESTERDAY";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  onSelect,
  onNew,
  onDelete,
}: SessionSidebarProps) {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  return (
    <aside className="w-56 shrink-0 border-r border-hair flex flex-col h-full bg-bg">
      <div className="p-3 border-b border-hair">
        <Button onClick={onNew} className="w-full" size="sm">
          + New session
        </Button>
      </div>
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5 scrollbar-paper">
        {sessions.length === 0 && (
          <p className="t-meta text-ink-mute px-2 py-4 text-center">No sessions yet</p>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`group relative flex items-center rounded-lg transition-colors duration-[120ms] ${
              s.id === activeSessionId
                ? "bg-bg-tinted text-ink"
                : "text-ink-dim hover:text-ink hover:bg-bg-tinted"
            }`}
          >
            <button
              onClick={() => onSelect(s.id)}
              className="flex-1 text-left px-3 py-2 min-w-0"
            >
              <span className="block text-sm truncate font-medium pr-5">
                {s.title ?? "Untitled session"}
              </span>
              <span className="t-meta text-ink-mute mt-0.5 block">
                {formatSessionDate(s.createdAt)}
              </span>
            </button>
            {pendingDelete === s.id ? (
              <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                <button
                  onClick={(e) => { e.stopPropagation(); setPendingDelete(null); }}
                  className="p-1 rounded text-ink-mute hover:text-ink transition-colors duration-[120ms]"
                  aria-label="Cancel"
                >
                  <X size={13} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setPendingDelete(null); onDelete(s.id); }}
                  className="p-1 rounded text-signal-flag hover:text-signal-flag/80 transition-colors duration-[120ms]"
                  aria-label="Confirm delete"
                >
                  <Check size={13} />
                </button>
              </div>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); setPendingDelete(s.id); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover:opacity-100 text-ink-mute hover:text-signal-flag transition-opacity duration-[120ms]"
                aria-label="Delete session"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
      </nav>
    </aside>
  );
}
