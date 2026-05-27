import type { PrismaClient } from "@/lib/generated/prisma/client";
import { Prisma } from "@/lib/generated/prisma/client";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export type AgentSessionSummary = {
  id: string;
  title: string | null;
  createdAt: string;
};

/** Creates a new AgentSession row. Returns the new session ID. */
export async function createSession(
  prisma: PrismaClient,
  userId: string,
): Promise<string> {
  const session = await prisma.agentSession.create({
    data: { userId },
  });
  return session.id;
}

/**
 * Appends a user turn and assistant turn to an AgentSession.
 * toolCalls stores the raw Claude SDK content blocks for the assistant turn.
 */
export async function appendTurns(
  prisma: PrismaClient,
  sessionId: string,
  userMessage: string,
  assistantContent: string,
  toolCalls: unknown,
): Promise<void> {
  const toolCallsJson =
    toolCalls != null ? (toolCalls as Prisma.InputJsonValue) : undefined;
  await prisma.agentTurn.createMany({
    data: [
      { sessionId, role: "user", content: userMessage },
      {
        sessionId,
        role: "assistant",
        content: assistantContent,
        ...(toolCallsJson !== undefined ? { toolCalls: toolCallsJson } : {}),
      },
    ],
  });
}

/**
 * Loads all turns for a session as OpenAI SDK ChatCompletionMessageParam objects.
 * Tool calls stored in JSON are rehydrated into tool_calls arrays.
 */
export async function getSessionMessages(
  prisma: PrismaClient,
  sessionId: string,
  userId: string,
): Promise<ChatCompletionMessageParam[]> {
  const session = await prisma.agentSession.findFirst({
    where: { id: sessionId, userId },
    include: { turns: { orderBy: { createdAt: "asc" } } },
  });

  if (!session) return [];

  const result: ChatCompletionMessageParam[] = [];

  for (const turn of session.turns) {
    if (turn.role === "user") {
      result.push({ role: "user", content: turn.content });
      continue;
    }
    // Assistant turn: rehydrate tool_calls + tool result messages if stored
    const stored = turn.toolCalls as unknown;
    if (Array.isArray(stored) && stored.length > 0) {
      result.push({ role: "assistant", content: turn.content ?? null, tool_calls: stored as ChatCompletionMessageParam[] & [] } as ChatCompletionMessageParam);
    } else {
      result.push({ role: "assistant", content: turn.content });
    }
  }

  return result;
}

/** Returns summaries of all agent sessions for the given user, newest first. */
export async function listSessions(
  prisma: PrismaClient,
  userId: string,
): Promise<AgentSessionSummary[]> {
  const sessions = await prisma.agentSession.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, createdAt: true },
  });
  return sessions.map((s) => ({
    id: s.id,
    title: s.title,
    createdAt: s.createdAt.toISOString(),
  }));
}

/** Sets the title of an AgentSession. */
export async function setSessionTitle(
  prisma: PrismaClient,
  sessionId: string,
  title: string,
): Promise<void> {
  await prisma.agentSession.update({ where: { id: sessionId }, data: { title } });
}
