"use client";

import { useReducer, useCallback } from "react";
import { SessionSidebar } from "./session-sidebar";
import { MessageThread, type ChatMessage, type MessageBlock } from "./message-thread";
import { ChatInput } from "./chat-input";
import type { AgentSessionSummary } from "@/lib/agent/history";
import type { StreamChunk } from "@/lib/agent/stream";

type ChatState = {
  messages: ChatMessage[];
  sessionId: string | null;
  isStreaming: boolean;
  sessions: AgentSessionSummary[];
};

type ChatAction =
  | { type: "SEND"; text: string }
  | { type: "TEXT_DELTA"; text: string }
  | { type: "TOOL_START"; tool: string; input: unknown }
  | { type: "TOOL_RESULT"; tool: string; preview: string }
  | { type: "DONE"; sessionId: string }
  | { type: "ERROR"; message: string }
  | { type: "NEW_SESSION" }
  | { type: "LOAD_SESSION"; sessionId: string; messages: ChatMessage[] };

function uid() {
  return Math.random().toString(36).slice(2);
}

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SEND": {
      const userMsg: ChatMessage = {
        id: uid(),
        role: "user",
        blocks: [{ type: "text", content: action.text }],
      };
      const assistantMsg: ChatMessage = { id: uid(), role: "assistant", blocks: [] };
      return {
        ...state,
        isStreaming: true,
        messages: [...state.messages, userMsg, assistantMsg],
      };
    }
    case "TEXT_DELTA": {
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
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== "assistant") return state;
      const blocks = [...last.blocks];
      for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i];
        if (b?.type === "tool_call" && b.tool === action.tool && !b.result) {
          blocks[i] = { ...b, result: action.preview };
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
      return { ...state, isStreaming: false, sessionId: action.sessionId, sessions };
    }
    case "ERROR": {
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
    case "NEW_SESSION": {
      return { ...state, messages: [], sessionId: null, isStreaming: false };
    }
    case "LOAD_SESSION": {
      return { ...state, messages: action.messages, sessionId: action.sessionId, isStreaming: false };
    }
  }
}

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

  const handleSend = useCallback(
    async (text: string) => {
      dispatch({ type: "SEND", text });

      try {
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            sessionId: state.sessionId ?? undefined,
          }),
        });

        if (!response.ok || !response.body) {
          dispatch({ type: "ERROR", message: `HTTP ${response.status}` });
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

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
              if (chunk.type === "text_delta")
                dispatch({ type: "TEXT_DELTA", text: chunk.text });
              else if (chunk.type === "tool_start")
                dispatch({ type: "TOOL_START", tool: chunk.tool, input: chunk.input });
              else if (chunk.type === "tool_result")
                dispatch({ type: "TOOL_RESULT", tool: chunk.tool, preview: chunk.preview });
              else if (chunk.type === "done")
                dispatch({ type: "DONE", sessionId: chunk.sessionId });
              else if (chunk.type === "error")
                dispatch({ type: "ERROR", message: chunk.message });
            } catch {
              // malformed chunk — skip
            }
          }
        }
      } catch (err) {
        dispatch({
          type: "ERROR",
          message: err instanceof Error ? err.message : "Network error",
        });
      }
    },
    [state.sessionId],
  );

  const loadSession = useCallback(async (sessionId: string) => {
    const res = await fetch(`/api/agent-sessions/${sessionId}`);
    if (!res.ok) return;
    const messages = (await res.json()) as ChatMessage[];
    dispatch({ type: "LOAD_SESSION", sessionId, messages });
  }, []);

  return (
    <div className="flex h-screen bg-background">
      <SessionSidebar
        sessions={state.sessions}
        activeSessionId={state.sessionId}
        onSelect={loadSession}
        onNew={() => dispatch({ type: "NEW_SESSION" })}
      />
      <div className="flex flex-col flex-1 min-w-0">
        <header className="border-b border-border px-4 py-3 flex items-center gap-2 shrink-0">
          <h1 className="text-sm font-semibold">OpenOrmus Assistant</h1>
          {state.isStreaming && (
            <span className="text-xs text-muted-foreground animate-pulse">
              Thinking…
            </span>
          )}
        </header>
        {state.messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-muted-foreground text-sm">
              Ask me to list, search, add, or edit your characters — or start a scene.
            </p>
          </div>
        ) : (
          <MessageThread messages={state.messages} isStreaming={state.isStreaming} />
        )}
        <ChatInput onSend={handleSend} disabled={state.isStreaming} />
      </div>
    </div>
  );
}
