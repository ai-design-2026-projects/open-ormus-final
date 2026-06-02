import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

interface RouteContext {
  params: Promise<{ id: string }>;
}

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

  try {
    const conversations = await prisma.conversation.findMany({
      where: {
        userId: user.id,
        participants: { some: { characterId: id } },
      },
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
      participants: c.participants
        .filter((p) => p.character != null)
        .map((p) => ({
          characterId: p.character!.id,
          name: p.character!.name,
        })),
      lastMessage:
        c.messages[0] != null
          ? {
              characterName: c.messages[0].character?.name ?? "",
              content: c.messages[0].content,
              createdAt: c.messages[0].createdAt.toISOString(),
            }
          : null,
    }));

    return NextResponse.json(items);
  } catch {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}
