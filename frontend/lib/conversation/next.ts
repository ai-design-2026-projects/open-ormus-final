// frontend/lib/conversation/next.ts
import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming, ChatCompletionCreateParamsStreaming } from "openai/resources/chat/completions";
import { prisma } from "@/lib/prisma";
import { selectNextSpeakerWithOrchestrator } from "@/lib/orchestrator";
import { buildCharacterPrompt, buildReasoningSystemPrompt, buildReasoningUserMessage } from "@/lib/prompts";
import { CharacterSearchResultSchema, parseEmotionBlock, type Emotion } from "@open-ormus/shared";
import { buildHistoryLine } from "./parse-turn";
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

// Yields TurnEvent items: thinking/thinking_done bracket the reasoning call,
// then token events stream the character's spoken message.
// Saves the completed message (content + reasoning) to DB before returning.
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

  if (conversation.participants.length >= 3) {
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
  const systemPrompt = buildCharacterPrompt(sheet, conversation.context);

  const historyText =
    conversation.messages.length > 0
      ? conversation.messages
          .map((m) =>
            buildHistoryLine(
              m.character.name,
              m.content,
              m.emotion,
              m.intensity,
              m.subtext,
            ),
          )
          .join("\n")
      : "(The scene has just begun — no lines have been spoken yet.)";

  const client = new OpenAI({
    baseURL: `${process.env["ANTHROPIC_BASE_URL"] ?? "http://localhost:4000"}/v1`,
    apiKey: process.env["ANTHROPIC_API_KEY"] ?? "",
  });

  // Headers forwarded by LiteLLM to the downstream provider (OpenRouter).
  // extra_body.extra_headers is the LiteLLM mechanism for provider header passthrough.
  const openrouterHeaders = {
    "HTTP-Referer": "https://openormus.app",
    "X-Title": "OpenOrmus",
    "x-session-id": conversationId,
  };

  // ── Call 1: reasoning (non-streaming) ──────────────────────────────────────
  yield { type: "thinking" };

  let reasoning = "";
  try {
    const reasoningCompletion = await client.chat.completions.create(
      {
        model,
        max_tokens: 256,
        messages: [
          { role: "system", content: buildReasoningSystemPrompt() },
          { role: "user", content: buildReasoningUserMessage(sheet, historyText, nextParticipant.character.name) },
        ],
        extra_headers: openrouterHeaders,
      } as ChatCompletionCreateParamsNonStreaming,
      { signal },
    );
    reasoning = reasoningCompletion.choices[0]?.message.content ?? "";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ConversationError("LITELLM_ERROR", `Reasoning error: ${msg}`);
  }

  yield { type: "thinking_done" };

  // ── Call 2: content (streaming) ─────────────────────────────────────────────
  const contentMessages = buildCharacterMessages(
    conversation.messages,
    nextParticipant.characterId,
    nextParticipant.character.name,
    reasoning,
  );

  let content = "";
  let parsedEmotion: Emotion | null = null;

  try {
    const stream = await client.chat.completions.create(
      {
        model,
        max_tokens: 512,
        stream: true,
        messages: [
          { role: "system" as const, content: systemPrompt },
          ...contentMessages,
        ],
        extra_headers: openrouterHeaders,
      } as ChatCompletionCreateParamsStreaming,
      { signal },
    );

    // Two-phase parser: buffer until emotion block resolved, then stream dialogue tokens
    let rawBuffer = "";
    let parserState: "buffering" | "awaiting_open" | "dialogue" = "buffering";

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta.content;
      if (!token) continue;

      rawBuffer += token;

      if (parserState === "buffering") {
        const emotionEndIdx = rawBuffer.indexOf("</emotion>");
        const dialogueDirectIdx = rawBuffer.indexOf("<dialogue>");
        if (emotionEndIdx !== -1) {
          parsedEmotion = parseEmotionBlock(rawBuffer.slice(0, emotionEndIdx + 10));
          onEmotion?.(parsedEmotion ?? FALLBACK_EMOTION);
          const rest = rawBuffer.slice(emotionEndIdx + 10);
          const dialogueOpenIdx = rest.indexOf("<dialogue>");
          if (dialogueOpenIdx !== -1) {
            parserState = "dialogue";
            const initial = rest.slice(dialogueOpenIdx + 10);
            if (initial) { content += initial; yield { type: "token", text: initial }; }
          } else {
            parserState = "awaiting_open";
          }
        } else if (dialogueDirectIdx !== -1) {
          // Model omitted </emotion> — extract emotion from everything before <dialogue>
          parsedEmotion = parseEmotionBlock(rawBuffer.slice(0, dialogueDirectIdx) + "</emotion>");
          onEmotion?.(parsedEmotion ?? FALLBACK_EMOTION);
          parserState = "dialogue";
          const initial = rawBuffer.slice(dialogueDirectIdx + 10);
          if (initial) { content += initial; yield { type: "token", text: initial }; }
        } else if (rawBuffer.length > 200) {
          onEmotion?.(FALLBACK_EMOTION);
          parserState = "dialogue";
          content += rawBuffer;
          yield { type: "token", text: rawBuffer };
        }
      } else if (parserState === "awaiting_open") {
        const dialogueOpenIdx = rawBuffer.indexOf("<dialogue>");
        if (dialogueOpenIdx !== -1) {
          parserState = "dialogue";
          const initial = rawBuffer.slice(dialogueOpenIdx + 10);
          if (initial) { content += initial; yield { type: "token", text: initial }; }
        }
      } else if (parserState === "dialogue") {
        content += token;
        yield { type: "token", text: token };
      }
    }

    if (parsedEmotion === null) onEmotion?.(FALLBACK_EMOTION);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ConversationError("LITELLM_ERROR", `Content stream error: ${msg}`);
  }

  // Strip </dialogue> closing tag that may have been streamed into content
  content = content.replace(/<\/dialogue>[\s\S]*$/, "").trim();

  if (!content) {
    console.error(`[generateNextTurnStream] empty content from LLM`);
  }

  const emotionToSave = parsedEmotion ?? FALLBACK_EMOTION;

  await prisma.message.create({
    data: {
      conversationId,
      characterId: nextParticipant.characterId,
      content,
      reasoning: reasoning || null,
      emotion: emotionToSave.emotion,
      intensity: emotionToSave.intensity,
      subtext: emotionToSave.subtext,
    },
  });
}
