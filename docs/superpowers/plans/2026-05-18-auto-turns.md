# Auto-turns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users specify N turns for a Conversation and have them run automatically in the background — surviving browser closes — with real-time token streaming while the page is open.

**Architecture:** A fire-and-forget async job runs inside the Next.js server process. A module-level EventEmitter singleton bridges the background task to a GET SSE endpoint the browser subscribes to. Job state (status, progress) is persisted in Postgres so jobs survive server restarts.

**Tech Stack:** Next.js 16 App Router, Prisma 7, Bun, bun:test, LiteLLM (Anthropic streaming API)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `prisma/schema.prisma` | Modify | Add `ConversationJob` model |
| `frontend/lib/conversation/next.ts` | Create | Streaming turn generator (extracted from route handler) |
| `frontend/lib/jobs/runner.ts` | Create | EventEmitter singleton, job execution loop |
| `frontend/lib/jobs/startup.ts` | Create | One-time boot hook: reset stale jobs and relaunch |
| `frontend/lib/__tests__/conversation-runner.test.ts` | Create | Unit tests for runner |
| `frontend/app/api/conversations/[id]/jobs/route.ts` | Create | POST (create job), GET (active job status) |
| `frontend/app/api/conversations/[id]/jobs/[jobId]/route.ts` | Create | DELETE (cancel job) |
| `frontend/app/api/conversations/[id]/jobs/[jobId]/stream/route.ts` | Create | GET SSE — streams token/turn_done/done events |
| `frontend/app/api/conversations/[id]/next/route.ts` | Modify | Simplify to call `generateNextTurnStream` from lib |
| `frontend/app/conversations/[id]/page.tsx` | Modify | Add N input, Run/Stop, progress bar, SSE client |

---

## Task 1: Add ConversationJob to Prisma schema

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add ConversationJob model and update relations**

In `prisma/schema.prisma`, add to the `User` model's relations:
```prisma
  conversationJobs ConversationJob[]
```

Add to the `Conversation` model's relations:
```prisma
  jobs ConversationJob[]
```

Append the new model at the end of the file:
```prisma
model ConversationJob {
  id             String   @id @default(uuid()) @db.Uuid
  conversationId String   @db.Uuid @map("conversation_id")
  userId         String   @db.Uuid @map("user_id")
  totalTurns     Int      @map("total_turns")
  doneTurns      Int      @default(0) @map("done_turns")
  status         String   @default("pending")
  errorMessage   String?  @map("error_message")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([conversationId])
  @@index([userId])
  @@map("conversation_jobs")
}
```

- [ ] **Step 2: Run migration**

```bash
bun run prisma:migrate:dev
```

When prompted for a migration name, enter: `add_conversation_job`

Expected output: `Your database is now in sync with your schema.`

- [ ] **Step 3: Regenerate Prisma client**

```bash
bun run prisma:generate
```

Expected output: `Generated Prisma Client` (no errors).

---

## Task 2: Write failing tests for the runner

**Files:**
- Create: `frontend/lib/__tests__/conversation-runner.test.ts`

- [ ] **Step 1: Create test file**

```typescript
// frontend/lib/__tests__/conversation-runner.test.ts
import { mock } from "bun:test";

// Mock paths must match the import specifiers used inside runner.ts
mock.module("@/lib/prisma", () => ({
  prisma: {
    conversationJob: {
      update: async () => ({}),
    },
  },
}));

mock.module("@/lib/conversation/next", () => ({
  generateNextTurnStream: async function* (_conversationId: string, _userId: string) {
    yield "hello";
    yield " world";
  },
}));

import { describe, test, expect } from "bun:test";
import { startJob, subscribeToJob } from "../jobs/runner";

describe("subscribeToJob", () => {
  test("receives token events in order", async () => {
    const received: string[] = [];

    await new Promise<void>((resolve) => {
      const unsub = subscribeToJob("job-a", {
        onToken: (t) => received.push(t),
        onTurnDone: () => {},
        onDone: () => { unsub(); resolve(); },
        onError: (e) => { unsub(); throw new Error(e); },
      });

      void startJob("job-a", "conv-a", "user-a", 1);
    });

    expect(received).toEqual(["hello", " world"]);
  });

  test("receives turn_done with correct count", async () => {
    const turnsDone: number[] = [];

    await new Promise<void>((resolve) => {
      const unsub = subscribeToJob("job-b", {
        onToken: () => {},
        onTurnDone: (done) => turnsDone.push(done),
        onDone: () => { unsub(); resolve(); },
        onError: (e) => { unsub(); throw new Error(e); },
      });

      void startJob("job-b", "conv-b", "user-b", 2);
    });

    expect(turnsDone).toEqual([1, 2]);
  });

  test("unsubscribe stops receiving events", async () => {
    const received: string[] = [];

    await new Promise<void>((resolve) => {
      const unsub = subscribeToJob("job-c", {
        onToken: (t) => { received.push(t); unsub(); },
        onTurnDone: () => {},
        onDone: () => resolve(),
        onError: () => resolve(),
      });

      void startJob("job-c", "conv-c", "user-c", 1);
    });

    expect(received).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun test --cwd frontend lib/__tests__/conversation-runner.test.ts
```

