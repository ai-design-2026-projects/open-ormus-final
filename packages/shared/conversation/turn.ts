import OpenAI from "openai";
import type { ChatCompletionCreateParamsStreaming } from "openai/resources/chat/completions";
import { CharacterSearchResultSchema } from "../schema/character_search";
import { parseEmotionBlock } from "../schema/emotion";
import type { TurnParticipant, TurnMessage, TurnConfig, TurnResult, TurnEvent, TurnStrategy } from "./types";
import type { Emotion } from "./types";
import { selectNextSpeakerWithOrchestrator } from "./orchestrator";
import { buildCharacterMessages } from "./build-messages";
import { buildCharacterPrompt } from "./prompts/index";

export class ConversationError extends Error {
  constructor(
    public readonly code: "LITELLM_ERROR" | "NOT_FOUND" | "NO_PARTICIPANTS" | "ENV_MISSING",
    message: string,
  ) {
    super(message);
    this.name = "ConversationError";
  }
}

const FALLBACK_EMOTION: Emotion = { emotion: "Joy", intensity: "low", subtext: "" };
const REASONING_TAG = "<|reasoning|>";
const EMOTION_TAG = "<|emotion|>";

export async function* generateTurn(
  input: {
    participants: TurnParticipant[];
    messages: TurnMessage[];
    context: string;
    turnStrategy: TurnStrategy;
  },
  config: TurnConfig,
  signal?: AbortSignal,
  onEmotion?: (emotion: Emotion) => void,
): AsyncGenerator<TurnEvent, TurnResult> {
  let nextParticipant: TurnParticipant;

  if (input.turnStrategy === "ORCHESTRATOR") {
    const characterId = await selectNextSpeakerWithOrchestrator(
      input.participants,
      input.messages,
      config,
    );
    const found = input.participants.find((p) => p.characterId === characterId);
    if (!found) {
      console.error(
        `[generateTurn] orchestrator returned unknown characterId "${characterId}" — falling back to round-robin`,
      );
    }
    nextParticipant =
      found ??
      input.participants[input.messages.length % input.participants.length]!;
  } else {
    nextParticipant =
      input.participants[input.messages.length % input.participants.length]!;
  }

  const sheet = CharacterSearchResultSchema.parse(nextParticipant.character.sheet);

  const otherNames = input.participants
    .filter((p) => p.characterId !== nextParticipant.characterId)
    .map((p) => p.character.name);

  const systemPrompt = buildCharacterPrompt(sheet, input.context, otherNames);

  const client = new OpenAI({
    baseURL: `${config.baseURL}/v1`,
    apiKey: config.apiKey,
  });

  const contentMessages = buildCharacterMessages(
    input.messages,
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
        model: config.model,
        max_tokens: 768,
        stream: true,
        temperature: config.temperature,
        messages: [
          { role: "system" as const, content: systemPrompt },
          ...contentMessages,
        ],
        extra_headers: {
          "HTTP-Referer": "https://openormus.app",
          "X-Title": "OpenOrmus",
        },
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
    console.error(`[generateTurn] empty content from LLM`);
  }

  return {
    characterId: nextParticipant.characterId,
    characterName: nextParticipant.character.name,
    content,
    reasoning: reasoningText || null,
    emotion: parsedEmotion ?? FALLBACK_EMOTION,
  };
}
