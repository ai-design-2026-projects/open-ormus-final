// frontend/app/api/conversations/[id]/next/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { generateNextTurnStream, ConversationError } from "@/lib/conversation/next";

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
    if (err instanceof ConversationError) {
      if (err.code === "NOT_FOUND") return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (err.code === "NO_PARTICIPANTS") return NextResponse.json({ error: "No participants" }, { status: 400 });
      if (err.code === "LITELLM_ERROR") return NextResponse.json({ error: err.message }, { status: 502 });
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const message = await prisma.message.findFirst({
    where: { conversationId: id, conversation: { userId: user.id } },
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
