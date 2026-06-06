"use client";

import { useReducer, useCallback, useRef, useEffect } from "react";
import { SessionSidebar } from "./session-sidebar";
import { MessageThread, type ChatMessage, type MessageBlock } from "./message-thread";
import { ChatInput } from "./chat-input";
import { AppNav } from "@/components/app-shell/AppNav";
import type { AgentSessionSummary } from "@/lib/agent/history";
import type { StreamChunk } from "@/lib/agent/stream";
import type { Attachment } from "@/lib/agent/attachment";

type ChatState = {
  messages: ChatMessage[];
  sessionId: string | null;
  isStreaming: boolean;
  sessions: AgentSessionSummary[];
};

type ChatAction =
  | { type: "SEND"; text: string; attachmentFilename?: string }
  | { type: "SESSION_CREATED"; sessionId: string }
  | { type: "TEXT_DELTA"; text: string; sessionId: string | null }
  | { type: "TOOL_START"; tool: string; input: unknown; sessionId: string | null }
  | { type: "TOOL_RESULT"; tool: string; result: unknown; sessionId: string | null }
  | { type: "DONE"; sessionId: string }
  | { type: "SESSION_TITLED"; sessionId: string; title: string }
  | { type: "ERROR"; message: string; sessionId: string | null }
  | { type: "RETRY" }
  | { type: "DELETE_SESSION"; sessionId: string }
  | { type: "NEW_SESSION" }
  | { type: "LOAD_SESSION"; sessionId: string; messages: ChatMessage[] };

function uid() {
  return Math.random().toString(36).slice(2);
}

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SESSION_CREATED": {
      // Add the session to the sidebar immediately so it's visible during streaming.
      const alreadyListed = state.sessions.some((s) => s.id === action.sessionId);
      const sessions = alreadyListed
        ? state.sessions
        : [{ id: action.sessionId, title: null, createdAt: new Date().toISOString() }, ...state.sessions];
      return { ...state, sessionId: action.sessionId, sessions };
    }
    case "SEND": {
      const blocks: MessageBlock[] = [{ type: "text", content: action.text }];
      if (action.attachmentFilename) {
        blocks.push({ type: "attachment", filename: action.attachmentFilename });
      }
      const userMsg: ChatMessage = { id: uid(), role: "user", blocks };
      const assistantMsg: ChatMessage = { id: uid(), role: "assistant", blocks: [] };
      return {
        ...state,
        isStreaming: true,
        messages: [...state.messages, userMsg, assistantMsg],
      };
    }
    case "TEXT_DELTA": {
      if (action.sessionId !== state.sessionId) return state;
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== "assistant") return state;
      const blocks = [...last.blocks];
      const tail = blocks[blocks.length - 1];
      if (tail?.type === "text") {
        blocks[blocks.length - 1] = { type: "text", content: tail.content + action.text };
      } else {
        blocks.push({ type: "text", content: action.text });
      }
      msgs[msgs.length - 1] = { ...last, blocks };
      return { ...state, messages: msgs };
    }
    case "TOOL_START": {
      if (action.sessionId !== state.sessionId) return state;
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== "assistant") return state;
      const newBlock: MessageBlock = {
        type: "tool_call",
        tool: action.tool,
        input: action.input,
      };
      msgs[msgs.length - 1] = { ...last, blocks: [...last.blocks, newBlock] };
      return { ...state, messages: msgs };
    }
    case "TOOL_RESULT": {
      if (action.sessionId !== state.sessionId) return state;
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== "assistant") return state;
      const blocks = [...last.blocks];
      for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i];
        if (b?.type === "tool_call" && b.tool === action.tool && b.result === undefined) {
          blocks[i] = { ...b, result: action.result };
          break;
        }
      }
      msgs[msgs.length - 1] = { ...last, blocks };
      return { ...state, messages: msgs };
    }
    case "DONE": {
      const exists = state.sessions.some((s) => s.id === action.sessionId);
      const sessions = exists
        ? state.sessions
        : [
            {
              id: action.sessionId,
              title: null,
              createdAt: new Date().toISOString(),
            },
            ...state.sessions,
          ];
      // Only flip isStreaming for the session the user is currently viewing.
      const isCurrentSession = state.sessionId === action.sessionId;
      return {
        ...state,
        isStreaming: isCurrentSession ? false : state.isStreaming,
        sessionId: isCurrentSession ? action.sessionId : state.sessionId,
        sessions,
      };
    }
    case "SESSION_TITLED": {
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.id === action.sessionId ? { ...s, title: action.title } : s
        ),
      };
    }
    case "ERROR": {
      // Drop errors from background streams — don't corrupt a different session's messages.
      if (action.sessionId !== null && state.sessionId !== action.sessionId) return state;
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant") {
        msgs[msgs.length - 1] = {
          ...last,
          blocks: [...last.blocks, { type: "error", message: action.message }],
        };
      }
      return { ...state, isStreaming: false, messages: msgs };
    }
    case "RETRY": {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant") {
        msgs[msgs.length - 1] = { ...last, blocks: [] };
      }
      return { ...state, isStreaming: true, messages: msgs };
    }
    case "DELETE_SESSION": {
      const sessions = state.sessions.filter((s) => s.id !== action.sessionId);
      const isActive = state.sessionId === action.sessionId;
      return {
        ...state,
        sessions,
        ...(isActive ? { messages: [], sessionId: null, isStreaming: false } : {}),
      };
    }
    case "NEW_SESSION": {
      return { ...state, messages: [], sessionId: null, isStreaming: false };
    }
    case "LOAD_SESSION": {
      return { ...state, messages: action.messages, sessionId: action.sessionId, isStreaming: false };
    }
  }
}

