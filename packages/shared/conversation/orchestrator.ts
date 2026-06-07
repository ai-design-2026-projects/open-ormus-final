import OpenAI from "openai";
import type { TurnConfig, RawUsageMeta } from "./types";
import { buildOrchestratorSystemPrompt, buildOrchestratorUserMessage } from "./prompts/orchestrator";
import type { OrchestratorParticipant, OrchestratorMessage } from "./prompts/orchestrator";

export async function selectNextSpeakerWithOrchestrator(
  participants: OrchestratorParticipant[],
  messages: OrchestratorMessage[],
  config: TurnConfig,
): Promise<{ characterId: string; usage: RawUsageMeta | null }> {
  if (!config.model) {
    console.error("[orchestrator] model not set in TurnConfig");
    return { characterId: fallback(participants, messages), usage: null };
  }

  try {
    const client = new OpenAI({
      baseURL: `${config.baseURL}/v1`,
      apiKey: config.apiKey,
    });

    const startTime = Date.now();
    const { data: response, response: httpResponse } = await client.chat.completions
      .create({
        model: config.model,
        max_tokens: 64,
        messages: [
          { role: "system", content: buildOrchestratorSystemPrompt() },
          { role: "user", content: buildOrchestratorUserMessage(participants, messages) },
        ],
      })
      .withResponse();

    const chosen = (response.choices[0]?.message.content ?? "").trim();
    const generationId = httpResponse.headers.get("x-generation-id") ?? response.id;
    const usage: RawUsageMeta | null = response.usage
      ? {
          generationId,
          model: config.model,
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
          reasoningTokens: response.usage.completion_tokens_details?.reasoning_tokens ?? null,
          cachedTokens: response.usage.prompt_tokens_details?.cached_tokens ?? null,
          latencyMs: Date.now() - startTime,
        }
      : null;

    if (participants.some((p) => p.characterId === chosen)) {
      return { characterId: chosen, usage };
    }

    const validIds = participants.map((p) => p.characterId).join(", ");
    console.error(`[orchestrator] Invalid characterId returned: "${chosen}" (expected one of: ${validIds})`);
    return { characterId: fallback(participants, messages), usage };
  } catch (err) {
    console.error("[orchestrator] Error:", err);
    return { characterId: fallback(participants, messages), usage: null };
  }
}

function fallback(
  participants: OrchestratorParticipant[],
  messages: OrchestratorMessage[],
): string {
  if (participants.length === 0) throw new Error("[orchestrator] fallback called with empty participants");
  const p = participants[messages.length % participants.length];
  if (p === undefined) throw new Error("[orchestrator] fallback index out of range");
  return p.characterId;
}
