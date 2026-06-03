# PDF Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to attach a single PDF to a chat message, sent as a native OpenRouter file content part so vision-capable models receive the document directly.

**Architecture:** Browser reads the PDF via `FileReader.readAsDataURL()` into a base64 data URL — no server-side file I/O. The data URL is sent alongside the text message in the existing JSON POST. `runAgent` builds an OpenAI content array with a `{ type: "file" }` part that the `@openai/agents` SDK serializes as-is; OpenRouter routes it natively to capable models (GPT-4o, Claude, Gemini) or falls back to its cloudflare-ai parser for others.

**Tech Stack:** Next.js 15 App Router, React, `@openai/agents` SDK (chat_completions mode), Zod v4, Bun test runner, OpenRouter API

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `frontend/lib/agent/attachment.ts` | **Create** | `Attachment` type + `AttachmentSchema` Zod validator |
| `frontend/lib/agent/attachment.test.ts` | **Create** | Unit tests for `AttachmentSchema` |
| `frontend/lib/agent/loop.ts` | **Modify** | Accept `attachments?`, build content array, extract `buildUserContent` helper |
| `frontend/lib/agent/loop.test.ts` | **Create** | Unit tests for `buildUserContent` |
| `frontend/app/api/chat/stream/route.ts` | **Modify** | Extend `RequestSchema` with `attachments`, pass to `runAgent` |
| `frontend/app/chat/_components/chat-input.tsx` | **Modify** | File input, paperclip button, attachment badge, updated `onSend` signature |
| `frontend/app/chat/_components/message-thread.tsx` | **Modify** | Add `attachment` to `MessageBlock` union, render badge |
| `frontend/app/chat/_components/chat-view.tsx` | **Modify** | Thread attachment through reducer, update POST body |

---

## Task 1: Attachment type + Zod schema

**Files:**
- Create: `frontend/lib/agent/attachment.ts`
- Create: `frontend/lib/agent/attachment.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/lib/agent/attachment.test.ts`:

```ts
import { test, expect } from "bun:test";
import { AttachmentSchema } from "./attachment";

test("accepts valid PDF data URL", () => {
  const result = AttachmentSchema.safeParse({
    filename: "doc.pdf",
    fileData: "data:application/pdf;base64,AAAA",
  });
  expect(result.success).toBe(true);
});

test("rejects non-PDF MIME type", () => {
  const result = AttachmentSchema.safeParse({
    filename: "doc.txt",
    fileData: "data:text/plain;base64,AAAA",
  });
  expect(result.success).toBe(false);
});

test("rejects empty filename", () => {
  const result = AttachmentSchema.safeParse({
    filename: "",
    fileData: "data:application/pdf;base64,AAAA",
  });
  expect(result.success).toBe(false);
});

test("rejects filename over 255 chars", () => {
  const result = AttachmentSchema.safeParse({
    filename: "a".repeat(256),
    fileData: "data:application/pdf;base64,AAAA",
  });
  expect(result.success).toBe(false);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun test --cwd frontend lib/agent/attachment.test.ts
```

Expected: error — `Cannot find module './attachment'`

- [ ] **Step 3: Create the attachment module**

Create `frontend/lib/agent/attachment.ts`:

```ts
import { z } from "zod";

export const AttachmentSchema = z.object({
  filename: z.string().min(1).max(255),
  fileData: z.string().refine(
    (s) => s.startsWith("data:application/pdf;base64,"),
    { message: "fileData must be a PDF data URL (data:application/pdf;base64,...)" },
  ),
});

export type Attachment = z.infer<typeof AttachmentSchema>;
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test --cwd frontend lib/agent/attachment.test.ts
```

Expected: `4 pass, 0 fail`

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/agent/attachment.ts frontend/lib/agent/attachment.test.ts
git commit -m "feat: add Attachment type and Zod schema"
```

---

## Task 2: Extract buildUserContent helper + update runAgent

**Files:**
- Create: `frontend/lib/agent/loop.test.ts`
- Modify: `frontend/lib/agent/loop.ts`

The `buildUserContent` pure function is extracted so it can be unit-tested independently of the `@openai/agents` SDK.

- [ ] **Step 1: Write the failing tests**

Create `frontend/lib/agent/loop.test.ts`:

```ts
import { test, expect } from "bun:test";
import { buildUserContent } from "./loop";

