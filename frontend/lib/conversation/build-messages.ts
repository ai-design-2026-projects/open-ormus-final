import { buildHistoryLine } from "./parse-turn";

export type ConversationTurn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

type ConversationMessage = {
  characterId: string;
  character: { name: string };
  content: string;
  emotion: string;
  intensity: string;
  subtext: string;
};

const SCENE_START = "(The scene has just begun — no lines have been spoken yet.)";

/**
 * Builds a per-character alternating MessageParam array for use as the
 * `messages` field in an Anthropic API call.
 *
 * The speaking character's own prior lines become `assistant` turns.
 * All other characters' lines between them are bundled into `user` turns.
 * Private reasoning is injected into the final (always-new) user message only —
 * it never appears in historical turns and is invisible to other characters.
 */
export function buildCharacterMessages(
  messages: ConversationMessage[],
  speakingCharacterId: string,
  speakingCharacterName: string,
  reasoning: string,
): ConversationTurn[] {
  const result: ConversationTurn[] = [];
  let pendingOthers: string[] = [];

  for (const msg of messages) {
    if (msg.characterId === speakingCharacterId) {
      const userContent =
        pendingOthers.length > 0 ? pendingOthers.join("\n") : SCENE_START;
      result.push({ role: "user", content: userContent });
      const emotionJson = JSON.stringify({
        emotion: msg.emotion,
        intensity: msg.intensity,
        subtext: msg.subtext,
      });
      result.push({
        role: "assistant",
        content: `<emotion>${emotionJson}</emotion>\n<dialogue>${msg.content}</dialogue>`,
      });
      pendingOthers = [];
    } else {
      pendingOthers.push(
        buildHistoryLine(
          msg.character.name,
          msg.content,
          msg.emotion,
          msg.intensity,
          msg.subtext,
        ),
      );
    }
  }

  const hasPriorAssistantTurn = result.some((m) => m.role === "assistant");

  // When the speaking character has spoken before and multiple other-character lines
  // are pending, flush them as their own user turn so each group is clearly separated.
  // In all other cases (0 or 1 pending, or first appearance) fold them into the trigger.
  if (hasPriorAssistantTurn && pendingOthers.length >= 2) {
    result.push({ role: "user", content: pendingOthers.join("\n") });
    pendingOthers = [];
  }

  const contextLines =
    pendingOthers.length > 0 ? pendingOthers.join("\n") : SCENE_START;

  const continuePrompt = `Continue as ${speakingCharacterName}. Write only their next line.`;

  const triggerContent = reasoning
    ? `[Your private thoughts before this response — use as context, do not repeat or quote]\n${reasoning}\n\n${contextLines}\n\n${continuePrompt}`
    : `${contextLines}\n\n${continuePrompt}`;

  result.push({ role: "user", content: triggerContent });

  return result;
}
