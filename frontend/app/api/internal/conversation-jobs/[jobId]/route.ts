import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateInternalToken } from "@/lib/internal-auth";
import { ConversationJobStatusSchema } from "@open-ormus/shared";

type RouteContext = { params: Promise<{ jobId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  let userId: string;
  try {
    userId = validateInternalToken(request.headers.get("authorization"));
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await params;

  const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!UUID_RE.test(jobId)) {
    return NextResponse.json({ error: "Invalid jobId" }, { status: 400 });
  }

  const job = await prisma.conversationJob.findFirst({
    where: { id: jobId, userId },
  });

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let messages: unknown = undefined;
  if (job.status === "completed") {
    const conversation = await prisma.conversation.findFirst({
      where: { id: job.conversationId, userId },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          include: { character: { select: { name: true } } },
        },
      },
    });

    messages = conversation?.messages.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      characterId: m.characterId,
      authorUserId: m.authorUserId,
      characterName: m.character?.name ?? "Unknown",
      content: m.content,
      reasoning: m.reasoning,
      emotion: m.emotion,
      intensity: m.intensity,
      subtext: m.subtext,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  const result = ConversationJobStatusSchema.safeParse({
    status: job.status,
    doneTurns: job.doneTurns,
    totalTurns: job.totalTurns,
    error: job.errorMessage ?? undefined,
    messages,
  });

  if (!result.success) {
    console.error("[internal/conversation-jobs] schema mismatch:", result.error.issues);
    return NextResponse.json({ error: "Invalid job status" }, { status: 500 });
  }

  return NextResponse.json(result.data);
}