test("returns plain string when no attachments", () => {
  const result = buildUserContent("hello");
  expect(result).toBe("hello");
});

test("returns content array when attachment present", () => {
  const result = buildUserContent("analyze this", [
    { filename: "doc.pdf", fileData: "data:application/pdf;base64,AAAA" },
  ]);
  expect(result).toEqual([
    { type: "text", text: "analyze this" },
    { type: "file", file: { filename: "doc.pdf", file_data: "data:application/pdf;base64,AAAA" } },
  ]);
});

test("returns plain string when attachments is empty array", () => {
  const result = buildUserContent("hello", []);
  expect(result).toBe("hello");
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun test --cwd frontend lib/agent/loop.test.ts
```

Expected: error — `buildUserContent is not exported from './loop'`

- [ ] **Step 3: Update loop.ts**

Replace the full contents of `frontend/lib/agent/loop.ts` with:

```ts
import { Agent, Runner, MaxTurnsExceededError } from "@openai/agents";
import type { AgentInputItem } from "@openai/agents";
import { type UsageContext } from "@/lib/llm-usage";
import { LlmUsageSource } from "@/lib/generated/prisma/client";
import { encodeChunk, mapRunEvent } from "./stream";
import { LoggingModel } from "./sdk";
import type { AgentMcpServer } from "./mcp_bridge";
import { AGENT_SYSTEM_PROMPT } from "./prompt";
import type { Attachment } from "./attachment";

export function buildUserContent(
  message: string,
  attachments?: Attachment[],
): string | Array<{ type: "text"; text: string } | { type: "file"; file: { filename: string; file_data: string } }> {
  if (!attachments || attachments.length === 0) return message;
  return [
    { type: "text" as const, text: message },
    ...attachments.map((a) => ({
      type: "file" as const,
      file: { filename: a.filename, file_data: a.fileData },
    })),
  ];
}

export async function runAgent(
  priorItems: AgentInputItem[],
  userMessage: string,
  mcpServer: AgentMcpServer,
  onChunk: (data: Uint8Array) => void,
  ctx: UsageContext = { source: LlmUsageSource.AGENT_SESSION },
  signal?: AbortSignal,
  attachments?: Attachment[],
): Promise<{ items: AgentInputItem[]; error: Error | null }> {
  const send = (chunk: Parameters<typeof encodeChunk>[0]) => {
    onChunk(encodeChunk(chunk));
  };

  const input: AgentInputItem[] = [
    ...priorItems,
    { role: "user", content: buildUserContent(userMessage, attachments) } as AgentInputItem,
  ];

  const agent = new Agent({
    name: "openormus",
    instructions: AGENT_SYSTEM_PROMPT,
    model: new LoggingModel(ctx),
    mcpServers: [mcpServer],
  });

  // Hard cap on tool-call rounds. Without it, a model that keeps emitting tool
  // calls loops forever and the request hangs. Configurable via env; 12 covers
  // legitimate multi-step flows.
  const MAX_TURNS = Number(process.env["AGENT_MAX_ITERATIONS"] ?? 12);

  // Captured error. Kept rather than thrown so the caller still persists the
  // items accumulated so far (user turn, prior assistant/tool rounds). Defaults
  // to `input` so the user turn returns even if the run throws before producing
  // any history.
  let error: Error | null = null;
  let finalItems: AgentInputItem[] = input;

  try {
    const stream = await new Runner().run(agent, input, {
      stream: true,
      maxTurns: MAX_TURNS,
      ...(signal ? { signal } : {}),
    });

    for await (const event of stream) {
      const chunk = mapRunEvent(event);
      if (chunk) send(chunk);
    }
    // Surface any terminal error raised during the run.
    await stream.completed;
    finalItems = stream.history;
  } catch (err) {
    // The thrown error carries the run state; recover the items completed so far
    // so partial work persists regardless of branch.
    const recovered = (err as { state?: { history?: AgentInputItem[] } }).state?.history;

    if (err instanceof MaxTurnsExceededError) {
      // Turn cap hit: a clean stop, not an error to surface.
      send({ type: "text_delta", text: "\n\n[Stopped: reached maximum tool-call rounds.]" });
    } else if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
      // Client abort: clean stop; keep the partial turn for persistence.
    } else {
      error = err instanceof Error ? err : new Error("Agent run failed");
    }

    if (Array.isArray(recovered) && recovered.length > 0) finalItems = recovered;
  }

  return { items: finalItems, error };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test --cwd frontend lib/agent/loop.test.ts
```

Expected: `3 pass, 0 fail`

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/agent/loop.ts frontend/lib/agent/loop.test.ts
git commit -m "feat: add buildUserContent helper and attachment support in runAgent"
```

---

## Task 3: Extend route handler schema

**Files:**
- Modify: `frontend/app/api/chat/stream/route.ts`

- [ ] **Step 1: Update RequestSchema and runAgent call**

In `frontend/app/api/chat/stream/route.ts`, apply these two changes:

**Change 1** — add import at top of file (after existing imports):

```ts
import { AttachmentSchema } from "@/lib/agent/attachment";
```

**Change 2** — replace `RequestSchema`:

```ts
const RequestSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().uuid().optional(),
  attachments: z.array(AttachmentSchema).max(1).optional(),
});
```

**Change 3** — destructure `attachments` from parsed data (line ~41):

```ts
const { message, sessionId: incomingSessionId, attachments } = parsed.data;
```

**Change 4** — pass `attachments` to `runAgent` (update the call at line ~68):

```ts
const { items, error } = await runAgent(
  priorMessages,
  message,
  mcp,
  safeEnqueue,
  { source: LlmUsageSource.AGENT_SESSION, agentSessionId: sessionId, userId: user.id },
  request.signal,
  attachments,
);
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: no errors

- [ ] **Step 3: Run full frontend test suite**

```bash
bun test --cwd frontend 2>&1 | tail -5
```

Expected: all tests pass (≥75 pass, 0 fail)

- [ ] **Step 4: Commit**

```bash
git add frontend/app/api/chat/stream/route.ts
git commit -m "feat: extend chat stream route to accept PDF attachments"
```

---

## Task 4: Update MessageThread — add attachment block

**Files:**
- Modify: `frontend/app/chat/_components/message-thread.tsx`

- [ ] **Step 1: Add attachment to MessageBlock union**

In `frontend/app/chat/_components/message-thread.tsx`, replace:

```ts
export type MessageBlock =
  | { type: "text"; content: string }
  | { type: "tool_call"; tool: string; input: unknown; result?: string }
  | { type: "error"; message: string };
```

with:

```ts
export type MessageBlock =
  | { type: "text"; content: string }
  | { type: "tool_call"; tool: string; input: unknown; result?: string }
  | { type: "error"; message: string }
  | { type: "attachment"; filename: string };
```

- [ ] **Step 2: Render the attachment block**

In the same file, inside the `msg.blocks.map((block, i) => { ... })` callback, add the attachment case before the final `return null`:

```tsx
if (block.type === "attachment") {
  return (
    <div key={i} className="flex items-center gap-1 text-xs opacity-75 bg-primary-foreground/10 rounded px-2 py-1 w-fit">
      <span>📎</span>
      <span className="truncate max-w-[200px]">{block.filename}</span>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add frontend/app/chat/_components/message-thread.tsx
git commit -m "feat: render attachment badge in message thread"
```

---

## Task 5: Update ChatInput — file picker UI

**Files:**
- Modify: `frontend/app/chat/_components/chat-input.tsx`

- [ ] **Step 1: Replace ChatInput with attachment-capable version**

Replace the entire contents of `frontend/app/chat/_components/chat-input.tsx` with:

```tsx
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
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: TypeScript will surface the `onSend` signature mismatch in `chat-view.tsx` — this is expected and fixed in the next task.

- [ ] **Step 3: Commit** (do not wait for typecheck to fully pass — next task fixes the type error)

```bash
git add frontend/app/chat/_components/chat-input.tsx
git commit -m "feat: add PDF attachment UI to ChatInput"
```

---

## Task 6: Update ChatView — wire attachment through reducer and POST body

**Files:**
- Modify: `frontend/app/chat/_components/chat-view.tsx`

- [ ] **Step 1: Apply all changes to chat-view.tsx**

Replace the entire contents of `frontend/app/chat/_components/chat-view.tsx` with:

```tsx
"use client";

import { useReducer, useCallback, useRef } from "react";
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
    case "SESSION_CREATED": {
      return { ...state, sessionId: action.sessionId };
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

  const abortRef = useRef<AbortController | null>(null);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleSend = useCallback(
    async (text: string, attachment?: Attachment) => {
      dispatch({ type: "SEND", text, attachmentFilename: attachment?.filename });

      const controller = new AbortController();
      abortRef.current = controller;

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
              if (chunk.type === "session_created")
                dispatch({ type: "SESSION_CREATED", sessionId: chunk.sessionId });
              else if (chunk.type === "text_delta")
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
        if (err instanceof DOMException && err.name === "AbortError") {
          dispatch({ type: "ERROR", message: "Generation stopped." });
        } else {
          dispatch({
            type: "ERROR",
            message: err instanceof Error ? err.message : "Network error",
          });
        }
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
    <div className="flex flex-col h-screen bg-background">
      <AppNav />
      <div className="flex flex-1 min-h-0">
        <SessionSidebar
          sessions={state.sessions}
          activeSessionId={state.sessionId}
          onSelect={loadSession}
          onNew={() => dispatch({ type: "NEW_SESSION" })}
        />
        <div className="flex flex-col flex-1 min-w-0">
          {state.isStreaming && (
            <div className="px-4 py-1 border-b border-border shrink-0">
              <span className="text-xs text-muted-foreground animate-pulse">
                Thinking…
              </span>
            </div>
          )}
          {state.messages.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-muted-foreground text-sm">
                Ask me to list, search, add, or edit your characters — or start a scene.
              </p>
            </div>
          ) : (
            <MessageThread messages={state.messages} isStreaming={state.isStreaming} />
          )}
          <ChatInput onSend={handleSend} onStop={handleStop} isStreaming={state.isStreaming} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck — must be clean**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: no errors

- [ ] **Step 3: Run full test suite**

```bash
bun test --cwd frontend 2>&1 | tail -5
```

Expected: ≥78 pass (75 existing + 3 new loop tests + 4 new attachment tests), 0 fail

- [ ] **Step 4: Commit**

```bash
git add frontend/app/chat/_components/chat-view.tsx
git commit -m "feat: wire PDF attachment through ChatView reducer and POST body"
```

---

## Task 7: Manual verification

- [ ] **Step 1: Start dev server**

```bash
bun run dev:frontend
```

- [ ] **Step 2: Open browser at http://localhost:3000/chat**

- [ ] **Step 3: Verify attachment UI**

Click the 📎 button. A file picker should open. Select a PDF. A badge should appear above the textarea showing `📎 filename.pdf` with a ✕ button. The ✕ should clear the badge.

- [ ] **Step 4: Send a message with attachment**

Type "What is this document about?" and press Enter. The user message in the thread should show the text followed by an attachment badge.

- [ ] **Step 5: Inspect network request**

In browser DevTools → Network → find the `/api/chat/stream` POST → Preview/Payload. Verify the request body contains:

```json
{
  "message": "What is this document about?",
  "attachments": [
    {
      "filename": "yourfile.pdf",
      "fileData": "data:application/pdf;base64,..."
    }
  ]
}
```

- [ ] **Step 6: Verify model receives the file part**

If you have access to OpenRouter logs or the model responds with content from the PDF, the native file content part is working.

- [ ] **Step 7: Run mcp_server tests to confirm no regression**

```bash
bun test --cwd mcp_server 2>&1 | tail -5
```

Expected: 26 pass (same pre-existing 1 fail due to DATABASE_URL), 0 new failures
