import { createLLMClient } from "@/lib/llm-client";
import { logLlmUsage } from "@/lib/llm-usage";
import { LlmUsageSource } from "@/lib/generated/prisma/client";
import {
  buildOrchestratorSystemPrompt,
  buildOrchestratorMessages,
  type OrchestratorParticipant,
  type OrchestratorMessage,
} from "@/lib/conversation/build-orchestrator-messages";

export type { OrchestratorParticipant, OrchestratorMessage };

export async function selectNextSpeakerWithOrchestrator(
  participants: OrchestratorParticipant[],
  messages: OrchestratorMessage[],
  conversationId: string,
  userId: string,
): Promise<string> {
  const model = process.env["CONVERSATION_MODEL"];

  if (!model) {
    console.error("[orchestrator] CONVERSATION_MODEL env var not set");
    return fallback(participants, messages);
  }

  const systemPrompt = buildOrchestratorSystemPrompt(participants);
  const turnMessages = buildOrchestratorMessages(messages);

  const client = createLLMClient();
  const startTime = Date.now();

  type CompletionResponse = Awaited<ReturnType<typeof client.chat.completions.create>>;
  let response: CompletionResponse;
  let generationId: string;

  try {
    const { data, response: httpResponse } = await client.chat.completions
      .create({
        model,
        max_tokens: 64,
        messages: [{ role: "system", content: systemPrompt }, ...turnMessages],
      })
      .withResponse();
    response = data;
    generationId = httpResponse.headers.get("x-generation-id") ?? data.id;
  } catch (err) {
    console.error("[orchestrator] Error:", err);
    return fallback(participants, messages);
  }

  const cachedTokens = response.usage?.prompt_tokens_details?.cached_tokens;
  const reasoningTokens = response.usage?.completion_tokens_details?.reasoning_tokens;
  await logLlmUsage(
    { source: LlmUsageSource.ORCHESTRATOR, conversationId, userId },
    {
      generationId,
      model,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      ...(cachedTokens !== undefined ? { cachedTokens } : {}),
      ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
      latencyMs: Date.now() - startTime,
    },
  );

  const chosen = (response.choices[0]?.message.content ?? "").trim();

  if (participants.some((p) => p.characterId === chosen)) {
    return chosen;
  }

  console.error(`[orchestrator] Invalid characterId returned: "${chosen}"`);
  return fallback(participants, messages);
}

function fallback(
  participants: OrchestratorParticipant[],
  messages: OrchestratorMessage[],
): string {
  if (participants.length === 0)
    throw new Error("[orchestrator] fallback called with empty participants");
  const p = participants[messages.length % participants.length];
  if (p === undefined)
    throw new Error("[orchestrator] fallback index out of range");
  return p.characterId;
}
