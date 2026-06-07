import type { CharacterRecord, ScenarioRecord } from "../generator/config";
import type { ConversationMessage } from "../generator/conversation";

export function buildJudgeSystemPrompt(): string {
  return `You are a behavioral analyst. Your task is to match anonymous aliases to fictional characters by identifying whose behavioral signature each alias displays in a conversation.

You will receive: a scenario, a conversation transcript using alias names, character profiles (unlabelled, shuffled), a list of real names, and the aliases to assign.

Read the transcript first and form impressions of each alias before reading the profiles.

Match evidence in this order:

  Tier 1 — EXACT LANGUAGE: Does any alias use a phrase that appears verbatim or near-verbatim in a character's notable quotes? An exact match is near-conclusive evidence on its own.

  Tier 2 — SPEECH SIGNATURE: How does each alias construct sentences? Look for: pronoun choice (I / we / one), sentence length and rhythm, use of qualifications or subordinate clauses, rhetorical devices, vocabulary register.

  Tier 3 — VALUE IN ACTION: What does each alias choose, refuse, or defend in this specific scenario? Match to the character's values, goals, and fears that are activated by the situation.

Constraints:
  - Each alias maps to exactly one real character name. No shared assignments.
  - If two profiles seem equally plausible for one alias, assign by elimination: the stronger match elsewhere resolves the tie.

For each assignment provide 1–3 reasons. Each reason must follow this format:
  "[exact quote or paraphrase from transcript]" → matches [profile field]: [specific value from that field]

Do not write vague summaries ("seems confrontational"). Every reason must be grounded in a specific line from the transcript and a specific field in a profile.

Respond with ONLY valid JSON — no markdown, no explanation, no preamble. Use this exact structure:
{"assignments":[{"alias":"<alias>","real_name":"<real name>","reasons":["<reason 1>","<reason 2>"]}]}`;
}

export function buildJudgeUserMessage(
  aliasMap: Record<string, string>,
  characters: CharacterRecord[],
  scenario: ScenarioRecord,
  messages: ConversationMessage[],
): string {
  const parts: string[] = [];

  // Scenario first — establishes context before transcript
  parts.push("## Scenario\n");
  parts.push(`**Title:** ${scenario.title}`);
  parts.push(`**Context:** ${scenario.context}`);
  parts.push(`**Opening prompt:** ${scenario.initial_prompt}`);
  parts.push("");

  // Transcript second — read dialogue before loading profiles
  parts.push("## Conversation Transcript\n");
  parts.push("Read the following exchanges carefully. Note each alias's language, framing, and choices before proceeding.\n");
  for (const msg of messages) {
    parts.push(`**${msg.character_name}**: ${msg.content}`);
  }
  parts.push("");

  // Profiles third — ordered by observability in short dialogue, no abilities field
  parts.push("## Character Profiles\n");
  parts.push(
    "The following profiles describe the characters in this conversation. " +
    "Presented in shuffled order with no name or alias labels. " +
    "Fields are ordered from most to least directly observable in dialogue.\n",
  );

  const shuffled = deterministicShuffle(characters, scenario.id);
  shuffled.forEach((char, i) => {
    parts.push(`### Profile ${i + 1}`);
    parts.push(`**Speech patterns:** ${char.speechPatterns.join("; ")}`);
    parts.push(`**Notable quotes:** ${char.notableQuotes.map((q) => `"${q}"`).join(" | ")}`);
    parts.push(`**Personality traits:** ${char.personalityTraits.join(", ")}`);
    parts.push(`**Values:** ${char.values.join(", ")}`);
    parts.push(`**Goals:** ${char.goals.join(", ")}`);
    parts.push(`**Fears:** ${char.fears.join(", ")}`);
    parts.push(`**Coping style:** ${char.copingStyle.join("; ")}`);
    parts.push(`**Archetype:** ${char.archetype}`);
    parts.push(`**Backstory:** ${char.backstory}`);
    parts.push("");
  });

  // Real names — deliberately not linked to profiles
  parts.push("## Real Character Names\n");
  parts.push("The following are the real names of the characters in the transcript. Not listed in the same order as the profiles above.\n");
  parts.push(characters.map((c) => `- ${c.name}`).join("\n"));
  parts.push("");

  // Assignment task last
  parts.push("## Aliases to Assign\n");
  parts.push("Assign each alias to one real character name. Provide 1–3 reasons per assignment in the required format.\n");
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
