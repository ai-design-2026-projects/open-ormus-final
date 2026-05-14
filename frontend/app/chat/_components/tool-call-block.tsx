"use client";

import { useState } from "react";

interface ToolCallBlockProps {
  tool: string;
  input: unknown;
  result?: string;
}

export function ToolCallBlock({ tool, input, result }: ToolCallBlockProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="my-1 border border-border rounded-md text-xs font-mono">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-accent/40 transition-colors rounded-md"
      >
        <span>{open ? "▼" : "▶"}</span>
        <span className="text-muted-foreground">🔧</span>
        <span className="font-semibold text-foreground">{tool}</span>
        {!open && result && (
          <span className="ml-auto text-muted-foreground truncate max-w-[200px]">
            {result}
          </span>
        )}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-border">
          <div>
            <p className="text-muted-foreground mt-2 mb-1">Input</p>
            <pre className="bg-muted rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>
          {result && (
            <div>
              <p className="text-muted-foreground mb-1">Result preview</p>
              <pre className="bg-muted rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                {result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
