import { buildHistoryLine } from "./parse-turn";
import { SCENE_START, buildContinuePrompt } from "./prompts";

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
  reasoning: string | null;
};

/**
 * Builds a per-character alternating MessageParam array for use as the
 * `messages` field in an Anthropic API call.
 *
 * The speaking character's own prior lines become `assistant` turns.
 * All other characters' lines between them are bundled into `user` turns.
 * Each character's reasoning is visible only in their own assistant turns —
 * it is never included in user turns, so other characters cannot see it.
 */
export function buildCharacterMessages(
  messages: ConversationMessage[],
  speakingCharacterId: string,
  speakingCharacterName: string,
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
      const emotionBlock = `<|emotion|>${emotionJson}<|emotion|>`;
      const reasoningPrefix = msg.reasoning
        ? `<|reasoning|>${msg.reasoning}<|reasoning|>\n`
        : "";

      result.push({
        role: "assistant",
        content: `${reasoningPrefix}${emotionBlock}${msg.content}`,
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

  if (hasPriorAssistantTurn && pendingOthers.length >= 2) {
    result.push({ role: "user", content: pendingOthers.join("\n") });
    pendingOthers = [];
  }

  const contextLines =
    pendingOthers.length > 0 ? pendingOthers.join("\n") : SCENE_START;

  result.push({ role: "user", content: `${contextLines}\n\n${buildContinuePrompt(speakingCharacterName)}` });

  return result;
}
