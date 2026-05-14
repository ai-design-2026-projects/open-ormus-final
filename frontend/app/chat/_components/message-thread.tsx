"use client";

import { useEffect, useRef } from "react";
import { ToolCallBlock } from "./tool-call-block";

export type MessageBlock =
  | { type: "text"; content: string }
  | { type: "tool_call"; tool: string; input: unknown; result?: string }
  | { type: "error"; message: string };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  blocks: MessageBlock[];
};

interface MessageThreadProps {
  messages: ChatMessage[];
  isStreaming: boolean;
}

export function MessageThread({ messages, isStreaming }: MessageThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[80%] space-y-1 ${
              msg.role === "user"
                ? "bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2"
                : "w-full"
            }`}
          >
            {msg.blocks.map((block, i) => {
              if (block.type === "text") {
                return (
                  <p key={i} className="text-sm whitespace-pre-wrap">
                    {block.content}
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
                  <p key={i} className="text-sm text-destructive">
                    ⚠ {block.message}
                  </p>
                );
              }
              return null;
            })}
            {msg.role === "assistant" &&
              isStreaming &&
              msg === messages[messages.length - 1] && (
                <span className="inline-block w-2 h-4 bg-foreground/60 animate-pulse rounded-sm" />
              )}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
