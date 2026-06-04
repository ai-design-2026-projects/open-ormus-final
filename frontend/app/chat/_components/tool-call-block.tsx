"use client";

import { useState, type ComponentType } from "react";
import { Badge } from "@/components/ui/badge";
import { CharacterCard } from "./tool-renderers/character-card";
import { CharacterDeleteCard } from "./tool-renderers/character-delete-card";
import { ResultSummaryCard } from "./tool-renderers/result-summary-card";
import { ConversationPanel } from "./tool-renderers/conversation-panel";

export interface ToolRendererProps {
  input: unknown;
  result: unknown;
  isLoading: boolean;
}

const toolRenderers: Record<string, ComponentType<ToolRendererProps>> = {
  mcp__openormus__character_create: CharacterCard,
  mcp__openormus__character_update: CharacterCard,
  mcp__openormus__character_delete: CharacterDeleteCard,
  mcp__openormus__character_list: ResultSummaryCard,
  mcp__openormus__character_find: ResultSummaryCard,
  mcp__openormus__character_research: CharacterCard,
  mcp__openormus__show_research: ResultSummaryCard,
  mcp__openormus__conversation_start: ConversationPanel,
  mcp__openormus__conversation_job_status: ConversationPanel,
};

const toolAliases: Record<string, string> = {
  mcp__openormus__character_create: "Create character",
  mcp__openormus__character_update: "Update character",
  mcp__openormus__character_delete: "Archive character",
  mcp__openormus__character_list: "List characters",
  mcp__openormus__character_find: "Find characters",
  mcp__openormus__character_research: "Research character",
  mcp__openormus__show_research: "Research show",
  mcp__openormus__conversation_start: "Start conversation",
  mcp__openormus__conversation_job_status: "Conversation status",
};

function toolLabel(tool: string): string {
  return (
    toolAliases[tool] ??
    tool.replace(/^mcp__[^_]+__/, "").replace(/_/g, " ")
  );
}

interface ToolCallBlockProps {
  tool: string;
  input: unknown;
  result?: unknown;
}

function ToolLabel({ tool, isLoading }: { tool: string; isLoading: boolean }) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      <Badge tone={isLoading ? "neutral" : "accent"} mono dot={isLoading}>
        {toolLabel(tool)}
      </Badge>
    </div>
  );
}

function FallbackAccordion({ tool, input, result }: ToolCallBlockProps) {
  const [open, setOpen] = useState(false);
  const isLoading = result === undefined;
  return (
    <div className="my-1">
      <ToolLabel tool={tool} isLoading={isLoading} />
      <div className="border border-border rounded-md text-xs font-mono">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-accent/40 transition-colors rounded-md"
        >
          <span className="text-muted-foreground">{open ? "▼" : "▶"}</span>
          <span className="text-muted-foreground">Details</span>
          {!open && result !== undefined && (
            <span className="ml-auto text-muted-foreground truncate max-w-[200px]">
              {JSON.stringify(result).slice(0, 100)}
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
            {result !== undefined && (
              <div>
                <p className="text-muted-foreground mb-1">Result</p>
                <pre className="bg-muted rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ToolCallBlock({ tool, input, result }: ToolCallBlockProps) {
  const Renderer = toolRenderers[tool];
  const isLoading = result === undefined;

  if (!Renderer) {
    return <FallbackAccordion tool={tool} input={input} result={result} />;
  }

  return (
    <div className="my-1">
      <ToolLabel tool={tool} isLoading={isLoading} />
      <Renderer
        input={input}
        result={result ?? null}
        isLoading={isLoading}
      />
    </div>
  );
}
