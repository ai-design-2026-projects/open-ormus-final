import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ jobId: string }> };

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const POLL_MS = 1000;

export async function GET(request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await params;
  if (!UUID_RE.test(jobId)) {
    return NextResponse.json({ error: "Invalid jobId" }, { status: 400 });
  }

  const job = await prisma.conversationJob.findFirst({
    where: { id: jobId, userId: user.id },
  });
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  const userId = user.id;

  function sse(event: string, data: unknown): Uint8Array {
    return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  const stream = new ReadableStream({
    async start(controller) {
      let cancelled = false;
      request.signal.addEventListener("abort", () => {
        cancelled = true;
        controller.close();
      });

      let lastSeenCount = 0;

      try {
        while (!cancelled) {
          const currentJob = await prisma.conversationJob.findFirst({
            where: { id: jobId, userId },
          });

          if (!currentJob) {
            controller.enqueue(
              sse("error", { message: "Job not found" })
            );
            break;
          }

          // Send status update
          controller.enqueue(
            sse("status", {
              status: currentJob.status,
              doneTurns: currentJob.doneTurns,
              totalTurns: currentJob.totalTurns,
            })
          );

          // Fetch new messages for this conversation, ordered by createdAt
          const messages = await prisma.message.findMany({
            where: { conversationId: currentJob.conversationId },
            orderBy: { createdAt: "asc" },
            include: { character: { select: { name: true } } },
            skip: lastSeenCount,
          });

          for (const m of messages) {
            controller.enqueue(
              sse("turn", {
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
              })
            );
          }
          lastSeenCount += messages.length;

          if (TERMINAL.has(currentJob.status)) {
            controller.enqueue(sse("done", { status: currentJob.status }));
            break;
          }

          // Wait before next poll
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
      } catch (err) {
        controller.enqueue(
          sse("error", {
            message: err instanceof Error ? err.message : "Stream error",
          })
        );
      } finally {
        controller.close();
      }
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