Expected: `Cannot find module '../jobs/runner'` or similar. Tests must fail before we implement.

---

## Task 3: Create `frontend/lib/conversation/next.ts`

**Files:**
- Create: `frontend/lib/conversation/next.ts`

This extracts and converts the business logic from `next/route.ts` into an async generator that yields string tokens and saves the completed message to DB internally.

- [ ] **Step 1: Create the file**

```typescript
// frontend/lib/conversation/next.ts
import { prisma } from "@/lib/prisma";
import { selectNextSpeakerWithOrchestrator } from "@/lib/orchestrator";
import { buildCharacterPrompt } from "@/lib/prompts";
import { CharacterSearchResultSchema } from "@open-ormus/shared";

type LiteLLMDelta = { type?: string; text?: string };
type LiteLLMEvent = { type: string; delta?: LiteLLMDelta };

// Yields each text token as it arrives from LiteLLM.
// Saves the completed message to DB before returning.
// Throws if the conversation is not found, has no participants,
// or if CONVERSATION_MODEL / ANTHROPIC_BASE_URL env vars are missing.
export async function* generateNextTurnStream(
  conversationId: string,
  userId: string,
): AsyncGenerator<string> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    include: {
      participants: {
        include: { character: true },
        orderBy: { turnOrder: "asc" },
      },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { character: { select: { name: true } } },
      },
    },
  });

  if (!conversation) throw new Error("Conversation not found");
  if (conversation.participants.length === 0) throw new Error("No participants");

  const model = process.env["CONVERSATION_MODEL"];
  if (!model) throw new Error("CONVERSATION_MODEL env var not set");

  let nextParticipant: (typeof conversation.participants)[number];

  if (conversation.participants.length >= 3) {
    const characterId = await selectNextSpeakerWithOrchestrator(
      conversation.participants,
      conversation.messages,
    );
    const found = conversation.participants.find((p) => p.characterId === characterId);
    if (!found) {
      console.error(
        `[generateNextTurnStream] orchestrator returned unknown characterId "${characterId}" — falling back to round-robin`,
      );
    }
    nextParticipant =
      found ??
      conversation.participants[
        conversation.messages.length % conversation.participants.length
      ]!;
  } else {
    nextParticipant =
      conversation.participants[
        conversation.messages.length % conversation.participants.length
      ]!;
  }

  const sheet = CharacterSearchResultSchema.parse(nextParticipant.character.sheet);
  const systemPrompt = buildCharacterPrompt(sheet, conversation.context);

  const historyText =
    conversation.messages.length > 0
      ? conversation.messages.map((m) => `[${m.character.name}]: ${m.content}`).join("\n")
      : "(The scene has just begun — no lines have been spoken yet.)";

  const userMessage = `Conversation so far:\n${historyText}\n\nNow continue as ${nextParticipant.character.name}. Write only their next line.`;

  const baseUrl = process.env["ANTHROPIC_BASE_URL"] ?? "http://localhost:4000";
  const apiKey = process.env["ANTHROPIC_API_KEY"] ?? "";

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      stream: true,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LiteLLM error: ${text}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;

      let event: LiteLLMEvent;
      try {
        event = JSON.parse(data) as LiteLLMEvent;
      } catch {
        continue;
      }

      if (
        event.type === "content_block_delta" &&
        event.delta?.type === "text_delta" &&
        typeof event.delta.text === "string"
      ) {
        content += event.delta.text;
        yield event.delta.text;
      }
    }
  }

  await prisma.message.create({
    data: {
      conversationId,
      characterId: nextParticipant.characterId,
      content,
    },
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
bun run typecheck
```

Expected: no errors in `frontend/lib/conversation/next.ts`.

---

## Task 4: Implement `frontend/lib/jobs/runner.ts`

**Files:**
- Create: `frontend/lib/jobs/runner.ts`

