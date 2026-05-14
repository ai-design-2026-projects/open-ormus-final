import type { PrismaClient } from "@/lib/generated/prisma/client";
import { Prisma } from "@/lib/generated/prisma/client";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

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
 * Loads all turns for a session as Claude SDK MessageParam objects.
 * Tool calls stored in JSON are rehydrated into content arrays.
 */
export async function getSessionMessages(
  prisma: PrismaClient,
  sessionId: string,
  userId: string,
): Promise<MessageParam[]> {
  const session = await prisma.agentSession.findFirst({
    where: { id: sessionId, userId },
    include: { turns: { orderBy: { createdAt: "asc" } } },
  });

  if (!session) return [];

  return session.turns.map((turn) => {
    if (turn.role === "user") {
      return { role: "user" as const, content: turn.content };
    }
    const blocks = turn.toolCalls as unknown;
    if (Array.isArray(blocks) && blocks.length > 0) {
      return { role: "assistant" as const, content: blocks as MessageParam["content"] };
    }
    return { role: "assistant" as const, content: turn.content };
  });
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
