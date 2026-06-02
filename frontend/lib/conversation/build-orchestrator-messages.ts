import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export type OrchestratorParticipant = {
  characterId: string | null;
  isUserParticipant: boolean;
  userDisplayName?: string | undefined;
  character: { name: string } | null;
};

export type OrchestratorMessage = {
  characterId: string | null;
  authorUserId?: string | null;
  character: { name: string } | null;
  authorName?: string | null;
  content: string;
  reasoning: string | null;
};

const SCENE_START =
  "(The scene has just begun — no lines have been spoken yet.) Who should speak first? Reply with their characterId only.";
const WHO_NEXT = "Who speaks next? Reply with their characterId, or 'user' if the human player should speak.";

export function buildOrchestratorSystemPrompt(
  participants: OrchestratorParticipant[],
  excludeUser = false,
): string {
  // Sheets intentionally omitted — name and id are sufficient for turn selection,
  // and including them would bloat the stable system prompt.
  const charactersList = participants
    .map((p) => {
      if (p.isUserParticipant) {
        return `- id: user | Name: ${p.userDisplayName ?? "Player"}`;
      }
      return `- id: ${p.characterId} | Name: ${p.character!.name}`;
    })
    .join("\n");

  const lines = [
    "You are a conversation director for a multi-character roleplay scene.",
    "Given the conversation history in the messages, decide which character should speak",
    "next to make the conversation feel natural and engaging.",
    "Reply with only the characterId of the chosen character, nothing else.",
    "If it is the human player's turn, reply with the word: user",
    "",
    "Characters:",
    charactersList,
  ];
  if (excludeUser) {
    lines.push("", "The human player just skipped their turn. Do NOT select the user this turn.");
  }
  return lines.join("\n");
}

function buildUserTurn(message: OrchestratorMessage): string {
  const speakerName = message.character?.name ?? message.authorName ?? "Unknown";
  const lines: string[] = [`[${speakerName}]: ${message.content}`];
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
  result.push({ role: "assistant", content: messages[0]!.characterId ?? "user" });

  // Historical pairs: message[i] was spoken → messages[i+1].characterId was chosen next
  for (let i = 0; i < messages.length - 1; i++) {
    result.push({ role: "user", content: buildUserTurn(messages[i]!) });
    result.push({ role: "assistant", content: messages[i + 1]!.characterId ?? "user" });
  }

  // Final uncached user message — what the model must respond to now
  result.push({
    role: "user",
    content: buildUserTurn(messages[messages.length - 1]!),
  });

  return result;
}