- [ ] **Step 1: Create the runner**

```typescript
// frontend/lib/jobs/runner.ts
import EventEmitter from "events";
import { prisma } from "@/lib/prisma";
import { generateNextTurnStream } from "@/lib/conversation/next";

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

const activeJobs = new Set<string>();
const cancelledJobs = new Set<string>();

export interface JobHandlers {
  onToken: (text: string) => void;
  onTurnDone: (doneTurns: number, totalTurns: number) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

export function subscribeToJob(jobId: string, handlers: JobHandlers): () => void {
  const onToken = (text: string) => handlers.onToken(text);
  const onTurnDone = (done: number, total: number) => handlers.onTurnDone(done, total);
  const onDone = () => handlers.onDone();
  const onError = (msg: string) => handlers.onError(msg);

  emitter.on(`${jobId}:token`, onToken);
  emitter.on(`${jobId}:turn_done`, onTurnDone);
  emitter.on(`${jobId}:done`, onDone);
  emitter.on(`${jobId}:error`, onError);

  return () => {
    emitter.off(`${jobId}:token`, onToken);
    emitter.off(`${jobId}:turn_done`, onTurnDone);
    emitter.off(`${jobId}:done`, onDone);
    emitter.off(`${jobId}:error`, onError);
  };
}

export async function startJob(
  jobId: string,
  conversationId: string,
  userId: string,
  totalTurns: number,
): Promise<void> {
  if (activeJobs.has(jobId)) return;
  activeJobs.add(jobId);

  await prisma.conversationJob.update({
    where: { id: jobId },
    data: { status: "running" },
  });

  runTurns(jobId, conversationId, userId, totalTurns)
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      void markFailed(jobId, msg);
    })
    .finally(() => activeJobs.delete(jobId));
}

async function runTurns(
  jobId: string,
  conversationId: string,
  userId: string,
  totalTurns: number,
): Promise<void> {
  for (let i = 0; i < totalTurns; i++) {
    if (cancelledJobs.has(jobId)) {
      cancelledJobs.delete(jobId);
      return;
    }

    for await (const token of generateNextTurnStream(conversationId, userId)) {
      emitter.emit(`${jobId}:token`, token);
    }

    await prisma.conversationJob.update({
      where: { id: jobId },
      data: { doneTurns: i + 1 },
    });
    emitter.emit(`${jobId}:turn_done`, i + 1, totalTurns);
  }

  await prisma.conversationJob.update({
    where: { id: jobId },
    data: { status: "done" },
  });
  emitter.emit(`${jobId}:done`);
}

async function markFailed(jobId: string, message: string): Promise<void> {
  await prisma.conversationJob.update({
    where: { id: jobId },
    data: { status: "failed", errorMessage: message },
  });
  emitter.emit(`${jobId}:error`, message);
}

export function cancelJob(jobId: string): void {
  cancelledJobs.add(jobId);
}
```

- [ ] **Step 2: Run the failing tests — they should now pass**

```bash
bun test --cwd frontend lib/__tests__/conversation-runner.test.ts
```

Expected: all 3 tests pass (`subscribeToJob > receives token events in order`, etc.)

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

---

## Task 5: Create `frontend/lib/jobs/startup.ts`

**Files:**
- Create: `frontend/lib/jobs/startup.ts`

- [ ] **Step 1: Create startup hook**

```typescript
// frontend/lib/jobs/startup.ts
import { prisma } from "@/lib/prisma";
import { startJob } from "@/lib/jobs/runner";

let initialized = false;

// Call this from the jobs POST route handler (it will be called on first request).
// Resets stale "running" jobs to "pending" and relaunches all pending jobs.
export async function ensureStarted(): Promise<void> {
  if (initialized) return;
  initialized = true;

  // Reset any jobs that were "running" when the server last died
  await prisma.conversationJob.updateMany({
    where: { status: "running" },
    data: { status: "pending" },
  });

  const pending = await prisma.conversationJob.findMany({
    where: { status: "pending" },
  });

  for (const job of pending) {
    const remaining = job.totalTurns - job.doneTurns;
    if (remaining > 0) {
      void startJob(job.id, job.conversationId, job.userId, remaining);
    }
  }
}
```

---

## Task 6: Create job API routes (POST create + GET active)

**Files:**
- Create: `frontend/app/api/conversations/[id]/jobs/route.ts`

- [ ] **Step 1: Create the route file**

