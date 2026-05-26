// frontend/lib/conversation/next.ts
import OpenAI from "openai";
import type { ChatCompletionCreateParamsStreaming } from "openai/resources/chat/completions";
import { prisma } from "@/lib/prisma";
import { selectNextSpeakerWithOrchestrator } from "@/lib/orchestrator";
import { buildCharacterPrompt } from "@/lib/prompts";
import { CharacterSearchResultSchema, parseEmotionBlock, type Emotion } from "@open-ormus/shared";
import { buildCharacterMessages } from "./build-messages";

export class ConversationError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "NO_PARTICIPANTS" | "ENV_MISSING" | "LITELLM_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "ConversationError";
  }
}

export type TurnEvent =
  | { type: "token"; text: string }
  | { type: "thinking" }
  | { type: "thinking_done" };

const FALLBACK_EMOTION: Emotion = { emotion: "Joy", intensity: "low", subtext: "" };
const REASONING_TAG = "<|reasoning|>";
const EMOTION_TAG = "<|emotion|>";

// Yields TurnEvent items: thinking/thinking_done bracket the reasoning+emotion
// parsing phase, then token events stream the character's dialogue.
// Saves the completed message (content + extracted reasoning + emotion) to DB.
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

  let nextParticipant: (typeof conversation.participants)[number];

  if (conversation.turnStrategy === "ORCHESTRATOR") {
    const characterId = await selectNextSpeakerWithOrchestrator(
      conversation.participants,
      conversation.messages,
    );
    const found = conversation.participants.find((p) => p.characterId === characterId);
    if (!found) {
      console.error(
        `[generateNextTurnStream] orchestrator returned unknown characterId "${characterId}" — falling back to round-robin`,
      );
    }
    nextParticipant =
      found ??
      conversation.participants[
        conversation.messages.length % conversation.participants.length
      ]!;
  } else {
    nextParticipant =
      conversation.participants[
        conversation.messages.length % conversation.participants.length
      ]!;
  }

  const sheet = CharacterSearchResultSchema.parse(nextParticipant.character.sheet);

  const otherNames = conversation.participants
    .filter((p) => p.characterId !== nextParticipant.characterId)
    .map((p) => p.character.name);

  const systemPrompt = buildCharacterPrompt(sheet, conversation.context, otherNames);

  const client = new OpenAI({
    baseURL: `${process.env["ANTHROPIC_BASE_URL"] ?? "http://localhost:4000"}/v1`,
    apiKey: process.env["ANTHROPIC_API_KEY"] ?? "",
  });

  const openrouterHeaders = {
    "HTTP-Referer": "https://openormus.app",
    "X-Title": "OpenOrmus",
    "x-session-id": conversationId,
  };

  const contentMessages = buildCharacterMessages(
    conversation.messages,
    nextParticipant.characterId,
    nextParticipant.character.name,
  );

  let content = "";
  let reasoningText = "";
  let parsedEmotion: Emotion | null = null;

  yield { type: "thinking" };

  try {
    const stream = await client.chat.completions.create(
      {
        model,
        max_tokens: 768,
        stream: true,
        messages: [
          { role: "system" as const, content: systemPrompt },
          ...contentMessages,
        ],
        extra_headers: openrouterHeaders,
        extra_body: { reasoning: { effort: "none" } },
      } as ChatCompletionCreateParamsStreaming,
      { signal },
    );

    let rawBuffer = "";
    let parserState:
      | "pre_reasoning"
      | "in_reasoning"
      | "pre_emotion"
      | "in_emotion"
      | "dialogue" = "pre_reasoning";

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta.content;
      if (!token) continue;

      // Dialogue tokens stream directly — no buffering needed.
      if (parserState === "dialogue") {
        content += token;
        yield { type: "token", text: token };
        continue;
      }

      rawBuffer += token;

      if (parserState === "pre_reasoning") {
        const idx = rawBuffer.indexOf(REASONING_TAG);
        if (idx !== -1) {
          rawBuffer = rawBuffer.slice(idx + REASONING_TAG.length);
          parserState = "in_reasoning";
        } else if (rawBuffer.length > 300) {
          // Model skipped reasoning block — look for emotion directly.
          const emoIdx = rawBuffer.indexOf(EMOTION_TAG);
          if (emoIdx !== -1) {
            rawBuffer = rawBuffer.slice(emoIdx + EMOTION_TAG.length);
            parserState = "in_emotion";
          }
        }
      }

      if (parserState === "in_reasoning") {
        const idx = rawBuffer.indexOf(REASONING_TAG);
        if (idx !== -1) {
          reasoningText = rawBuffer.slice(0, idx).trim();
          rawBuffer = rawBuffer.slice(idx + REASONING_TAG.length);
          parserState = "pre_emotion";
        }
      }

      if (parserState === "pre_emotion") {
        const idx = rawBuffer.indexOf(EMOTION_TAG);
        if (idx !== -1) {
          rawBuffer = rawBuffer.slice(idx + EMOTION_TAG.length);
          parserState = "in_emotion";
        }
      }

      if (parserState === "in_emotion") {
        const idx = rawBuffer.indexOf(EMOTION_TAG);
        if (idx !== -1) {
          const emotionJson = rawBuffer.slice(0, idx);
          const rest = rawBuffer.slice(idx + EMOTION_TAG.length);
          rawBuffer = "";
          parsedEmotion = parseEmotionBlock(`${EMOTION_TAG}${emotionJson}${EMOTION_TAG}`);
          onEmotion?.(parsedEmotion ?? FALLBACK_EMOTION);
          parserState = "dialogue";
          yield { type: "thinking_done" };
          if (rest) {
            content += rest;
            yield { type: "token", text: rest };
          }
        }
      }
    }

    // Flush any remaining buffered content if the parser never reached dialogue state.
    if (parserState !== "dialogue" && rawBuffer) {
      content += rawBuffer;
    }

    if (parsedEmotion === null) {
      onEmotion?.(FALLBACK_EMOTION);
      yield { type: "thinking_done" };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ConversationError("LITELLM_ERROR", `Content stream error: ${msg}`);
  }

  if (!content) {
    console.error(`[generateNextTurnStream] empty content from LLM`);
  }

  const emotionToSave = parsedEmotion ?? FALLBACK_EMOTION;

  await prisma.message.create({
    data: {
      conversationId,
      characterId: nextParticipant.characterId,
      content,
      reasoning: reasoningText || null,
      emotion: emotionToSave.emotion,
      intensity: emotionToSave.intensity,
      subtext: emotionToSave.subtext,
    },
  });
}
