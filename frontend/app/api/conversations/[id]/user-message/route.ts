// frontend/app/api/conversations/[id]/user-message/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { resumeUserTurn } from "@/lib/jobs/runner";
import { z } from "zod";

const UserMessageInputSchema = z.object({
  jobId: z.string().uuid(),
  content: z.string().min(1).nullable(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UserMessageInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { jobId, content } = parsed.data;

  const job = await prisma.conversationJob.findFirst({
    where: { id: jobId, conversationId: id, userId: user.id, status: "awaiting_user" },
  });
  if (!job) {
    return NextResponse.json({ error: "Job not found or not awaiting user" }, { status: 404 });
  }

  if (content !== null) {
    await prisma.message.create({
      data: {
        conversationId: id,
        characterId: null,
        authorUserId: user.id,
        content,
        emotion: "Joy",
        intensity: "low",
        subtext: "",
      },
    });
  }

  // Unblock the job runner; signal skip so orchestrator avoids re-selecting user
  resumeUserTurn(jobId, content === null);

  return NextResponse.json({});
}
