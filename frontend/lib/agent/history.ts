import type { PrismaClient } from "@/lib/generated/prisma/client";
import { Prisma } from "@/lib/generated/prisma/client";
import type { AgentInputItem } from "@openai/agents";

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

/** Extracts a text body from an SDK item for the denormalised `content` column. */
function extractText(item: AgentInputItem): string {
  const content = (item as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      })
      .join("");
  }
  return "";
}

/** Maps SDK items to AgentTurn rows. `item` is the source of truth; `content`/`role` are denormalised. */
export function itemsToRows(
  sessionId: string,
  items: AgentInputItem[],
): { sessionId: string; role: string; content: string; item: Prisma.InputJsonValue }[] {
  return items.map((item) => {
    const record = item as { role?: unknown; type?: unknown };
    const role =
      typeof record.role === "string"
        ? record.role
        : typeof record.type === "string"
          ? record.type
          : "item";
    return {
      sessionId,
      role,
      content: extractText(item),
      item: item as Prisma.InputJsonValue,
    };
  });
}

/** Reconstructs SDK items from rows. `item` is authoritative; rows without it are skipped. */
export function rowsToItems(
  rows: { role: string; content: string; item: unknown }[],
): AgentInputItem[] {
  return rows
    .filter((row) => row.item != null)
    .map((row) => row.item as AgentInputItem);
}

/** Persists all new SDK items from a completed agent turn. */
export async function appendTurns(
  prisma: PrismaClient,
  sessionId: string,
  newItems: AgentInputItem[],
): Promise<void> {
  const data = itemsToRows(sessionId, newItems);

  if (data.length === 0) return;

  // Lock the session row for the duration of the insert so concurrent appends
  // to the same session serialize. Without this, two parallel createMany calls
  // can interleave the global `seq` sequence and scramble message order on
  // reload. Different sessions never block each other (distinct lock targets).
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM agent_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
    await tx.agentTurn.createMany({ data });
  });
}

/** Loads all turns for a session as SDK AgentInputItem objects, ordered by seq. */
export async function getSessionMessages(
  prisma: PrismaClient,
  sessionId: string,
  userId: string,
): Promise<AgentInputItem[]> {
  const session = await prisma.agentSession.findFirst({
    where: { id: sessionId, userId },
    include: { turns: { orderBy: { seq: "asc" } } },
  });

  if (!session) return [];

  return rowsToItems(
    session.turns.map((t) => ({ role: t.role, content: t.content, item: t.item })),
  );
}

/** Returns summaries of all agent sessions for the given user, newest first. */
export async function listSessions(
  prisma: PrismaClient,
  userId: string,
): Promise<AgentSessionSummary[]> {
  const sessions = await prisma.agentSession.findMany({
    where: { userId, turns: { some: {} } },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, createdAt: true },
  });
  return sessions.map((s) => ({
    id: s.id,
    title: s.title,
    createdAt: s.createdAt.toISOString(),
  }));
}

/** Deletes an AgentSession (turns cascade via DB). */
export async function deleteSession(
  prisma: PrismaClient,
  sessionId: string,
  userId: string,
): Promise<void> {
  await prisma.agentSession.deleteMany({ where: { id: sessionId, userId } });
}

/** Sets the title of an AgentSession. */
export async function setSessionTitle(
  prisma: PrismaClient,
  sessionId: string,
  title: string,
): Promise<void> {
  await prisma.agentSession.update({ where: { id: sessionId }, data: { title } });
}
