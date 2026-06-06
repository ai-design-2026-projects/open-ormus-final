import type { ScenarioRecord } from "../generator/config";
import type { ConversationMessage } from "../generator/conversation";
import type { CharacterRecord } from "../generator/config";

export type PromptCharacter = {
  id: string;
  name: string;
  archetype: string;
  record: CharacterRecord;
};

export function buildJudgeSystemPrompt(): string {
  return `You are evaluating a roleplay conversation segment for scenario adherence and character consistency.

Your task:
1. Score how actively this segment engages the scenario's intended stress axes.
2. For each character listed, score whether their response to the scenario's pressure is consistent with their personality sheet.

Scoring for scenario_engagement:
  active  — The scenario's stress axis is clearly being enacted. Characters are responding to the scenario's specific pressure.
  touched — The scenario's theme is present but not the central driver of the exchange.
  absent  — The conversation has drifted away from the scenario's intended tension.

Scoring for character_alignment (per character):
  consistent  — The character's response to the scenario reflects their archetype and listed traits, values, fears, or coping style.
  neutral     — The character's response is plausible but does not clearly reflect their specific personality sheet.
  contradicts — The character's response directly contradicts their stated traits, archetype, or coping style.

Return only valid JSON matching the provided schema. For each character in character_alignment, use the exact character_id shown in the Characters section. Include all listed characters.`;
}

export function buildJudgeUserPrompt(
  scenario: ScenarioRecord,
  characters: PromptCharacter[],
  priorMessages: ConversationMessage[],
  segmentMessages: ConversationMessage[],
  segmentIndex: number,
  totalSegments: number,
  firstTurnNumber: number,
  lastTurnNumber: number,
): string {
  const parts: string[] = [];

  parts.push("## Scenario\n");
  parts.push(`stress_axes: [${scenario.stress_axes.join(", ")}]`);
  parts.push(`social_context: ${scenario.social_context}`);
  parts.push(`pressure_source: ${scenario.pressure_source}`);
  parts.push(`initial_prompt: "${scenario.initial_prompt}"\n`);

  parts.push("## Characters\n");
  for (const char of characters) {
    parts.push(`${char.name} (character_id: ${char.id}) — ${char.archetype}`);
    parts.push(`  personalityTraits: [${char.record.personalityTraits.join(", ")}]`);
    parts.push(`  values: [${char.record.values.join(", ")}]`);
    parts.push(`  fears: [${char.record.fears.join(", ")}]`);
    parts.push(`  goals: [${char.record.goals.join(", ")}]`);
    parts.push(`  copingStyle: [${char.record.copingStyle.join(", ")}]`);
    parts.push(`  speechPatterns: [${char.record.speechPatterns.join(", ")}]\n`);
  }

  if (priorMessages.length > 0) {
    parts.push(`## Prior Conversation (turns 1–${firstTurnNumber - 1})\n`);
    for (const msg of priorMessages) {
      parts.push(`[${msg.character_name}]: ${msg.content}`);
    }
    parts.push("");
  }

  parts.push(
    `## Current Segment — Segment ${segmentIndex} of ${totalSegments} (turns ${firstTurnNumber}–${lastTurnNumber})\n`,
  );
  for (const msg of segmentMessages) {
    parts.push(`[${msg.character_name}] (${msg.emotion}, ${msg.intensity}): ${msg.content}`);
  }
  parts.push("");

  parts.push("## Task");
  if (priorMessages.length > 0) {
    parts.push(
      `Score scenario_engagement and personality_alignment for the Current Segment only (turns ${firstTurnNumber}–${lastTurnNumber}). Use the Prior Conversation to understand established references and dynamics, but base your scores on what happens in the Current Segment.`,
    );
  } else {
    parts.push(
      `Score scenario_engagement and personality_alignment for the Current Segment only (turns ${firstTurnNumber}–${lastTurnNumber}).`,
    );
  }
  parts.push(
    `Score personality_alignment for each of: ${characters.map((c) => c.id).join(", ")}`,
  );

  return parts.join("\n");
}
