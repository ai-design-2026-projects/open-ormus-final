// frontend/lib/orchestrator.ts

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
  messages: OrchestratorMessage[]
): Promise<string> {
  const model = process.env["CONVERSATION_MODEL"];
  const baseUrl = process.env["ANTHROPIC_BASE_URL"] ?? "http://localhost:4000";
  const apiKey = process.env["ANTHROPIC_API_KEY"] ?? "";

  if (!model) {
    console.error("[orchestrator] CONVERSATION_MODEL env var not set");
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
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 64,
        system:
          "You are a conversation director for a multi-character roleplay scene. " +
          "Given the characters and conversation history below, decide which character " +
          "should speak next to make the conversation feel natural and engaging. " +
          "Reply with only the characterId of the chosen character, nothing else.",
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      console.error(`[orchestrator] LiteLLM error: ${response.status}`);
      return fallback(participants, messages);
    }

    const completion = (await response.json()) as {
      content: { type: string; text: string }[];
    };

    const chosen =
      completion.content.find((b) => b.type === "text")?.text?.trim() ?? "";

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
