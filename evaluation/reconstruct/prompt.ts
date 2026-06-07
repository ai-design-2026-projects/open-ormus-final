import type { ProfileField } from "./types";
import type { ScenarioRecord } from "../generator/config";
import type { ConversationMessage } from "../generator/conversation";

const FIELD_DEFINITIONS: Record<ProfileField, string> = {
  personalityTraits: "Stable character traits that show up across different situations — adjectives or short phrases describing how this character fundamentally is.",
  speechPatterns: "Observable features of how this character constructs sentences: pronoun choice, sentence length, rhythm, hedging, vocabulary register, rhetorical habits.",
  values: "What this character demonstrably prioritizes, protects, or acts to uphold — inferred from their choices and stated positions.",
  fears: "What this character avoids, resists, or shows distress about — inferred from what they protect against or refuse.",
  goals: "What this character is trying to achieve or move towards in this interaction and in general.",
  copingStyle: "How this character manages stress, conflict, or uncertainty — behavioral patterns visible when under pressure.",
};

export function buildReconstructorSystemPrompt(): string {
  return `You are a behavioral analyst. Your task is to infer a fictional character's personality profile from a conversation transcript.

You will receive a scenario context, a conversation transcript, and a list of personality fields to reconstruct for a specific character (identified by alias).

For each field, produce either:
- A list of reconstructed items grounded in the transcript
- { not_observed: true, items: [] } if the transcript contains no sufficient evidence for that field

Rules:
1. Only include items you can ground in specific behavior, dialogue, or choices from the transcript. Do not add traits not evidenced in the text.
2. "not_observed" means the evidence is absent — not that the character lacks this trait. Use it freely.
3. Focus only on the character identified by the specified alias. Ignore other characters.
4. 2–5 items per field is typical. Match the abstraction level of the field definition.
5. For speechPatterns: describe observable language features (not interpretations).
6. For values/fears/goals: infer from what the character chooses, refuses, or defends — not from what they say they believe.

Respond with ONLY valid JSON — no markdown, no explanation. Use this structure:
{"fields":{"personalityTraits":{"not_observed":false,"items":["..."]},"speechPatterns":{"not_observed":false,"items":["..."]}}}`;
}

export function buildReconstructorUserMessage(
  alias: string,
  scenario: ScenarioRecord,
  messages: ConversationMessage[],
  fields: ProfileField[],
): string {
  const parts: string[] = [];

  parts.push("## Scenario\n");
  parts.push(`**Title:** ${scenario.title}`);
  parts.push(`**Context:** ${scenario.context}\n`);

  parts.push("## Conversation Transcript\n");
  parts.push(`Read the following exchanges. You will reconstruct the profile for **${alias}** only.\n`);

  for (const msg of messages) {
    parts.push(`**${msg.character_name}** [${msg.emotion}, ${msg.intensity}]: ${msg.content}`);
  }
  parts.push("");

  parts.push(`## Task: Reconstruct profile for alias "${alias}"\n`);
  parts.push("For each field below, output reconstructed items or mark not_observed.\n");

  for (const field of fields) {
    parts.push(`**${field}:** ${FIELD_DEFINITIONS[field]}`);
  }

  return parts.join("\n");
}

export function buildComparatorSystemPrompt(): string {
  return `You are an expert semantic evaluator. Your task is to label reconstructed personality items against ground-truth profile items.

For each reconstructed item, determine whether it is covered by the ground-truth and assign one of three labels:

  match: The reconstructed item expresses the same idea as at least one ground-truth item, even if worded differently. Paraphrase, synonym, and generalization all count as a match.
  no_match: The reconstructed item is not covered by any ground-truth item. It may be a plausible trait not mentioned in the ground truth — that is fine.
  contradiction: The reconstructed item directly contradicts a ground-truth item. Use this only when the reconstructed item is incompatible with or the opposite of a ground-truth item.

Important: reserve "contradiction" for clear semantic contradictions. A trait absent from the ground-truth is "no_match", not "contradiction". Ambiguous cases default to "no_match".

For each item provide a justification: which ground-truth item it matches, partially matches, is contradicted by, or why there is no match.

Respond with ONLY valid JSON — no markdown, no explanation. Use this structure:
{"item_scores":[{"reconstructed_item":"...","score":"match","justification":"..."}]}`;
}

export function buildComparatorUserMessage(
  field: ProfileField,
  gtItems: string[],
  reconstructedItems: string[],
): string {
  const parts: string[] = [];

  parts.push(`## Field: ${field}\n`);
  parts.push(`**Definition:** ${FIELD_DEFINITIONS[field]}\n`);

  parts.push("## Ground-Truth Items\n");
  gtItems.forEach((item, i) => parts.push(`${i + 1}. ${item}`));
  parts.push("");

  parts.push("## Reconstructed Items to Label\n");
  parts.push("Label each item as: match, no_match, or contradiction.\n");
  reconstructedItems.forEach((item, i) => parts.push(`${i + 1}. ${item}`));

  return parts.join("\n");
}
