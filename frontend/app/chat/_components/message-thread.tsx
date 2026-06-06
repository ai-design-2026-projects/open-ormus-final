"use client";

import { useEffect, useRef } from "react";
import { RotateCcw } from "lucide-react";
import { ToolCallBlock } from "./tool-call-block";
import { renderInline } from "@/lib/render-inline";

export type MessageBlock =
  | { type: "text"; content: string }
  | { type: "tool_call"; tool: string; input: unknown; result?: unknown }
  | { type: "error"; message: string }
  | { type: "attachment"; filename: string };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  blocks: MessageBlock[];
};

interface MessageThreadProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  onRetry?: () => void;
}

function AssistantAvatar() {
  return (
    <div className="size-6 rounded-full bg-accent-soft flex items-center justify-center shrink-0 mt-0.5">
      <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden>
        <circle cx="10" cy="12" r="6.5" fill="none" stroke="var(--accent-oo)" strokeWidth="1.6" />
        <circle cx="14" cy="12" r="6.5" fill="none" stroke="var(--accent-deep)" strokeWidth="1.6" />
      </svg>
    </div>
  );
}

function StreamingDots() {
  return (
    <span className="inline-flex items-center gap-[3px] py-0.5">
      {[0, 150, 300].map((delay, i) => (
        <span
          key={i}
          className="size-1.5 rounded-full bg-ink-faint animate-pulse"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

export function MessageThread({ messages, isStreaming, onRetry }: MessageThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-paper">
      {messages.map((msg, msgIndex) => {
        const isLast = msgIndex === messages.length - 1;

        if (msg.role === "user") {
          return (
            <div key={msg.id} className="flex justify-end">
              <div className="max-w-[75%] bg-ink-panel text-on-ink rounded-2xl rounded-tr-sm px-4 py-2.5 space-y-1.5">
                {msg.blocks.map((block, i) => {
                  if (block.type === "text") {
                    return (
                      <p key={i} className="text-sm whitespace-pre-wrap leading-relaxed">
                        {block.content}
                      </p>
                    );
                  }
                  if (block.type === "attachment") {
                    return (
                      <div key={i} className="flex items-center gap-1.5 text-xs text-on-ink-dim">
                        <span className="t-meta">PDF</span>
                        <span className="truncate max-w-[200px]">{block.filename}</span>
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            </div>
          );
        }

        // Assistant message
        const isThinking = isStreaming && isLast && msg.blocks.length === 0;

        return (
          <div key={msg.id} className="flex justify-start gap-2.5">
            <AssistantAvatar />
            <div className="flex-1 min-w-0 space-y-1.5 pt-0.5">
              {isThinking ? (
                <StreamingDots />
              ) : (
                <>
                  {msg.blocks.map((block, i) => {
                    if (block.type === "text") {
                      return (
                        <p key={i} className="text-sm text-ink whitespace-pre-wrap leading-relaxed">
                          {renderInline(block.content)}
                        </p>
                      );
                    }
                    if (block.type === "tool_call") {
                      return (
                        <ToolCallBlock
                          key={i}
                          tool={block.tool}
                          input={block.input}
                          {...(block.result !== undefined ? { result: block.result } : {})}
                        />
                      );
                    }
                    if (block.type === "error") {
                      return (
                        <div key={i} className="flex flex-col gap-2">
                          <p className="text-sm text-signal-flag">⚠ {block.message}</p>
                          {isLast && onRetry && (
                            <button
                              onClick={onRetry}
                              className="self-start flex items-center gap-1.5 t-meta text-ink-dim border border-hair rounded-full px-3 py-1 bg-surface-1 hover:border-ink-faint hover:text-ink transition-colors duration-[120ms]"
                            >
                              <RotateCcw size={11} />
                              Try again
                            </button>
                          )}
                        </div>
                      );
                    }
                    return null;
                  })}
                  {isStreaming && isLast && msg.blocks.length > 0 && (
                    <StreamingDots />
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
