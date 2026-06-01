import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export type OrchestratorParticipant = {
  characterId: string;
  character: { name: string };
};

export type OrchestratorMessage = {
  characterId: string;
  character: { name: string };
  content: string;
  reasoning: string | null;
};

const SCENE_START =
  "(The scene has just begun — no lines have been spoken yet.) Who should speak first? Reply with their characterId only.";
const WHO_NEXT = "Who speaks next? Reply with their characterId only.";

export function buildOrchestratorSystemPrompt(
  participants: OrchestratorParticipant[],
): string {
  // Sheets intentionally omitted — name and id are sufficient for turn selection,
  // and including them would bloat the stable system prompt.
  const charactersList = participants
    .map((p) => `- id: ${p.characterId} | Name: ${p.character.name}`)
    .join("\n");

  return [
    "You are a conversation director for a multi-character roleplay scene.",
    "Given the conversation history in the messages, decide which character should speak",
    "next to make the conversation feel natural and engaging.",
    "Reply with only the characterId of the chosen character, nothing else.",
    "",
    "Characters:",
    charactersList,
  ].join("\n");
}

function buildUserTurn(message: OrchestratorMessage): string {
  const lines: string[] = [`[${message.character.name}]: ${message.content}`];
  if (message.reasoning) {
    lines.push(`Private thoughts: ${message.reasoning}`);
  }
  lines.push(WHO_NEXT);
  return lines.join("\n");
}

export function buildOrchestratorMessages(
  messages: OrchestratorMessage[],
): ChatCompletionMessageParam[] {
  const result: ChatCompletionMessageParam[] = [];

  if (messages.length === 0) {
    result.push({ role: "user", content: SCENE_START });
    return result;
  }

  // Turn 0: scene start → first speaker
  result.push({ role: "user", content: SCENE_START });
  result.push({ role: "assistant", content: messages[0]!.characterId });

  // Historical pairs: message[i] was spoken → messages[i+1].characterId was chosen next
  for (let i = 0; i < messages.length - 1; i++) {
    result.push({ role: "user", content: buildUserTurn(messages[i]!) });
    result.push({ role: "assistant", content: messages[i + 1]!.characterId });
  }

  // Final uncached user message — what the model must respond to now
  result.push({
    role: "user",
    content: buildUserTurn(messages[messages.length - 1]!),
  });

  return result;
}
