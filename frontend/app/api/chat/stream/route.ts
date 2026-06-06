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
import { createMcpServer } from "@/lib/agent/mcp_bridge";
import { runAgent } from "@/lib/agent/loop";
import { logLlmUsage } from "@/lib/llm-usage";
import { LlmUsageSource } from "@/lib/generated/prisma/client";
import { AttachmentSchema } from "@/lib/agent/attachment";

const RequestSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().uuid().optional(),
  attachments: z.array(AttachmentSchema).max(1).optional(),
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
  const { message, sessionId: incomingSessionId, attachments } = parsed.data;

  const sessionId = incomingSessionId ?? (await createSession(prisma, user.id));
  const priorMessages = await getSessionMessages(prisma, sessionId, user.id);

  // Detect retry: if the last persisted turn is already a user message with the
  // same content, the client is retrying a failed request. Slice it off so
  // runAgent doesn't see the same user turn twice.
  const lastPrior = priorMessages[priorMessages.length - 1];
  const isRetry =
    lastPrior !== undefined &&
    typeof lastPrior === "object" &&
    "role" in lastPrior &&
    lastPrior.role === "user" &&
    "content" in lastPrior &&
    typeof lastPrior.content === "string" &&
    lastPrior.content === message;
  const effectivePrior = isRetry ? priorMessages.slice(0, -1) : priorMessages;
  const isFirstTurn = effectivePrior.length === 0;

  const jwt = generateToolToken(user.id);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Client may have aborted (Stop button); enqueueing into a closed
      // controller throws. Swallow so persistence below still runs.
      const safeEnqueue = (data: Uint8Array) => {
        try {
          controller.enqueue(data);
        } catch {
          // controller already closed
        }
      };

      safeEnqueue(encodeChunk({ type: "session_created", sessionId }));

      const mcp = createMcpServer(jwt);

      try {
        await mcp.connect();

        const { items, error } = await runAgent(
          effectivePrior,
          message,
          mcp,
          safeEnqueue,
          { source: LlmUsageSource.AGENT_SESSION, agentSessionId: sessionId, userId: user.id },
          request.signal,
          attachments,
        );

        // Persist regardless of LLM error so the user turn and any completed
        // tool rounds are not lost.
        try {
          await appendTurns(prisma, sessionId, items.slice(priorMessages.length));
        } catch (err) {
          console.error("Failed to persist AgentTurn:", err);
        }

        if (error) {
          safeEnqueue(encodeChunk({ type: "error", message: error.message }));
        } else {
          safeEnqueue(encodeChunk({ type: "done", sessionId }));
          if (isFirstTurn) {
            const title = await autoTitle(sessionId, message, user.id);
            if (title) {
              safeEnqueue(encodeChunk({ type: "session_titled", sessionId, title }));
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Agent error";
        safeEnqueue(encodeChunk({ type: "error", message: msg }));
      } finally {
        try {
          await mcp.close();
        } catch {
          // already closed
        }
        try {
          controller.close();
        } catch {
          // controller already closed
        }
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

async function autoTitle(sessionId: string, firstMessage: string, userId: string): Promise<string | null> {
  const startTime = Date.now();
  try {
    const client = createLLMClient();
    const model = process.env["CONVERSATION_MODEL"] ?? "default";
    const response = await client.chat.completions.create({
      model,
      max_tokens: 20,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...({ reasoning_effort: "none" } as any),
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
    const title = text ? text.slice(0, 100) : null;
    if (title) {
      await setSessionTitle(prisma, sessionId, title);
    }
    const cachedTokens = response.usage?.prompt_tokens_details?.cached_tokens;
    const reasoningTokens = response.usage?.completion_tokens_details?.reasoning_tokens;
    await logLlmUsage(
      { source: LlmUsageSource.AGENT_SESSION, agentSessionId: sessionId, userId },
      {
        generationId: response.id,
        model,
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        ...(cachedTokens !== undefined ? { cachedTokens } : {}),
        ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
        latencyMs: Date.now() - startTime,
      },
    );
    return title;
  } catch (err) {
    console.error("autoTitle failed:", err);
    return null;
  }
}