```typescript
// frontend/app/api/conversations/[id]/jobs/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { startJob } from "@/lib/jobs/runner";
import { ensureStarted } from "@/lib/jobs/startup";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/conversations/[id]/jobs
// Returns the most recent active job (pending or running), or null.
export async function GET(_request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (!user || error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const job = await prisma.conversationJob.findFirst({
    where: {
      conversationId: id,
      userId: user.id,
      status: { in: ["pending", "running"] },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(job ?? null);
}

// POST /api/conversations/[id]/jobs
// Body: { turns: number }  (1–500)
// Creates a ConversationJob and starts it in the background.
export async function POST(request: Request, { params }: RouteContext) {
  await ensureStarted();

  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (!user || error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify the conversation belongs to this user
  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: user.id },
  });
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // One job at a time per conversation
  const existing = await prisma.conversationJob.findFirst({
    where: { conversationId: id, userId: user.id, status: { in: ["pending", "running"] } },
  });
  if (existing) {
    return NextResponse.json({ error: "A job is already running for this conversation" }, { status: 409 });
  }

  const body = (await request.json()) as unknown;
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).turns !== "number"
  ) {
    return NextResponse.json({ error: "turns must be a number" }, { status: 400 });
  }

  const turns = (body as { turns: number }).turns;
  if (turns < 1 || turns > 500 || !Number.isInteger(turns)) {
    return NextResponse.json({ error: "turns must be an integer between 1 and 500" }, { status: 400 });
  }

  const job = await prisma.conversationJob.create({
    data: {
      conversationId: id,
      userId: user.id,
      totalTurns: turns,
      status: "pending",
    },
  });

  // Fire-and-forget — does not block the response
  void startJob(job.id, id, user.id, turns);

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
```

---

## Task 7: Create DELETE route (cancel job)

**Files:**
- Create: `frontend/app/api/conversations/[id]/jobs/[jobId]/route.ts`

- [ ] **Step 1: Create the route file**

```typescript
// frontend/app/api/conversations/[id]/jobs/[jobId]/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { cancelJob } from "@/lib/jobs/runner";

type RouteContext = { params: Promise<{ id: string; jobId: string }> };

export async function DELETE(_request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (!user || error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, jobId } = await params;

  const job = await prisma.conversationJob.findFirst({
    where: { id: jobId, conversationId: id, userId: user.id },
  });
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  cancelJob(jobId);

  await prisma.conversationJob.update({
    where: { id: jobId },
    data: { status: "cancelled" },
  });

  return NextResponse.json({ ok: true });
}
```

---

## Task 8: Create SSE stream route

**Files:**
- Create: `frontend/app/api/conversations/[id]/jobs/[jobId]/stream/route.ts`

- [ ] **Step 1: Create the route file**

