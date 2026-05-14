"use client";

import type { AgentSessionSummary } from "@/lib/agent/history";

interface SessionSidebarProps {
  sessions: AgentSessionSummary[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onNew: () => void;
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  onSelect,
  onNew,
}: SessionSidebarProps) {
  return (
    <aside className="w-56 shrink-0 border-r border-border flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <button
          onClick={onNew}
          className="w-full text-sm font-medium px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          + New session
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {sessions.length === 0 && (
          <p className="text-xs text-muted-foreground px-2 py-4 text-center">
            No sessions yet
          </p>
        )}
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={`w-full text-left text-sm px-3 py-2 rounded-md truncate transition-colors ${
              s.id === activeSessionId
                ? "bg-accent text-accent-foreground"
                : "hover:bg-accent/50 text-foreground"
            }`}
          >
            {s.title ?? "Untitled session"}
          </button>
        ))}
      </nav>
    </aside>
  );
}
