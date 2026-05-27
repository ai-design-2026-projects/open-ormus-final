// frontend/lib/conversation/next.ts
// Thin DB wrapper around generateTurn from @open-ormus/shared.
// Reads conversation state from Prisma, delegates to the core, writes the result back.
import { prisma } from "@/lib/prisma";
import { generateTurn, ConversationError } from "@open-ormus/shared";
import type { TurnEvent, TurnResult } from "@open-ormus/shared";
import type { Emotion } from "@open-ormus/shared";

export { ConversationError };
export type { TurnEvent };

// Yields TurnEvent items while the core generates the turn.
// Saves the completed message (content + reasoning + emotion) to DB before returning.
// Throws ConversationError on any failure — no message is saved on error.
export async function* generateNextTurnStream(
  conversationId: string,
  userId: string,
  signal?: AbortSignal,
  onEmotion?: (emotion: Emotion) => void,
): AsyncGenerator<TurnEvent> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    include: {
      participants: {
        include: { character: true },
        orderBy: { turnOrder: "asc" },
      },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { character: { select: { name: true } } },
      },
    },
  });

  if (!conversation) throw new ConversationError("NOT_FOUND", "Conversation not found");
  if (conversation.participants.length === 0) throw new ConversationError("NO_PARTICIPANTS", "No participants");

  const model = process.env["CONVERSATION_MODEL"];
  if (!model) throw new ConversationError("ENV_MISSING", "CONVERSATION_MODEL env var not set");

  // LLM_BASE_URL includes /v1 (e.g. "http://localhost:11434/v1").
  // turn.ts appends /v1 to config.baseURL, so we strip the suffix here.
  const rawBaseURL = process.env["LLM_BASE_URL"] ?? "http://localhost:11434/v1";
  const baseURL = rawBaseURL.replace(/\/v1\/?$/, "");

  const config = {
    model,
    baseURL,
    apiKey: process.env["LLM_API_KEY"] ?? "",
  };

  let result: TurnResult;

  const gen = generateTurn(
    {
      participants: conversation.participants,
      messages: conversation.messages,
      context: conversation.context,
      turnStrategy: conversation.turnStrategy,
    },
    config,
    signal,
    onEmotion,
  );

  // Forward all TurnEvent yields to the caller, then collect the return value.
  while (true) {
    const { value, done } = await gen.next();
    if (done) {
      result = value as TurnResult;
      break;
    }
    yield value as TurnEvent;
  }

  await prisma.message.create({
    data: {
      conversationId,
      characterId: result.characterId,
      content: result.content,
      reasoning: result.reasoning,
      emotion: result.emotion.emotion,
      intensity: result.emotion.intensity,
      subtext: result.emotion.subtext,
    },
  });
}
