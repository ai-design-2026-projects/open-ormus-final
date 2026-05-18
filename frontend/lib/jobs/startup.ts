// frontend/lib/jobs/startup.ts
import { prisma } from "@/lib/prisma";
import { startJob } from "@/lib/jobs/runner";

let initialized = false;

// Call this from the jobs POST route handler on first request.
// Resets stale "running" jobs to "pending" and relaunches all pending jobs.
export async function ensureStarted(): Promise<void> {
  if (initialized) return;
  initialized = true;

  await prisma.conversationJob.updateMany({
    where: { status: "running" },
    data: { status: "pending" },
  });

  const pending = await prisma.conversationJob.findMany({
    where: { status: "pending" },
  });

  for (const job of pending) {
    const remaining = job.totalTurns - job.doneTurns;
    if (remaining > 0) {
      void startJob(job.id, job.conversationId, job.userId, remaining);
    }
  }
}
