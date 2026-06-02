// frontend/app/api/conversations/[id]/jobs/[jobId]/stream/route.ts
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { subscribeToJob } from "@/lib/jobs/runner";
import { ensureStarted } from "@/lib/jobs/startup";

type RouteContext = { params: Promise<{ id: string; jobId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (!user || error) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id, jobId } = await params;

  const job = await prisma.conversationJob.findFirst({
    where: { id: jobId, conversationId: id, userId: user.id },
  });
  if (!job) {
    return new Response("Not found", { status: 404 });
  }

  if (job.status === "done" || job.status === "cancelled") {
    return new Response(`data: ${JSON.stringify({ type: "done" })}\n\n`, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  }
  if (job.status === "failed") {
    return new Response(
      `data: ${JSON.stringify({ type: "error", message: job.errorMessage ?? "Unknown error" })}\n\n`,
      { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
    );
  }

  // Restart any pending jobs that survived a server reboot before subscribing.
  await ensureStarted();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };

      const encode = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

      // If reconnecting to a paused job, immediately notify the client.
      if (job.status === "awaiting_user") {
        controller.enqueue(encode({ type: "user_turn" }));
      }

      const unsub = subscribeToJob(jobId, {
        onToken: (text) => {
          if (!closed) controller.enqueue(encode({ type: "token", text }));
        },
        onEmotion: (emotion) => {
          if (!closed) controller.enqueue(encode({ type: "emotion", ...emotion }));
        },
        onTurnDone: (doneTurns, totalTurns) => {
          if (!closed) controller.enqueue(encode({ type: "turn_done", doneTurns, totalTurns }));
        },
        onDone: () => {
          if (!closed) controller.enqueue(encode({ type: "done" }));
          unsub();
          close();
        },
        onError: (message) => {
          if (!closed) controller.enqueue(encode({ type: "error", message }));
          unsub();
          close();
        },
        onThinking: () => {
          if (!closed) controller.enqueue(encode({ type: "thinking" }));
        },
        onThinkingDone: () => {
          if (!closed) controller.enqueue(encode({ type: "thinking_done" }));
        },
        onUserTurn: () => {
          if (!closed) controller.enqueue(encode({ type: "user_turn" }));
        },
        onUserTurnDone: () => {
          if (!closed) controller.enqueue(encode({ type: "user_turn_done" }));
        },
      });

      request.signal.addEventListener("abort", () => {
        unsub();
        close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
