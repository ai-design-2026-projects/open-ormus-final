import OpenAI from "openai";
import type { TurnConfig } from "./types";

type OrchestratorParticipant = {
  characterId: string;
  character: { name: string; sheet: unknown };
};

type OrchestratorMessage = {
  character: { name: string };
  content: string;
};

export async function selectNextSpeakerWithOrchestrator(
  participants: OrchestratorParticipant[],
  messages: OrchestratorMessage[],
  config: TurnConfig
): Promise<string> {
  if (!config.model) {
    console.error("[orchestrator] model not set in TurnConfig");
    return fallback(participants, messages);
  }

  const charactersList = participants
    .map(
      (p) =>
        `- id: ${p.characterId} | Name: ${p.character.name}` +
        (p.character.sheet != null
          ? ` | Character sheet: ${JSON.stringify(p.character.sheet)}`
          : "")
    )
    .join("\n");

  const historyText =
    messages.length > 0
      ? messages.map((m) => `[${m.character.name}]: ${m.content}`).join("\n")
      : "(The scene has just begun — no lines have been spoken yet.)";

  const userMessage = [
    "Characters:",
    charactersList,
    "",
    "Conversation so far:",
    historyText,
    "",
    "Which character should speak next? Reply with their characterId only.",
  ].join("\n");

  try {
    const client = new OpenAI({
      baseURL: `${config.baseURL}/v1`,
      apiKey: config.apiKey,
    });

    const response = await client.chat.completions.create({
      model: config.model,
      max_tokens: 64,
      messages: [
        {
          role: "system",
          content:
            "You are a conversation director for a multi-character roleplay scene. " +
            "Given the characters and conversation history below, decide which character " +
            "should speak next to make the conversation feel natural and engaging. " +
            "Reply with only the characterId of the chosen character, nothing else.",
        },
        { role: "user", content: userMessage },
      ],
    });

    const chosen = (response.choices[0]?.message.content ?? "").trim();

    if (participants.some((p) => p.characterId === chosen)) {
      return chosen;
    }

    console.error(`[orchestrator] Invalid characterId returned: "${chosen}"`);
    return fallback(participants, messages);
  } catch (err) {
    console.error("[orchestrator] Error:", err);
    return fallback(participants, messages);
  }
}

function fallback(
  participants: OrchestratorParticipant[],
  messages: OrchestratorMessage[]
): string {
  if (participants.length === 0) throw new Error("[orchestrator] fallback called with empty participants");
  const p = participants[messages.length % participants.length];
  if (p === undefined) throw new Error("[orchestrator] fallback index out of range");
  return p.characterId;
}
