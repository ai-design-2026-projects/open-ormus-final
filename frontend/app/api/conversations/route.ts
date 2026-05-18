import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { CreateConversationInputSchema } from "@open-ormus/shared";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (!user || error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conversations = await prisma.conversation.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    include: {
      participants: {
        include: { character: { select: { id: true, name: true } } },
        orderBy: { turnOrder: "asc" },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { character: { select: { name: true } } },
      },
    },
  });

  const items = conversations.map((c) => ({
    id: c.id,
    title: c.title,
    createdAt: c.createdAt.toISOString(),
    participants: c.participants.map((p) => ({
      characterId: p.character.id,
      name: p.character.name,
    })),
    lastMessage:
      c.messages[0] != null
        ? {
            characterName: c.messages[0].character.name,
            content: c.messages[0].content,
            createdAt: c.messages[0].createdAt.toISOString(),
          }
        : null,
  }));

  return NextResponse.json(items);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (!user || error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await request.json();
  const parsed = CreateConversationInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { title, context, characterIds, turnStrategy } = parsed.data;

  const characters = await prisma.character.findMany({
    where: { id: { in: characterIds }, userId: user.id },
    select: { id: true },
  });
  if (characters.length !== characterIds.length) {
    return NextResponse.json({ error: "Invalid character IDs" }, { status: 400 });
  }

  const conversation = await prisma.conversation.create({
    data: {
      userId: user.id,
      title,
      context,
      turnStrategy,
      participants: {
        create: characterIds.map((characterId, index) => ({
          characterId,
          turnOrder: index,
        })),
      },
    },
    include: {
      participants: {
        include: { character: { select: { id: true, name: true } } },
        orderBy: { turnOrder: "asc" },
      },
    },
  });

  return NextResponse.json(
    {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt.toISOString(),
      participants: conversation.participants.map((p) => ({
        characterId: p.character.id,
        name: p.character.name,
      })),
      lastMessage: null,
    },
    { status: 201 }
  );
}
