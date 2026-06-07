import Handlebars from "handlebars";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProfileField } from "./types";
import type { ScenarioRecord } from "../generator/config";
import type { ConversationMessage } from "../generator/conversation";

Handlebars.registerHelper("addOne", (index: number) => index + 1);

const promptDir = join(import.meta.dirname, "prompts");
const reconstructorSystemTemplate = Handlebars.compile(
  readFileSync(join(promptDir, "reconstructor-system.hbs"), "utf8"),
);
const reconstructorUserTemplate = Handlebars.compile(
  readFileSync(join(promptDir, "reconstructor-user.hbs"), "utf8"),
);
const comparatorSystemTemplate = Handlebars.compile(
  readFileSync(join(promptDir, "comparator-system.hbs"), "utf8"),
);
const comparatorUserTemplate = Handlebars.compile(
  readFileSync(join(promptDir, "comparator-user.hbs"), "utf8"),
);

const FIELD_DEFINITIONS: Record<ProfileField, string> = {
  personalityTraits:
    "Stable character traits that show up across different situations — adjectives or short phrases describing how this character fundamentally is.",
  speechPatterns:
    "Observable features of how this character constructs sentences: pronoun choice, sentence length, rhythm, hedging, vocabulary register, rhetorical habits.",
  values:
    "What this character demonstrably prioritizes, protects, or acts to uphold — inferred from their choices and stated positions.",
  fears:
    "What this character avoids, resists, or shows distress about — inferred from what they protect against or refuse.",
  goals:
    "What this character is trying to achieve or move towards in this interaction and in general.",
  copingStyle:
    "How this character manages stress, conflict, or uncertainty — behavioral patterns visible when under pressure.",
};

export function buildReconstructorSystemPrompt(): string {
  return reconstructorSystemTemplate({});
}

export function buildReconstructorUserMessage(
  alias: string,
  scenario: ScenarioRecord,
  messages: ConversationMessage[],
  fields: ProfileField[],
): string {
  return reconstructorUserTemplate({
    alias,
    scenario: { title: scenario.title, context: scenario.context },
    transcript: messages,
    fields: fields.map((f) => ({ name: f, definition: FIELD_DEFINITIONS[f] })),
  });
}

export function buildComparatorSystemPrompt(): string {
  return comparatorSystemTemplate({});
}

export function buildComparatorUserMessage(
  field: ProfileField,
  gtItems: string[],
  reconstructedItems: string[],
): string {
  return comparatorUserTemplate({
    field,
    definition: FIELD_DEFINITIONS[field],
    gtItems,
    reconstructedItems,
  });
}
