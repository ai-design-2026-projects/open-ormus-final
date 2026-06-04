// frontend/lib/jobs/runner.ts
import EventEmitter from "events";
import { prisma } from "@/lib/prisma";
import { generateNextTurnStream, ConversationError } from "@/lib/conversation/next";

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

const activeJobs = new Set<string>();
const cancelledJobs = new Set<string>();
const abortControllers = new Map<string, AbortController>();
const userTurnResolvers = new Map<string, ((skipped: boolean) => void)[]>();

export interface JobHandlers {
  onToken: (text: string) => void;
  onEmotion: (emotion: { emotion: string; intensity: string; subtext: string }) => void;
  onTurnDone: (doneTurns: number, totalTurns: number) => void;
  onDone: () => void;
  onError: (message: string) => void;
  onThinking?: () => void;
  onThinkingDone?: (reasoning: string) => void;
  onUserTurn?: () => void;
  onUserTurnDone?: () => void;
}

export function resumeUserTurn(jobId: string, skipped = false): void {
  const resolvers = userTurnResolvers.get(jobId) ?? [];
  userTurnResolvers.delete(jobId);
  for (const resolve of resolvers) resolve(skipped);
}

export function subscribeToJob(jobId: string, handlers: JobHandlers): () => void {
  const onToken = (text: string) => handlers.onToken(text);
  const onTurnDone = (done: number, total: number) => handlers.onTurnDone(done, total);
  const onDone = () => handlers.onDone();
  const onError = (msg: string) => handlers.onError(msg);
  const onThinking = () => handlers.onThinking?.();
  const onThinkingDone = (reasoning: string) => handlers.onThinkingDone?.(reasoning);
  const onUserTurn = () => handlers.onUserTurn?.();
  const onUserTurnDone = () => handlers.onUserTurnDone?.();
  const onEmotion = (e: { emotion: string; intensity: string; subtext: string }) =>
    handlers.onEmotion(e);

  emitter.on(`${jobId}:token`, onToken);
  emitter.on(`${jobId}:emotion`, onEmotion);
  emitter.on(`${jobId}:turn_done`, onTurnDone);
  emitter.once(`${jobId}:done`, onDone);
  emitter.once(`${jobId}:error`, onError);
  emitter.on(`${jobId}:thinking`, onThinking);
  emitter.on(`${jobId}:thinking_done`, onThinkingDone);
  emitter.on(`${jobId}:user_turn`, onUserTurn);
  emitter.on(`${jobId}:user_turn_done`, onUserTurnDone);

  return () => {
    emitter.off(`${jobId}:token`, onToken);
    emitter.off(`${jobId}:emotion`, onEmotion);
    emitter.off(`${jobId}:turn_done`, onTurnDone);
    emitter.off(`${jobId}:thinking`, onThinking);
    emitter.off(`${jobId}:thinking_done`, onThinkingDone);
    emitter.off(`${jobId}:user_turn`, onUserTurn);
    emitter.off(`${jobId}:user_turn_done`, onUserTurnDone);
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
    let userSkipped = false;
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
        for await (const event of generateNextTurnStream(
          conversationId,
          userId,
          ac.signal,
          (emotion) => emitter.emit(`${jobId}:emotion`, emotion),
          i,
          userSkipped,
        )) {
          if (event.type === "token") {
            emitter.emit(`${jobId}:token`, event.text);
          } else if (event.type === "thinking") {
            emitter.emit(`${jobId}:thinking`);
          } else if (event.type === "thinking_done") {
            emitter.emit(`${jobId}:thinking_done`, event.reasoning);
          }
          // Yield to event loop so Node.js can flush the HTTP write buffer
          // before processing the next token. Without this, tokens from the
          // same provider TCP chunk are emitted synchronously and bundled into
          // a single HTTP chunk — the client receives them as one block.
          await new Promise<void>((r) => setTimeout(r, 0));
        }
      } catch (err) {
        if (isAbortError(err)) {
          // Mid-turn cancel: LLM fetch was aborted. Partial message is not
          // saved (prisma.message.create in the generator never runs).
          cancelledJobs.delete(jobId);
          await prisma.conversationJob.update({
            where: { id: jobId },
            data: { status: "cancelled" },
          });
          emitter.emit(`${jobId}:done`);
          return;
        }
        if (err instanceof ConversationError && err.code === "USER_TURN") {
          await prisma.conversationJob.update({
            where: { id: jobId },
            data: { status: "awaiting_user" },
          });
          emitter.emit(`${jobId}:user_turn`);

          // Guard against cancelJob firing between the DB update and the
          // resolver registration: if already cancelled, don't hang forever.
          if (cancelledJobs.has(jobId)) {
            cancelledJobs.delete(jobId);
            await prisma.conversationJob.update({
              where: { id: jobId },
              data: { status: "cancelled" },
            });
            emitter.emit(`${jobId}:done`);
            return;
          }

          // Wait until resumeUserTurn is called or job is cancelled
          userSkipped = await new Promise<boolean>((resolve) => {
            const resolvers = userTurnResolvers.get(jobId) ?? [];
            userTurnResolvers.set(jobId, [...resolvers, resolve]);
          });

          if (cancelledJobs.has(jobId)) {
            cancelledJobs.delete(jobId);
            await prisma.conversationJob.update({
              where: { id: jobId },
              data: { status: "cancelled" },
            });
            emitter.emit(`${jobId}:done`);
            return;
          }

          await prisma.conversationJob.update({
            where: { id: jobId },
            data: { status: "running" },
          });
          emitter.emit(`${jobId}:user_turn_done`);
          await prisma.conversationJob.update({
            where: { id: jobId },
            data: { doneTurns: i + 1 },
          });
          emitter.emit(`${jobId}:turn_done`, i + 1, totalTurns);
          continue;
        }
        throw err;
      }

      userSkipped = false;
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
  // Also unblock any pending user-turn wait
  resumeUserTurn(jobId);
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}
