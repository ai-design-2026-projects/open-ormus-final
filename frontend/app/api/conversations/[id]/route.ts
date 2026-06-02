import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (!user || error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: user.id },
    include: {
      participants: {
        include: { character: { select: { id: true, name: true } } },
        orderBy: { turnOrder: "asc" },
      },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { character: { select: { id: true, name: true } } },
      },
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { displayName: true },
  });
  const userDisplayName = dbUser?.displayName ?? "You";

  return NextResponse.json({
    id: conversation.id,
    title: conversation.title,
    context: conversation.context,
    turnStrategy: conversation.turnStrategy,
    createdAt: conversation.createdAt.toISOString(),
    participants: conversation.participants.map((p) => ({
      characterId: p.character?.id ?? null,
      name: p.isUserParticipant ? userDisplayName : (p.character?.name ?? ""),
      turnOrder: p.turnOrder,
      isUserParticipant: p.isUserParticipant,
    })),
    messages: conversation.messages.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      characterId: m.characterId ?? null,
      authorUserId: m.authorUserId ?? null,
      characterName: m.authorUserId ? userDisplayName : (m.character?.name ?? userDisplayName),
      content: m.content,
      reasoning: m.reasoning ?? null,
      emotion: m.emotion,
      intensity: m.intensity,
      subtext: m.subtext,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (!user || error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.conversation.delete({ where: { id } });

  return new NextResponse(null, { status: 204 });
}
