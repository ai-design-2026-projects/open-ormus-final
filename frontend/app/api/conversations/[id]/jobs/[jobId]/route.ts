// frontend/app/api/conversations/[id]/jobs/[jobId]/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { cancelJob } from "@/lib/jobs/runner";

type RouteContext = { params: Promise<{ id: string; jobId: string }> };

export async function DELETE(_request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (!user || error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, jobId } = await params;

  const job = await prisma.conversationJob.findFirst({
    where: { id: jobId, conversationId: id, userId: user.id, status: { in: ["pending", "running", "awaiting_user"] } },
  });
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  cancelJob(jobId);

  await prisma.conversationJob.update({
    where: { id: jobId },
    data: { status: "cancelled" },
  });

  return NextResponse.json({ ok: true });
}