```typescript
// frontend/app/api/conversations/[id]/jobs/[jobId]/stream/route.ts
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { subscribeToJob } from "@/lib/jobs/runner";

type RouteContext = { params: Promise<{ id: string; jobId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (!user || error) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id, jobId } = await params;

  const job = await prisma.conversationJob.findFirst({
    where: { id: jobId, conversationId: id, userId: user.id },
  });
  if (!job) {
    return new Response("Not found", { status: 404 });
  }

  // If already done/failed/cancelled, return a terminal event immediately
  if (job.status === "done") {
    return new Response(`data: ${JSON.stringify({ type: "done" })}\n\n`, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  }
  if (job.status === "failed") {
    return new Response(
      `data: ${JSON.stringify({ type: "error", message: job.errorMessage ?? "Unknown error" })}\n\n`,
      { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
    );
  }

  const stream = new ReadableStream({
    start(controller) {
      const encode = (obj: unknown) =>
        `data: ${JSON.stringify(obj)}\n\n`;

      const unsub = subscribeToJob(jobId, {
        onToken: (text) => {
          controller.enqueue(encode({ type: "token", text }));
        },
        onTurnDone: (doneTurns, totalTurns) => {
          controller.enqueue(encode({ type: "turn_done", doneTurns, totalTurns }));
        },
        onDone: () => {
          controller.enqueue(encode({ type: "done" }));
          unsub();
          controller.close();
        },
        onError: (message) => {
          controller.enqueue(encode({ type: "error", message }));
          unsub();
          controller.close();
        },
      });

      // Cleanup when client disconnects
      request.signal.addEventListener("abort", () => {
        unsub();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

---

## Task 9: Simplify `next/route.ts` to use the lib

The existing `POST /api/conversations/[id]/next` endpoint is kept for backward compatibility but simplified to call `generateNextTurnStream` from the lib.

**Files:**
- Modify: `frontend/app/api/conversations/[id]/next/route.ts`

- [ ] **Step 1: Replace the route handler body**

Replace the entire file content with:

```typescript
// frontend/app/api/conversations/[id]/next/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { generateNextTurnStream } from "@/lib/conversation/next";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (!user || error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    for await (const _ of generateNextTurnStream(id, user.id)) {
      // discard tokens — this endpoint returns the complete message
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("Not found") || msg.includes("Conversation not found")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (msg.includes("No participants")) {
      return NextResponse.json({ error: "No participants" }, { status: 400 });
    }
    if (msg.includes("LiteLLM error")) {
      return NextResponse.json({ error: msg }, { status: 502 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Fetch the message that was just created (last message for this conversation)
  const message = await prisma.message.findFirst({
    where: { conversationId: id },
    orderBy: { createdAt: "desc" },
    include: { character: { select: { name: true } } },
  });

  if (!message) {
    return NextResponse.json({ error: "Message not saved" }, { status: 500 });
  }

  return NextResponse.json(
    {
      id: message.id,
      conversationId: message.conversationId,
      characterId: message.characterId,
      characterName: message.character.name,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
    },
    { status: 201 },
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

---

## Task 10: Update the conversation page UI

**Files:**
- Modify: `frontend/app/conversations/[id]/page.tsx`

Replace the entire file:

- [ ] **Step 1: Rewrite the page**

```typescript
// frontend/app/conversations/[id]/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Participant = { characterId: string; name: string; turnOrder: number };
type Message = {
  id: string;
  characterName: string;
  content: string;
  createdAt: string;
};
type ConversationDetail = {
  id: string;
  title: string;
  context: string;
  participants: Participant[];
  messages: Message[];
};
type ActiveJob = {
  id: string;
  totalTurns: number;
  doneTurns: number;
  status: string;
};

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();

  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [turnsInput, setTurnsInput] = useState("5");
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [streamingBuffer, setStreamingBuffer] = useState("");
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);

  async function loadConversation() {
    const res = await fetch(`/api/conversations/${id}`);
    if (res.ok) setConversation((await res.json()) as ConversationDetail);
    setLoading(false);
  }

  async function checkActiveJob() {
    const res = await fetch(`/api/conversations/${id}/jobs`);
    if (!res.ok) return;
    const job = (await res.json()) as ActiveJob | null;
    if (job && (job.status === "running" || job.status === "pending")) {
      setActiveJob(job);
      connectToJob(job.id);
    }
  }

  function connectToJob(jobId: string) {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`/api/conversations/${id}/jobs/${jobId}/stream`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      const data = JSON.parse(event.data as string) as {
        type: string;
        text?: string;
        doneTurns?: number;
        totalTurns?: number;
        message?: string;
      };

      if (data.type === "token") {
        setStreamingBuffer((prev) => prev + (data.text ?? ""));
      } else if (data.type === "turn_done") {
        // Commit the buffered turn as a real message
        setStreamingBuffer("");
        void loadConversation();
        setActiveJob((prev) =>
          prev ? { ...prev, doneTurns: data.doneTurns ?? prev.doneTurns } : prev,
        );
      } else if (data.type === "done") {
        es.close();
        eventSourceRef.current = null;
        setActiveJob(null);
        setStreamingBuffer("");
        void loadConversation();
      } else if (data.type === "error") {
        es.close();
        eventSourceRef.current = null;
        setActiveJob(null);
        setStreamingBuffer("");
        setError(data.message ?? "Job failed");
      }
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
    };
  }

  useEffect(() => {
    void loadConversation();
    void checkActiveJob();

    return () => {
      eventSourceRef.current?.close();
    };
  }, [id]);

  async function handleRun() {
    const turns = parseInt(turnsInput, 10);
    if (isNaN(turns) || turns < 1 || turns > 500) {
      setError("Enter a number between 1 and 500");
      return;
    }
    setError(null);

    const res = await fetch(`/api/conversations/${id}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turns }),
    });

    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      setError(body.error ?? "Failed to start job");
      return;
    }

    const { jobId } = (await res.json()) as { jobId: string };
    setActiveJob({ id: jobId, totalTurns: turns, doneTurns: 0, status: "running" });
    connectToJob(jobId);
  }

  async function handleStop() {
    if (!activeJob) return;
    await fetch(`/api/conversations/${id}/jobs/${activeJob.id}`, { method: "DELETE" });
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setActiveJob(null);
    setStreamingBuffer("");
  }

  if (loading) return <p className="p-8 text-zinc-500">Loading...</p>;
  if (conversation === null) return <p className="p-8 text-zinc-500">Conversation not found.</p>;

  const sortedParticipants = [...conversation.participants].sort((a, b) => a.turnOrder - b.turnOrder);
  const nextSpeaker = sortedParticipants[conversation.messages.length % sortedParticipants.length];
  const isRunning = activeJob !== null;
  const progress = activeJob ? activeJob.doneTurns / activeJob.totalTurns : 0;

  return (
    <div className="max-w-3xl mx-auto p-8 font-sans">
      <Link href="/conversations" className="text-sm text-zinc-500 hover:text-black mb-4 block">
        ← Back to conversations
      </Link>

      <h1 className="text-2xl font-semibold mb-1">{conversation.title}</h1>
      <p className="text-sm text-zinc-500 mb-6">{sortedParticipants.map((p) => p.name).join(", ")}</p>

      <div className="flex flex-col gap-3 mb-8 min-h-[4rem]">
        {conversation.messages.length === 0 && !streamingBuffer ? (
          <p className="text-zinc-400 italic">No messages yet. Generate the first one.</p>
        ) : (
          conversation.messages.map((m) => (
            <div key={m.id} className="text-sm">
              <span className="font-medium">{m.characterName}:</span>{" "}
              <span className="text-zinc-700">{m.content}</span>
              <span className="text-xs text-zinc-400 ml-2">
                {new Date(m.createdAt).toLocaleTimeString()}
              </span>
            </div>
          ))
        )}
        {streamingBuffer && (
          <div className="text-sm">
            <span className="font-medium text-zinc-400">
              {nextSpeaker?.name ?? "..."}:
            </span>{" "}
            <span className="text-zinc-500">{streamingBuffer}</span>
            <span className="animate-pulse">▋</span>
          </div>
        )}
      </div>

      {nextSpeaker !== undefined && !isRunning && (
        <p className="text-xs text-zinc-400 mb-2">Next: {nextSpeaker.name}</p>
      )}

      {error !== null && <p className="text-sm text-red-500 mb-2">{error}</p>}

      {!isRunning ? (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={500}
            value={turnsInput}
            onChange={(e) => setTurnsInput(e.target.value)}
            className="w-20 px-2 py-2 border border-zinc-300 rounded-md text-sm text-center"
          />
          <span className="text-sm text-zinc-500">turns</span>
          <button
            onClick={() => void handleRun()}
            className="px-4 py-2 bg-black text-white text-sm rounded-md hover:bg-zinc-800"
          >
            ▶ Run
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 bg-zinc-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-black rounded-full transition-all duration-300"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <span className="text-xs text-zinc-500 whitespace-nowrap">
              {activeJob.doneTurns}/{activeJob.totalTurns}
            </span>
            <button
              onClick={() => void handleStop()}
              className="px-3 py-1 bg-zinc-100 text-zinc-700 text-sm rounded-md hover:bg-zinc-200"
            >
              ■ Stop
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

---

## Task 11: Build verification

- [ ] **Step 1: Run all tests**

```bash
bun test --cwd frontend
bun test --cwd mcp_server
```

Expected: all tests pass, no regressions.

- [ ] **Step 2: Build**

```bash
bun run build
```

Expected: build completes with no errors.

- [ ] **Step 3: Manual smoke test**

1. Start services: `bun run dev:frontend` and `bun run dev:llm`
2. Open `http://localhost:3000/conversations`
3. Create or open an existing conversation with at least one participant
4. Enter `3` in the turns input, click **▶ Run**
5. Verify: tokens stream in character-by-character, progress bar advances, 3 messages appear
6. Reload the page while a job is running — verify it reconnects and continues streaming
7. Start a 10-turn job, close the tab, wait 30 seconds, reopen — verify messages are present
8. Start a job and click **■ Stop** — verify it stops at the next turn boundary

- [ ] **Step 4: Commit (from within the worktree)**

```bash
git add prisma/schema.prisma \
  frontend/lib/conversation/next.ts \
  frontend/lib/jobs/runner.ts \
  frontend/lib/jobs/startup.ts \
  frontend/lib/__tests__/conversation-runner.test.ts \
  frontend/app/api/conversations/[id]/jobs/ \
  frontend/app/api/conversations/[id]/next/route.ts \
  frontend/app/conversations/[id]/page.tsx

git commit -m "feat: auto-run conversation turns in background with token streaming"
```
