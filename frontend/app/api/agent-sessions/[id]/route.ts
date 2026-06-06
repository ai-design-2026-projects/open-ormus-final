import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { deleteSession } from "@/lib/agent/history";
import type { ChatMessage, MessageBlock } from "@/app/chat/_components/message-thread";

type JsonItem = Record<string, unknown>;

/** Mirrors the same extraction logic as mapRunEvent in stream.ts. */
function parseToolOutput(raw: unknown): unknown {
  // Stored format: [{ type: "input_text", text: "JSON..." }]
  if (Array.isArray(raw)) {
    const first = (raw as unknown[])[0];
    if (typeof first === "object" && first !== null) {
      const txt = (first as Record<string, unknown>)["text"];
      if (typeof txt === "string") {
        try { return JSON.parse(txt); } catch { return txt; }
      }
    }
    return raw;
  }
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if ("content" in obj && Array.isArray(obj["content"])) {
      const first = (obj["content"] as unknown[])[0];
      if (typeof first === "object" && first !== null && "text" in (first as Record<string, unknown>)) {
        const text = (first as Record<string, unknown>)["text"];
        if (typeof text === "string") {
          try { return JSON.parse(text); } catch { return text; }
        }
      }
    }
    if ("text" in obj && typeof obj["text"] === "string") {
      try { return JSON.parse(obj["text"]); } catch { return obj["text"]; }
    }
  }
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const session = await prisma.agentSession.findFirst({
    where: { id, userId: user.id },
    include: { turns: { orderBy: { seq: "asc" } } },
  });
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // First pass: index tool outputs by callId so we can attach results to their
  // matching function_call blocks in the second pass.
  const toolOutputs = new Map<string, unknown>();
  for (const turn of session.turns) {
    const item = turn.item as JsonItem | null;
    if (!item) continue;
    if (item["type"] === "function_call_result") {
      const callId = String(item["callId"] ?? "");
      if (callId) toolOutputs.set(callId, parseToolOutput(item["output"]));
    }
  }

  // Second pass: reconstruct ChatMessage[], grouping all items between user
  // messages into a single assistant ChatMessage.
  const messages: ChatMessage[] = [];
  let assistantBlocks: MessageBlock[] | null = null;
  let assistantId: string | null = null;

  const flushAssistant = () => {
    if (assistantBlocks !== null && assistantId !== null) {
      messages.push({ id: assistantId, role: "assistant", blocks: assistantBlocks });
    }
    assistantBlocks = null;
    assistantId = null;
  };

  for (const turn of session.turns) {
    if (turn.role === "user") {
      flushAssistant();
      messages.push({
        id: turn.id,
        role: "user",
        blocks: [{ type: "text", content: turn.content }],
      });
      continue;
    }

    const item = turn.item as JsonItem | null;
    if (!item) continue;

    const itemType = item["type"];

    if (itemType === "function_call") {
      if (!assistantBlocks) { assistantBlocks = []; assistantId = turn.id; }
      let input: unknown = {};
      try { input = JSON.parse(String(item["arguments"] ?? "{}")); } catch { /* keep {} */ }
      const callId = String(item["callId"] ?? "");
      const result = toolOutputs.get(callId);
      if (result !== undefined) {
        assistantBlocks.push({ type: "tool_call", tool: String(item["name"] ?? ""), input, result });
      } else {
        assistantBlocks.push({ type: "tool_call", tool: String(item["name"] ?? ""), input });
      }
      continue;
    }

    if (itemType === "function_call_result") {
      // Already indexed above — nothing to render directly.
      continue;
    }

    // Assistant text message (type === "message" with role "assistant")
    if (turn.content) {
      if (!assistantBlocks) { assistantBlocks = []; assistantId = turn.id; }
      assistantBlocks.push({ type: "text", content: turn.content });
    }
  }

  flushAssistant();

  return NextResponse.json(messages);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await deleteSession(prisma, id, user.id);
  return new NextResponse(null, { status: 204 });
}
