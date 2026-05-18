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
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (!user || error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureStarted();

  const { id } = await params;

  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: user.id },
  });
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

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

  void startJob(job.id, id, user.id, turns);

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
