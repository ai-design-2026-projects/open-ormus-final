import type { CharacterRecord, ScenarioRecord } from "../runner/config";
import type { ConversationMessage } from "../runner/conversation";

export function buildJudgeSystemPrompt(): string {
  return `You are an expert evaluator assessing how faithfully a language model portrayed fictional characters.

You will be given:
1. A list of character personality profiles (without any names or aliases)
2. A list of real character names (not linked to any profile)
3. A conversation transcript using anonymised alias names
4. The scenario context and opening prompt

Your task: match each alias in the conversation to one of the real character names by identifying which character profile best matches each alias's behaviour in the conversation.

Base your assessment solely on the content of the conversation — how each alias speaks, reasons, and reacts — compared against the personality profiles provided.

You must assign every alias in the transcript to exactly one real character name. No two aliases can be assigned to the same real character name.

Respond using the required JSON schema. For each assignment, provide at least one specific reason drawn from the conversation.`;
}

export function buildJudgeUserMessage(
  aliasMap: Record<string, string>,
  characters: CharacterRecord[],
  scenario: ScenarioRecord,
  messages: ConversationMessage[],
): string {
  const parts: string[] = [];

  parts.push("## Character Profiles\n");
  parts.push(
    "The following profiles describe the characters in this conversation. " +
    "They are presented in shuffled order with no name or alias labels.\n",
  );

  const shuffled = deterministicShuffle(characters, scenario.id);
  shuffled.forEach((char, i) => {
    parts.push(`### Profile ${i + 1}`);
    parts.push(`**Archetype:** ${char.archetype}`);
    parts.push(`**Personality traits:** ${char.personalityTraits.join(", ")}`);
    parts.push(`**Backstory:** ${char.backstory}`);
    parts.push(`**Speech patterns:** ${char.speechPatterns.join("; ")}`);
    parts.push(`**Values:** ${char.values.join(", ")}`);
    parts.push(`**Fears:** ${char.fears.join(", ")}`);
    parts.push(`**Goals:** ${char.goals.join(", ")}`);
    parts.push(`**Notable quotes:** ${char.notableQuotes.map((q) => `"${q}"`).join(", ")}`);
    parts.push(`**Coping style:** ${char.copingStyle.join("; ")}`);
    parts.push("");
  });

  parts.push("## Real Character Names\n");
  parts.push(
    "The following are the real names of the characters. " +
    "They are NOT presented in the same order as the profiles above.\n",
  );
  parts.push(characters.map((c) => `- ${c.name}`).join("\n"));
  parts.push("");

  parts.push("## Scenario\n");
  parts.push(`**Context:** ${scenario.context}`);
  parts.push(`**Opening prompt:** ${scenario.initial_prompt}`);
  parts.push("");

  parts.push("## Conversation Transcript\n");
  parts.push(
    "The following conversation uses alias names. Identify which real character each alias represents.\n",
  );
  for (const msg of messages) {
    parts.push(`**${msg.character_name}**: ${msg.content}`);
  }
  parts.push("");

  parts.push("## Aliases to Assign\n");
  parts.push(
    "Assign each of the following aliases to one of the real character names listed above:\n",
  );
  parts.push(Object.keys(aliasMap).map((alias) => `- ${alias}`).join("\n"));

  return parts.join("\n");
}

function deterministicShuffle<T>(arr: T[], seed: string): T[] {
  const copy = [...arr];
  let s = hashSeed(seed);
  for (let i = copy.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const j = Math.abs(s) % (i + 1);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function hashSeed(str: string): number {
  let h = 0x12345678;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(h ^ str.charCodeAt(i), 2654435761) | 0) >>> 0;
  }
  return h;
}
