// frontend/lib/jobs/runner.ts
import EventEmitter from "events";
import { prisma } from "@/lib/prisma";
import { generateNextTurnStream } from "@/lib/conversation/next";

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

const activeJobs = new Set<string>();
const cancelledJobs = new Set<string>();
const abortControllers = new Map<string, AbortController>();

export interface JobHandlers {
  onToken: (text: string) => void;
  onTurnDone: (doneTurns: number, totalTurns: number) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

export function subscribeToJob(jobId: string, handlers: JobHandlers): () => void {
  const onToken = (text: string) => handlers.onToken(text);
  const onTurnDone = (done: number, total: number) => handlers.onTurnDone(done, total);
  // done/error are terminal — use once so they self-clean after firing
  const onDone = () => handlers.onDone();
  const onError = (msg: string) => handlers.onError(msg);

  emitter.on(`${jobId}:token`, onToken);
  emitter.on(`${jobId}:turn_done`, onTurnDone);
  emitter.once(`${jobId}:done`, onDone);
  emitter.once(`${jobId}:error`, onError);

  return () => {
    emitter.off(`${jobId}:token`, onToken);
    emitter.off(`${jobId}:turn_done`, onTurnDone);
    // Terminal listeners (done/error) remain so the promise can resolve
    // even if the caller unsubscribes early from token/turn_done events.
  };
}

export async function startJob(
  jobId: string,
  conversationId: string,
  userId: string,
  totalTurns: number,
): Promise<void> {
  if (activeJobs.has(jobId)) return;
  // If cancelled before the runner could start, skip without touching the DB.
  if (cancelledJobs.has(jobId)) {
    cancelledJobs.delete(jobId);
    return;
  }
  activeJobs.add(jobId);

  await prisma.conversationJob.update({
    where: { id: jobId },
    data: { status: "running" },
  });

  runTurns(jobId, conversationId, userId, totalTurns)
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      void markFailed(jobId, msg);
    })
    .finally(() => activeJobs.delete(jobId));
}

async function runTurns(
  jobId: string,
  conversationId: string,
  userId: string,
  totalTurns: number,
): Promise<void> {
  const ac = new AbortController();
  abortControllers.set(jobId, ac);

  try {
    for (let i = 0; i < totalTurns; i++) {
      if (cancelledJobs.has(jobId)) {
        cancelledJobs.delete(jobId);
        await prisma.conversationJob.update({
          where: { id: jobId },
          data: { status: "cancelled" },
        });
        emitter.emit(`${jobId}:done`);
        return;
      }

      try {
        for await (const token of generateNextTurnStream(conversationId, userId, ac.signal)) {
          emitter.emit(`${jobId}:token`, token);
          // Yield to event loop so Node.js can flush the HTTP write buffer
          // before processing the next token. Without this, tokens from the
          // same LiteLLM TCP chunk are emitted synchronously and bundled into
          // a single HTTP chunk — the client receives them as one block.
          await new Promise<void>((r) => setTimeout(r, 0));
        }
      } catch (err) {
        if (isAbortError(err)) {
          // Mid-turn cancel: LiteLLM fetch was aborted. Partial message is not
          // saved (prisma.message.create in the generator never runs).
          cancelledJobs.delete(jobId);
          await prisma.conversationJob.update({
            where: { id: jobId },
            data: { status: "cancelled" },
          });
          emitter.emit(`${jobId}:done`);
          return;
        }
        throw err;
      }

      await prisma.conversationJob.update({
        where: { id: jobId },
        data: { doneTurns: i + 1 },
      });
      emitter.emit(`${jobId}:turn_done`, i + 1, totalTurns);
    }
  } finally {
    abortControllers.delete(jobId);
  }

  await prisma.conversationJob.update({
    where: { id: jobId },
    data: { status: "done" },
  });
  emitter.emit(`${jobId}:done`);
}

async function markFailed(jobId: string, message: string): Promise<void> {
  await prisma.conversationJob.update({
    where: { id: jobId },
    data: { status: "failed", errorMessage: message },
  });
  emitter.emit(`${jobId}:error`, message);
}

export function cancelJob(jobId: string): void {
  cancelledJobs.add(jobId);
  abortControllers.get(jobId)?.abort();
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}
