import { SCENE_START } from "./index";

export type OrchestratorParticipant = {
  characterId: string;
  character: { name: string; sheet: unknown };
};

export type OrchestratorMessage = {
  character: { name: string };
  content: string;
};

export function buildOrchestratorSystemPrompt(): string {
  return (
    "You are a conversation director for a multi-character roleplay scene. " +
    "Given the characters and conversation history below, decide which character " +
    "should speak next to make the conversation feel natural and engaging. " +
    "Reply with only the characterId of the chosen character, nothing else."
  );
}

export function buildOrchestratorUserMessage(
  participants: OrchestratorParticipant[],
  messages: OrchestratorMessage[],
): string {
  const charactersList = participants
    .map(
      (p) =>
        `- id: ${p.characterId} | Name: ${p.character.name}` +
        (p.character.sheet != null
          ? ` | Character sheet: ${JSON.stringify(p.character.sheet)}`
          : ""),
    )
    .join("\n");

  const historyText =
    messages.length > 0
      ? messages.map((m) => `[${m.character.name}]: ${m.content}`).join("\n")
      : SCENE_START;

  return [
    "Characters:",
    charactersList,
    "",
    "Conversation so far:",
    historyText,
    "",
    "Which character should speak next? Reply with their characterId only.",
  ].join("\n");
}