const SUGGESTIONS = [
  "List my characters",
  "Create a character",
  "Start a new scene",
  "Research a character",
];

interface ChatViewProps {
  initialSessions: AgentSessionSummary[];
}

export function ChatView({ initialSessions }: ChatViewProps) {
  const [state, dispatch] = useReducer(chatReducer, {
    messages: [],
    sessionId: null,
    isStreaming: false,
    sessions: initialSessions,
  });

  const abortRef = useRef<AbortController | null>(null);
  const lastSentRef = useRef<{ text: string; attachment?: Attachment } | null>(null);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleSend = useCallback(
    async (text: string, attachment?: Attachment, isRetry = false) => {
      if (isRetry) {
        dispatch({ type: "RETRY" });
      } else {
        lastSentRef.current = { text, ...(attachment !== undefined ? { attachment } : {}) };
        dispatch({ type: "SEND", text, ...(attachment ? { attachmentFilename: attachment.filename } : {}) });
      }

      const controller = new AbortController();
      abortRef.current = controller;

      // Track which session this stream belongs to so the reducer can gate
      // message mutations when the user switches to a different session mid-stream.
      let streamingSessionId: string | null = state.sessionId;

      try {
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            sessionId: state.sessionId ?? undefined,
            ...(attachment ? { attachments: [attachment] } : {}),
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          dispatch({ type: "ERROR", message: `HTTP ${response.status}`, sessionId: streamingSessionId });
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let completedSessionId: string | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const chunk = JSON.parse(line.slice(6)) as StreamChunk;
              if (chunk.type === "session_created") {
                streamingSessionId = chunk.sessionId;
                dispatch({ type: "SESSION_CREATED", sessionId: chunk.sessionId });
              } else if (chunk.type === "text_delta")
                dispatch({ type: "TEXT_DELTA", text: chunk.text, sessionId: streamingSessionId });
              else if (chunk.type === "tool_start")
                dispatch({ type: "TOOL_START", tool: chunk.tool, input: chunk.input, sessionId: streamingSessionId });
              else if (chunk.type === "tool_result")
                dispatch({ type: "TOOL_RESULT", tool: chunk.tool, result: chunk.result, sessionId: streamingSessionId });
              else if (chunk.type === "done") {
                completedSessionId = chunk.sessionId;
                dispatch({ type: "DONE", sessionId: chunk.sessionId });
              } else if (chunk.type === "session_titled")
                dispatch({ type: "SESSION_TITLED", sessionId: chunk.sessionId, title: chunk.title });
              else if (chunk.type === "error")
                dispatch({ type: "ERROR", message: chunk.message, sessionId: streamingSessionId });
            } catch {
              // malformed chunk — skip
            }
          }
        }

        // Stream closed. By now autoTitle has completed server-side and the
        // title is in the DB. Fetch the sessions list to pick it up reliably
        // (handles the case where session_titled never arrived client-side).
        if (completedSessionId) {
          const r = await fetch("/api/agent-sessions");
          if (r.ok) {
            const sessions = (await r.json()) as AgentSessionSummary[];
            const updated = sessions.find((s) => s.id === completedSessionId);
            if (updated?.title) {
              dispatch({ type: "SESSION_TITLED", sessionId: updated.id, title: updated.title });
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          dispatch({ type: "ERROR", message: "Generation stopped.", sessionId: streamingSessionId });
        } else {
          dispatch({
            type: "ERROR",
            message: err instanceof Error ? err.message : "Network error",
            sessionId: streamingSessionId,
          });
        }
      }
    },
    [state.sessionId],
  );

  const handleRetry = useCallback(() => {
    if (!lastSentRef.current) return;
    void handleSend(lastSentRef.current.text, lastSentRef.current.attachment, true);
  }, [handleSend]);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/agent-sessions/${sessionId}`, { method: "DELETE" });
      if (!res.ok) return;
      dispatch({ type: "DELETE_SESSION", sessionId });
    } catch {
      // network failure — leave session in list
    }
  }, []);

  const loadSession = useCallback(async (sessionId: string) => {
    const res = await fetch(`/api/agent-sessions/${sessionId}`);
    if (!res.ok) return;
    const messages = (await res.json()) as ChatMessage[];
    dispatch({ type: "LOAD_SESSION", sessionId, messages });
  }, []);

  // Auto-restore the most recent session on mount so the chat isn't blank
  // after navigating away and back.
  useEffect(() => {
    if (initialSessions[0]) {
      void loadSession(initialSessions[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col h-screen bg-bg">
      <AppNav />
      <div className="flex flex-1 min-h-0">
        <SessionSidebar
          sessions={state.sessions}
          activeSessionId={state.sessionId}
          onSelect={loadSession}
          onNew={() => dispatch({ type: "NEW_SESSION" })}
          onDelete={handleDeleteSession}
        />
        <div className="flex flex-col flex-1 min-w-0">
          {state.messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6">
              <div className="size-12 rounded-full bg-accent-soft flex items-center justify-center">
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
                  <circle cx="10" cy="12" r="6.5" fill="none" stroke="var(--accent-oo)" strokeWidth="1.4" />
                  <circle cx="14" cy="12" r="6.5" fill="none" stroke="var(--accent-deep)" strokeWidth="1.4" />
                </svg>
              </div>
              <div className="text-center">
                <p className="t-h6 text-ink">What do you want to <em className="t-editorial">direct?</em></p>
                <p className="text-sm text-ink-dim mt-1">List, search, build characters — or start a scene.</p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center max-w-sm">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleSend(s)}
                    className="t-meta text-ink-dim border border-hair rounded-full px-3 py-1.5 bg-surface-1 hover:border-ink-faint hover:text-ink transition-colors duration-[120ms]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <MessageThread
              messages={state.messages}
              isStreaming={state.isStreaming}
              {...(!state.isStreaming ? { onRetry: handleRetry } : {})}
            />
          )}
          <ChatInput onSend={handleSend} onStop={handleStop} isStreaming={state.isStreaming} />
        </div>
      </div>
    </div>
  );
}
