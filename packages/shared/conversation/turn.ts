import OpenAI from "openai";
import type { ChatCompletionCreateParamsStreaming } from "openai/resources/chat/completions";
import { CharacterSearchResultSchema } from "../schema/character_search";
import { parseEmotionBlock } from "../schema/emotion";
import type { TurnParticipant, TurnMessage, TurnConfig, TurnResult, TurnEvent, TurnStrategy, RawUsageMeta } from "./types";
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
  let orchestratorUsage: RawUsageMeta | null = null;

  if (input.turnStrategy === "ORCHESTRATOR") {
    const result = await selectNextSpeakerWithOrchestrator(
      input.participants,
      input.messages,
      config,
    );
    orchestratorUsage = result.usage;
    const found = input.participants.find((p) => p.characterId === result.characterId);
    if (!found) {
      throw new ConversationError("LITELLM_ERROR", `Orchestrator returned unknown characterId "${result.characterId}"`);
    }
    nextParticipant = found;
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
  let streamGenerationId = "";
  let streamUsage: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } } | null = null;
  const llmStartTime = Date.now();

  yield { type: "thinking" };

  try {
    const { data: stream, response: httpResponse } = await client.chat.completions.create(
      {
        model: config.model,
        max_tokens: 768,
        stream: true,
        stream_options: { include_usage: true },
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
    ).withResponse();

    const headerGenerationId = httpResponse.headers.get("x-generation-id");
    if (headerGenerationId) streamGenerationId = headerGenerationId;

    let rawBuffer = "";
    let parserState:
      | "pre_reasoning"
      | "in_reasoning"
      | "pre_emotion"
      | "in_emotion"
      | "dialogue" = "pre_reasoning";

    for await (const chunk of stream) {
      if (!streamGenerationId && chunk.id) streamGenerationId = chunk.id;
      if (chunk.usage) streamUsage = chunk.usage;

      const token = chunk.choices[0]?.delta.content;
      if (!token) continue;

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
          if (parsedEmotion === null) {
            throw new ConversationError("LITELLM_ERROR", `Failed to parse emotion block: ${emotionJson}`);
          }
          onEmotion?.(parsedEmotion);
          parserState = "dialogue";
          yield { type: "thinking_done" };
          if (rest) {
            content += rest;
            yield { type: "token", text: rest };
          }
        }
      }
    }

    if (parserState !== "dialogue" && rawBuffer) {
      content += rawBuffer;
    }

    if (parsedEmotion === null) {
      const snippet = rawBuffer.slice(0, 300).replace(/\n/g, "\\n");
      throw new ConversationError(
        "LITELLM_ERROR",
        `No emotion block found in LLM response (parser stopped at: ${parserState}; tail: "${snippet}")`,
      );
    }
  } catch (err) {
    if (err instanceof ConversationError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new ConversationError("LITELLM_ERROR", `Content stream error: ${msg}`);
  }

  if (!content) {
    throw new ConversationError("LITELLM_ERROR", "Empty content from LLM");
  }

  const characterUsage: RawUsageMeta | null = streamUsage
    ? {
        generationId: streamGenerationId,
        model: config.model,
        inputTokens: streamUsage.prompt_tokens ?? 0,
        outputTokens: streamUsage.completion_tokens ?? 0,
        reasoningTokens: streamUsage.completion_tokens_details?.reasoning_tokens ?? null,
        cachedTokens: streamUsage.prompt_tokens_details?.cached_tokens ?? null,
        latencyMs: Date.now() - llmStartTime,
      }
    : null;

  return {
    characterId: nextParticipant.characterId,
    characterName: nextParticipant.character.name,
    content,
    reasoning: reasoningText || null,
    emotion: parsedEmotion,
    characterUsage,
    orchestratorUsage,
  };
}
