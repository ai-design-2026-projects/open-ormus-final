"use client";

import { useRef } from "react";

interface ChatInputProps {
  onSend: (message: string) => void;
  onStop: () => void;
  isStreaming: boolean;
}

export function ChatInput({ onSend, onStop, isStreaming }: ChatInputProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const value = ref.current?.value.trim();
    if (!value || isStreaming) return;
    onSend(value);
    if (ref.current) ref.current.value = "";
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-border p-3 flex gap-2 items-end">
      <textarea
        ref={ref}
        disabled={isStreaming}
        onKeyDown={handleKeyDown}
        placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
        rows={1}
        className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 max-h-32 overflow-y-auto"
        style={{ minHeight: "40px" }}
      />
      {isStreaming ? (
        <button
          onClick={onStop}
          className="px-4 py-2 rounded-md bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 transition-colors shrink-0"
        >
          Stop
        </button>
      ) : (
        <button
          onClick={handleSend}
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors shrink-0"
        >
          Send
        </button>
      )}
    </div>
  );
}
