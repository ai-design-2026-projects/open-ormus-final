// frontend/lib/conversation/next.ts
import { prisma } from "@/lib/prisma";
import { selectNextSpeakerWithOrchestrator } from "@/lib/orchestrator";
import { buildCharacterPrompt } from "@/lib/prompts";
import { CharacterSearchResultSchema } from "@open-ormus/shared";

export class ConversationError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "NO_PARTICIPANTS" | "ENV_MISSING" | "LITELLM_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "ConversationError";
  }
}

type LiteLLMDelta = { type?: string; text?: string };
type LiteLLMEvent = { type: string; delta?: LiteLLMDelta };

// Yields each text token as it arrives from LiteLLM.
// Saves the completed message to DB before returning.
// Throws if the conversation is not found, has no participants,
// or if CONVERSATION_MODEL / ANTHROPIC_BASE_URL env vars are missing.
export async function* generateNextTurnStream(
  conversationId: string,
  userId: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
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
      ? conversation.messages.map((m) => `[${m.character.name}]: ${m.content}`).join("\n")
      : "(The scene has just begun — no lines have been spoken yet.)";

  const userMessage = `Conversation so far:\n${historyText}\n\nNow continue as ${nextParticipant.character.name}. Write only their next line.`;

  const baseUrl = process.env["ANTHROPIC_BASE_URL"] ?? "http://localhost:4000";
  const apiKey = process.env["ANTHROPIC_API_KEY"] ?? "";

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
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ConversationError("LITELLM_ERROR", `LiteLLM error: ${text}`);
  }

  let content = "";
  const contentType = response.headers.get("content-type") ?? "";
  console.log(`[generateNextTurnStream] content-type: "${contentType}"`);

  if (!contentType.includes("text/event-stream")) {
    // LiteLLM returned a non-streaming JSON response — parse it directly
    console.log("[generateNextTurnStream] path: JSON (no streaming from LiteLLM)");
    const completion = (await response.json()) as {
      content?: { type: string; text: string }[];
    };
    content = completion.content?.find((b) => b.type === "text")?.text ?? "";
    if (content) yield content;
  } else {
    console.log("[generateNextTurnStream] path: SSE streaming");
    if (!response.body) throw new ConversationError("LITELLM_ERROR", "LiteLLM response body is null");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

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
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        if (typeof parsed !== "object" || parsed === null) continue;

        const obj = parsed as Record<string, unknown>;

        // Anthropic SSE format: content_block_delta
        if (obj["type"] === "content_block_delta") {
          const event = parsed as LiteLLMEvent;
          if (event.delta?.type === "text_delta" && typeof event.delta.text === "string") {
            content += event.delta.text;
            yield event.delta.text;
          }
        } else {
          // OpenAI SSE format fallback: choices[0].delta.content
          const choices = obj["choices"] as Array<{ delta?: { content?: string } }> | undefined;
          const token = choices?.[0]?.delta?.content;
          if (typeof token === "string" && token) {
            content += token;
            yield token;
          }
        }
      }
    }
  }

  if (!content) {
    console.error(`[generateNextTurnStream] empty content from LiteLLM (content-type: ${contentType})`);
  }

  await prisma.message.create({
    data: {
      conversationId,
      characterId: nextParticipant.characterId,
      content,
    },
  });
}
