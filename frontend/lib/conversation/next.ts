// frontend/lib/conversation/next.ts
import { prisma } from "@/lib/prisma";
import { selectNextSpeakerWithOrchestrator } from "@/lib/orchestrator";
import { buildCharacterPrompt, buildReasoningSystemPrompt, buildReasoningUserMessage } from "@/lib/prompts";
import { CharacterSearchResultSchema, parseEmotionBlock, type Emotion } from "@open-ormus/shared";
import { buildHistoryLine } from "./parse-turn";

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

type LiteLLMDelta = { type?: string; text?: string };
type LiteLLMEvent = { type: string; delta?: LiteLLMDelta };

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

  const baseUrl = process.env["ANTHROPIC_BASE_URL"] ?? "http://localhost:4000";
  const apiKey = process.env["ANTHROPIC_API_KEY"] ?? "";

  // ── Call 1: reasoning (non-streaming) ──────────────────────────────────────
  yield { type: "thinking" };

  const reasoningResponse = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    signal: signal ?? null,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 256,
      stream: false,
      system: buildReasoningSystemPrompt(),
      messages: [
        {
          role: "user",
          content: buildReasoningUserMessage(sheet, historyText, nextParticipant.character.name),
        },
      ],
    }),
  });

  if (!reasoningResponse.ok) {
    const text = await reasoningResponse.text();
    throw new ConversationError("LITELLM_ERROR", `LiteLLM reasoning error: ${text}`);
  }

  const reasoningCompletion = (await reasoningResponse.json()) as {
    content?: { type: string; text: string }[];
  };
  const reasoning = reasoningCompletion.content?.find((b) => b.type === "text")?.text ?? "";

  yield { type: "thinking_done" };

  // ── Call 2: content (streaming) ─────────────────────────────────────────────
  const contentSystemPrompt = reasoning
    ? `${systemPrompt}\n\n[Your private thoughts before this response — use as context, do not repeat or quote]\n${reasoning}`
    : systemPrompt;

  const contentUserMessage = `Conversation so far:\n${historyText}\n\nNow continue as ${nextParticipant.character.name}. Write only their next line.`;

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    signal: signal ?? null,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Accept": "text/event-stream",
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      stream: true,
      system: contentSystemPrompt,
      messages: [{ role: "user", content: contentUserMessage }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ConversationError("LITELLM_ERROR", `LiteLLM error: ${text}`);
  }

  let content = "";
  const contentType = response.headers.get("content-type") ?? "";
  console.log(`[generateNextTurnStream] content-type: "${contentType}"`);

  let parsedEmotion: Emotion | null = null;

  if (!contentType.includes("text/event-stream")) {
    console.log("[generateNextTurnStream] path: JSON (no streaming from LiteLLM)");
    const completion = (await response.json()) as {
      content?: { type: string; text: string }[];
    };
    const rawContent = completion.content?.find((b) => b.type === "text")?.text ?? "";
    parsedEmotion = parseEmotionBlock(rawContent);
    onEmotion?.(parsedEmotion ?? FALLBACK_EMOTION);
    const dialogueMatch = rawContent.match(/<dialogue>([\s\S]*?)<\/dialogue>/);
    content = dialogueMatch?.[1]?.trim() ?? rawContent;
    if (content) yield { type: "token", text: content };
  } else {
    console.log("[generateNextTurnStream] path: SSE streaming");
    if (!response.body) throw new ConversationError("LITELLM_ERROR", "LiteLLM response body is null");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Two-phase parser state
    let rawBuffer = "";
    let parserState: "buffering" | "awaiting_open" | "dialogue" = "buffering";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        let parsed: unknown;
        try { parsed = JSON.parse(data); } catch { continue; }
        if (typeof parsed !== "object" || parsed === null) continue;

        const obj = parsed as Record<string, unknown>;
        let token: string | undefined;

        if (obj["type"] === "content_block_delta") {
          const event = parsed as LiteLLMEvent;
          if (event.delta?.type === "text_delta" && typeof event.delta.text === "string") {
            token = event.delta.text;
          }
        } else {
          const choices = obj["choices"] as Array<{ delta?: { content?: string } }> | undefined;
          const t = choices?.[0]?.delta?.content;
          if (typeof t === "string" && t) token = t;
        }

        if (!token) continue;
        rawBuffer += token;

        if (parserState === "buffering") {
          const emotionEndIdx = rawBuffer.indexOf("</emotion>");
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
    }

    if (parsedEmotion === null) onEmotion?.(FALLBACK_EMOTION);
  }

  // Strip </dialogue> closing tag that may have been streamed into content
  content = content.replace(/<\/dialogue>[\s\S]*$/, "").trim();

  if (!content) {
    console.error(`[generateNextTurnStream] empty content from LiteLLM (content-type: ${contentType})`);
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
