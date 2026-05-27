import { NextResponse } from "next/server";
import { z } from "zod";
import { createLLMClient } from "@/lib/llm-client";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { generateToolToken } from "@/lib/agent/token";
import { encodeChunk } from "@/lib/agent/stream";
import {
  createSession,
  appendTurns,
  getSessionMessages,
  setSessionTitle,
} from "@/lib/agent/history";
import { initMcpSession } from "@/lib/agent/mcp_bridge";
import { runAgentLoop } from "@/lib/agent/loop";

const RequestSchema = z.object({
  message: z.string().min(1).max(8000),
  sessionId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  const { message, sessionId: incomingSessionId } = parsed.data;

  const sessionId = incomingSessionId ?? (await createSession(prisma, user.id));
  const priorMessages = await getSessionMessages(prisma, sessionId, user.id);
  const isFirstTurn = priorMessages.length === 0;

  const jwt = generateToolToken(user.id);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const onChunk = (data: Uint8Array) => controller.enqueue(data);

      try {
        const mcpSession = await initMcpSession(jwt);

        const { assistantText, toolCallsJson } = await runAgentLoop(
          priorMessages,
          message,
          mcpSession,
          onChunk,
        );

        try {
          await appendTurns(prisma, sessionId, message, assistantText, toolCallsJson);
        } catch (err) {
          console.error("Failed to persist AgentTurn:", err);
        }

        if (isFirstTurn) {
          void autoTitle(sessionId, message);
        }

        controller.enqueue(encodeChunk({ type: "done", sessionId }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Agent error";
        controller.enqueue(encodeChunk({ type: "error", message: msg }));
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

async function autoTitle(sessionId: string, firstMessage: string): Promise<void> {
  try {
    const client = createLLMClient();
    const response = await client.chat.completions.create({
      model: process.env["CONVERSATION_MODEL"] ?? "default",
      max_tokens: 20,
      messages: [
        {
          role: "system",
          content:
            "Generate a 3-6 word title for a chat session. Reply with ONLY the title, no punctuation.",
        },
        { role: "user", content: firstMessage },
      ],
    });
    const text = response.choices[0]?.message.content ?? "";
    if (text) {
      await setSessionTitle(prisma, sessionId, text.slice(0, 100));
    }
  } catch (err) {
    console.error("autoTitle failed:", err);
  }
}
