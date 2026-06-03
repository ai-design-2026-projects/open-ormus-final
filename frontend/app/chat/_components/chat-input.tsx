"use client";

import { useRef, useState } from "react";
import type { Attachment } from "@/lib/agent/attachment";

interface ChatInputProps {
  onSend: (message: string, attachment?: Attachment) => void;
  onStop: () => void;
  isStreaming: boolean;
}

export function ChatInput({ onSend, onStop, isStreaming }: ChatInputProps) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachment, setAttachment] = useState<Attachment | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      alert("PDF must be under 20 MB.");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAttachment({ filename: file.name, fileData: reader.result as string });
    };
    reader.readAsDataURL(file);
  };

  const clearAttachment = () => {
    setAttachment(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleSend = () => {
    const value = textRef.current?.value.trim();
    if (!value || isStreaming) return;
    onSend(value, attachment ?? undefined);
    if (textRef.current) textRef.current.value = "";
    clearAttachment();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-border p-3 flex flex-col gap-2">
      {attachment && (
        <div className="flex items-center gap-2 px-1">
          <span className="text-xs text-muted-foreground truncate max-w-xs">📎 {attachment.filename}</span>
          <button
            onClick={clearAttachment}
            className="text-xs text-muted-foreground hover:text-foreground leading-none"
            aria-label="Remove attachment"
          >
            ✕
          </button>
        </div>
      )}
      <div className="flex gap-2 items-end">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={isStreaming}
          className="p-2 rounded-md border border-input text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 transition-colors shrink-0"
          aria-label="Attach PDF"
          title="Attach PDF"
        >
          📎
        </button>
        <textarea
          ref={textRef}
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
    </div>
  );
}
