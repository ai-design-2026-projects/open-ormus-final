import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import type { ChatMessage, MessageBlock } from "@/app/chat/_components/message-thread";

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
    include: { turns: { orderBy: { createdAt: "asc" } } },
  });
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const messages: ChatMessage[] = session.turns.map((turn) => {
    if (turn.role === "user") {
      return {
        id: turn.id,
        role: "user",
        blocks: [{ type: "text", content: turn.content }],
      };
    }

    const blocks: MessageBlock[] = [];
    const toolCalls = turn.toolCalls as unknown;
    if (Array.isArray(toolCalls)) {
      for (const block of toolCalls) {
        if (
          block !== null &&
          typeof block === "object" &&
          "type" in block &&
          block.type === "tool_use"
        ) {
          blocks.push({
            type: "tool_call",
            tool: String((block as { name?: unknown }).name ?? ""),
            input: (block as { input?: unknown }).input,
          });
        }
      }
    }
    if (turn.content) {
      blocks.push({ type: "text", content: turn.content });
    }

    return { id: turn.id, role: "assistant", blocks };
  });

  return NextResponse.json(messages);
}
