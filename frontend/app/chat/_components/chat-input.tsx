"use client";

import { useRef, useState } from "react";
import { Paperclip, ArrowUp, Square } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
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
    <div className="border-t border-hair p-3 bg-surface-1 flex flex-col gap-2">
      {attachment && (
        <div className="flex items-center gap-2 px-1">
          <span className="t-meta text-ink-mute truncate max-w-xs">{attachment.filename}</span>
          <button
            onClick={clearAttachment}
            className="t-meta text-ink-mute hover:text-ink transition-colors duration-[120ms]"
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
        <IconButton
          onClick={() => fileRef.current?.click()}
          disabled={isStreaming}
          aria-label="Attach PDF"
          variant="ghost"
          size="sm"
        >
          <Paperclip />
        </IconButton>
        <Textarea
          ref={textRef}
          disabled={isStreaming}
          onKeyDown={handleKeyDown}
          placeholder="Message… (Enter to send, Shift+Enter for newline)"
          className="flex-1 min-h-10 max-h-32 border-hair resize-none overflow-y-auto"
        />
        {isStreaming ? (
          <IconButton
            onClick={onStop}
            aria-label="Stop generation"
            variant="ghost"
            size="sm"
          >
            <Square />
          </IconButton>
        ) : (
          <Button
            onClick={handleSend}
            aria-label="Send message"
            size="icon"
          >
            <ArrowUp />
          </Button>
        )}
      </div>
    </div>
  );
}
