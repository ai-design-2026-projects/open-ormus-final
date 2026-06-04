import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { startJob } from "@/lib/jobs/runner";
import { ensureStarted } from "@/lib/jobs/startup";
import { validateInternalToken } from "@/lib/internal-auth";
import { ConversationStartInputSchema } from "@open-ormus/shared";

export async function POST(request: Request) {
  let userId: string;
  try {
    userId = validateInternalToken(request.headers.get("authorization"));
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureStarted();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ConversationStartInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  const { characterIds, context, turnStrategy, turns, title } = parsed.data;

  // Verify all characters exist and belong to this user.
  const chars = await prisma.character.findMany({
    where: { id: { in: characterIds }, userId },
    select: { id: true },
  });
  if (chars.length !== characterIds.length) {
    return NextResponse.json(
      { error: "One or more characters not found" },
      { status: 404 }
    );
  }

  const conversation = await prisma.conversation.create({
    data: {
      title: title ?? context.slice(0, 50),
      context,
      turnStrategy,
      userId,
      participants: {
        create: characterIds.map((characterId, i) => ({
          characterId,
          turnOrder: i,
          isUserParticipant: false,
        })),
      },
    },
  });

  const job = await prisma.conversationJob.create({
    data: {
      conversationId: conversation.id,
      userId,
      totalTurns: turns,
      status: "pending",
    },
  });

  void startJob(job.id, conversation.id, userId, turns);

  return NextResponse.json(
    { conversationId: conversation.id, jobId: job.id },
    { status: 202 }
  );
}
